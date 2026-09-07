#!/usr/bin/env node
// SessionEnd hook: extract session metadata from the transcript JSONL and write
// a session note into the mapped vault. Runs under a shared 1.5 s budget with
// every other SessionEnd hook, so it does the minimum synchronously (parse,
// redact, write, log) and hands git to a detached `accretion commit`.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join, basename, dirname, sep, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expandHome } from "../engine/utils/path-safety.js";
import { resolveVaultsConfigPath } from "../engine/config/vault-config.js";
import {
  loadProjectMap,
  resolveProjectMapPath,
  resolveVaultForSlug,
  slugForCwd,
} from "../engine/config/project-map.js";
import { appendLog } from "../engine/lifecycle/log.js";

interface TranscriptLine {
  type?: string;
  aiTitle?: string;
  message?: { content?: unknown };
}

interface ToolCall {
  name: string;
  input: Record<string, unknown>;
}

interface HookInput {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
}

/**
 * Values that are structurally incapable of being a leaked credential:
 * literals opening a collection, and the placeholders documentation uses.
 */
function isPlaceholder(raw: string): boolean {
  const v = raw.replace(/^["']|["']$/g, "").trim();
  if (v.startsWith("[") || v.startsWith("{")) return true;
  if (v.length < 8) return true;
  return /^(\.{3}|<.*>|x{3,}|your[-_ ]|my[-_ ]|some[-_ ]|changeme|example|placeholder|redacted|\$\{|\$[A-Z_]+$)/i.test(v);
}

/**
 * Strip credentials before anything reaches the vault. Deliberately blunt: a
 * false positive costs a redacted word, a false negative costs a leaked key.
 * Vendor patterns run before the generic assignment rule so the label survives.
 */
export function redactSecrets(text: string): string {
  const rules: Array<[RegExp, string | ((...args: string[]) => string)]> = [
    [/\bnapi_[A-Za-z0-9]{20,}/g, "napi_[REDACTED]"],
    [/\bnpg_[A-Za-z0-9]{8,}/g, "npg_[REDACTED]"],
    [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, "github_pat_[REDACTED]"],
    [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, "gh?_[REDACTED]"],
    [/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, "xox?-[REDACTED]"],
    [/\bsk-[A-Za-z0-9_-]{20,}/g, "sk-[REDACTED]"],
    [/\bAKIA[0-9A-Z]{16}\b/g, "AKIA[REDACTED]"],
    [/\bASIA[0-9A-Z]{16}\b/g, "ASIA[REDACTED]"],
    [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]+/g, "[REDACTED_JWT]"],
    [/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{5,}/g, "[REDACTED_JWT]"],
    [/\beyJ[A-Za-z0-9_+/=-]{37,}/g, "[REDACTED_JWT]"],
    [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[REDACTED]@"],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]"],
    [
      /\b([A-Za-z_][A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)S?)(["']?\s*[:=]\s*)("[^"\n]*"|'[^'\n]*'|[^\s"';,)]+)/gi,
      (match: string, name: string, sepStr: string, value: string) =>
        isPlaceholder(value) ? match : `${name}${sepStr}[REDACTED]`,
    ],
  ];
  let out = String(text);
  for (const [re, replacement] of rules) {
    out = typeof replacement === "string" ? out.replace(re, replacement) : out.replace(re, replacement as (...a: string[]) => string);
  }
  return out;
}

function stripTags(content: string): string {
  return content
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/<task-notification>[\s\S]*?<\/task-notification>/g, "")
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, "")
    .replace(/<command-[^>]*>[\s\S]*?<\/command-[^>]*>/g, "")
    .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractToolCalls(lines: TranscriptLine[]): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const line of lines) {
    if (line.type !== "assistant") continue;
    const content = line.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content as Array<{ type?: string; name?: string; input?: Record<string, unknown> }>) {
      if (block.type === "tool_use" && block.name) calls.push({ name: block.name, input: block.input || {} });
    }
  }
  return calls;
}

export function getFirstUserMessage(lines: TranscriptLine[]): string | null {
  for (const line of lines) {
    if (line.type !== "user") continue;
    const content = line.message?.content;
    if (typeof content !== "string") continue;
    const clean = stripTags(content);
    if (clean.length > 10) return clean.slice(0, 200);
  }
  return null;
}

