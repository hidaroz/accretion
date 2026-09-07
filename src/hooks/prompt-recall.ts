#!/usr/bin/env node
// UserPromptSubmit hook: passive recall. Reads {prompt, cwd, session_id} on
// stdin, decides with the engine whether the vault has something worth placing
// in front of the model, and prints Claude Code's hookSpecificOutput JSON.
// Never exits non-zero: a recall failure must not block a prompt.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openVault } from "../engine/index.js";
import { shouldRecall } from "../engine/context/recall.js";
import {
  loadProjectMap,
  resolveProjectMapPath,
  resolveVaultForSlug,
  slugForCwd,
} from "../engine/config/project-map.js";

export interface PromptHookInput {
  prompt?: string;
  cwd?: string;
  session_id?: string;
  hook_event_name?: string;
}

export interface PromptHookOutput {
  hookSpecificOutput: { hookEventName: "UserPromptSubmit"; additionalContext: string };
}

export interface RecallOutcome {
  output: PromptHookOutput | null;
  reason: string;
  vaultId: string | null;
  tier?: string;
  injectedPaths?: string[];
}

interface SessionState {
  injected: string[];
}

function statePath(sessionId: string, tmp = os.tmpdir()): string {
  return path.join(tmp, `accretion-recall-${sessionId.replace(/[^a-zA-Z0-9_-]/g, "")}.json`);
}

function readState(p: string): SessionState {
  try {
    const s = JSON.parse(fs.readFileSync(p, "utf8")) as SessionState;
    return Array.isArray(s.injected) ? s : { injected: [] };
  } catch {
    return { injected: [] };
  }
}

export async function runPromptRecall(
  input: PromptHookInput,
  env: NodeJS.ProcessEnv = process.env,
  opts: { tmpdir?: string } = {}
): Promise<RecallOutcome> {
  const t0 = Date.now();
  const prompt = input.prompt ?? "";
  if (!shouldRecall(prompt)) return { output: null, reason: "prompt too short or a command", vaultId: null };

  const slug = slugForCwd(input.cwd);
  const vaultId = resolveVaultForSlug(slug, loadProjectMap(resolveProjectMapPath(env)));
  if (!vaultId) return { output: null, reason: `no vault mapped for "${slug}"`, vaultId: null };

  const v = await openVault({ vaultId, semantic: undefined });
  const cfg = v.config.recall ?? {};
  if (cfg.mode === "off") return { output: null, reason: "recall off for this vault", vaultId };

  // Keyword-only unless the vault opts in: the model load would be paid on every prompt.
  const handle = cfg.semantic === true && v.semantic ? v : await openVault({ vaultId, semantic: false });
  const result = await handle.recall(prompt, { budget: cfg.budget, mode: cfg.mode });

  const sessionId = input.session_id ?? "nosession";
  const sp = statePath(sessionId, opts.tmpdir);
  const state = readState(sp);
  const fresh = result.injectedPaths.filter((p) => !state.injected.includes(p));
  const suppressed =
    result.text !== null && fresh.length === 0 && result.route.method !== "direct_map";

  if (result.text !== null && !suppressed) {
    state.injected.push(...fresh);
    try {
      fs.writeFileSync(sp, JSON.stringify(state));
    } catch {
      // state is a nicety
    }
  }

  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    session_id: sessionId,
    promptChars: prompt.length,
    tier: result.tier,
    route: { method: result.route.method, path: result.route.path },
    injectedPaths: result.injectedPaths,
    suppressed,
    latencyMs: Date.now() - t0,
  });
  try {
    fs.mkdirSync(path.join(v.vault.root, ".mcp"), { recursive: true });
    fs.appendFileSync(path.join(v.vault.root, ".mcp", "recall-log.jsonl"), line + "\n");
  } catch {
    // logging is best effort
  }

  if (result.text === null) return { output: null, reason: `nothing cleared the gate (${result.route.method})`, vaultId, tier: result.tier };
  if (suppressed) return { output: null, reason: "already injected this session", vaultId, tier: result.tier, injectedPaths: result.injectedPaths };
  return {
    output: { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: result.text } },
    reason: `injected (${result.tier})`,
    vaultId,
    tier: result.tier,
    injectedPaths: result.injectedPaths,
  };
}

async function main(): Promise<void> {
  process.env.LOG_LEVEL = process.env.LOG_LEVEL || "error";
  let input: PromptHookInput = {};
  try {
    input = JSON.parse(fs.readFileSync(0, "utf8")) as PromptHookInput;
  } catch {
    return;
  }
  try {
    const out = await runPromptRecall(input);
    if (out.output) process.stdout.write(JSON.stringify(out.output));
  } catch (err) {
    process.stderr.write(`[accretion recall] ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().finally(() => process.exit(0));
}