export function extractTopics(lines: TranscriptLine[]): string[] {
  const topics: string[] = [];
  for (const line of lines) {
    if (line.type !== "user") continue;
    const content = line.message?.content;
    if (typeof content !== "string") continue;
    const clean = stripTags(content);
    if (clean.length > 10 && !/^[a-f0-9-]{20,}$/i.test(clean)) {
      topics.push(clean.slice(0, 100) + (clean.length > 100 ? "..." : ""));
    }
  }
  return topics.slice(0, 20);
}

export function extractFilesChanged(toolCalls: ToolCall[]): string[] {
  const files = new Set<string>();
  for (const call of toolCalls) {
    if (call.name === "Edit" || call.name === "Write") {
      const fp = call.input.file_path;
      if (typeof fp === "string" && fp) files.add(fp);
    }
  }
  return [...files];
}

export function extractCommands(toolCalls: ToolCall[]): string[] {
  const readOnlyPrefixes = ["ls ", "cat ", "head ", "tail ", "grep ", "find ", "echo ", "wc ", "file ", "which "];
  const cmds: string[] = [];
  for (const call of toolCalls) {
    if (call.name !== "Bash") continue;
    const cmd = call.input.command;
    if (typeof cmd !== "string" || !cmd) continue;
    if (readOnlyPrefixes.some((p) => cmd.trimStart().startsWith(p))) continue;
    cmds.push(cmd.slice(0, 100) + (cmd.length > 100 ? "..." : ""));
  }
  return [...new Set(cmds)].slice(0, 30);
}

/**
 * Locate the note this session already wrote, if any. Keyed on the full
 * `{project}-{id8}.md` filename: one Claude session run from two repos is two
 * pieces of work. Searches the archive too, so resuming a session whose note
 * was archived updates it in place instead of resurrecting a duplicate.
 */
export function findExistingSessionNote(vaultPath: string, fileName: string): string | null {
  const sessionsDir = join(vaultPath, "sessions");
  if (!existsSync(sessionsDir)) return null;
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(sessionsDir, { recursive: true, withFileTypes: true }) as import("node:fs").Dirent[];
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isFile() || entry.name !== fileName) continue;
    const dir = (entry as unknown as { parentPath?: string; path?: string }).parentPath ?? (entry as unknown as { path: string }).path;
    return join(dir, entry.name).slice(vaultPath.length + 1).split(sep).join("/");
  }
  return null;
}

/** Read `created:` out of an existing note's frontmatter, or null. */
export function readCreated(fullPath: string): string | null {
  try {
    const head = readFileSync(fullPath, "utf8").slice(0, 2000);
    const m = head.match(/^created:\s*'?([^'\n]+)'?\s*$/m);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

/** Which vault should this project's sessions go to, if any (opt-in). */
export function resolveVault(projectSlug: string, mapPath: string = resolveProjectMapPath()): string | null {
  return resolveVaultForSlug(projectSlug, loadProjectMap(mapPath));
}

function getVaultPath(vaultId: string): string | null {
  const configPath = resolveVaultsConfigPath();
  if (!configPath) return null;
  try {
    const config = JSON.parse(readFileSync(configPath, "utf8")) as { vaults?: Array<{ id: string; path: string }> };
    const vault = config.vaults?.find((v) => v.id === vaultId);
    return vault?.path ? resolve(expandHome(vault.path)) : null;
  } catch {
    return null;
  }
}

function slugify(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function escapeYaml(str: string): string {
  return str.replace(/'/g, "''");
}

/** Where the CLI lives relative to this file, or under ACCRETION_HOME. */
function findCli(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "..", "cli", "main.js"),
    process.env.ACCRETION_HOME ? join(process.env.ACCRETION_HOME, "dist", "cli", "main.js") : null,
  ].filter((p): p is string => !!p);
  return candidates.find((p) => existsSync(p)) ?? null;
}

export interface CaptureResult {
  notePath: string;
  created: boolean;
  vaultId: string;
}

export async function captureSession(input: HookInput, now: Date = new Date()): Promise<CaptureResult | null> {
  const { session_id, transcript_path, cwd } = input;
  if (!transcript_path || !session_id) return null;

  const lines: TranscriptLine[] = readFileSync(transcript_path, "utf8")
    .trim()
    .split("\n")
    .map((l) => {
      try {
        return JSON.parse(l) as TranscriptLine;
      } catch {
        return null;
      }
    })
    .filter((l): l is TranscriptLine => l !== null);

  const messages = lines.filter((l) => l.type === "user" || l.type === "assistant");
  const toolCalls = extractToolCalls(lines);
  const writeOps = toolCalls.filter((t) => t.name === "Edit" || t.name === "Write");
  if (messages.length < 6 && writeOps.length === 0) return null;

  const aiTitle = lines.find((l) => l.type === "ai-title")?.aiTitle;
  const firstUserMsg = getFirstUserMessage(lines);
  // Redact the title too: it becomes the commit message, which the whole-note pass never sees.
  const title = redactSecrets(
    aiTitle || (firstUserMsg ? `Session: ${firstUserMsg.slice(0, 80)}` : `Session: ${session_id.slice(0, 8)}`)
  );

  const projectSlug = slugForCwd(cwd);
  const vaultId = resolveVault(projectSlug);
  if (!vaultId) return null;
  const vaultPath = getVaultPath(vaultId);
  if (!vaultPath) return null;

  const dateDir = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const fileName = `${projectSlug}-${session_id.slice(0, 8)}.md`;

  // A resumed session ends more than once; reuse the note it already has.
  const existingPath = findExistingSessionNote(vaultPath, fileName);
  const notePath = existingPath || `sessions/${dateDir}/${fileName}`;
  const fullPath = join(vaultPath, notePath);
  // `created` stays at first capture: digests group by created-week.
  const created = (existingPath && readCreated(fullPath)) || now.toISOString();

  const topics = extractTopics(lines);
  const filesChanged = extractFilesChanged(toolCalls);
  const commands = extractCommands(toolCalls);

  const frontmatter = [
    "---",
    `title: '${escapeYaml(title)}'`,
    "tags:",
    "  - type/session",
    `  - project/${slugify(projectSlug)}`,
    `created: '${created}'`,
    `updated: '${now.toISOString()}'`,
    `session_id: '${session_id}'`,
    `project: '${escapeYaml(projectSlug)}'`,
    `cwd: '${escapeYaml(cwd || "")}'`,
    "---",
  ].join("\n");

  let body = `# ${title}\n`;
  if (topics.length > 0) body += `\n## Topics\n\n${topics.map((t) => `- ${t}`).join("\n")}\n`;
  if (filesChanged.length > 0) body += `\n## Files Changed\n\n${filesChanged.map((f) => `- \`${f}\``).join("\n")}\n`;
  if (commands.length > 0) body += `\n## Commands\n\n${commands.map((c) => `- \`${c}\``).join("\n")}\n`;
  // No `## Decisions`: grepping assistant prose recorded unverified claims as durable
  // record. Digests extract decisions from the transcript with judgment.

  // Redact once, over the assembled note, so a section added later cannot bypass it.
  const content = redactSecrets(`${frontmatter}\n\n${body}`);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, "utf8");

  if (!existingPath) {
    try {
      await appendLog(vaultPath, { kind: "capture", title, path: notePath, date: now.toISOString().slice(0, 10) });
    } catch {
      // the note is the record; the log is a convenience
    }
  }

  // Git, detached: the committer job also sweeps this up if the spawn fails.
  const cli = findCli();
  if (cli) {
    try {
      const child = spawn(
        process.execPath,
        [cli, "commit", "--vault", vaultId, "--only", notePath, "--message", `Session: ${title.slice(0, 60)}`],
        { detached: true, stdio: "ignore" }
      );
      child.unref();
    } catch {
      // best effort
    }
  }

  return { notePath, created: !existingPath, vaultId };
}

async function main(): Promise<void> {
  process.env.LOG_LEVEL = process.env.LOG_LEVEL || "error";
  let input: HookInput;
  try {
    input = JSON.parse(readFileSync(0, "utf8")) as HookInput;
  } catch {
    return;
  }
  try {
    await captureSession(input);
  } catch (err) {
    process.stderr.write(`[session-journal] ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().finally(() => process.exit(0));
}
