import { z } from "zod";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { defineCommand, vaultFlag } from "../spec.js";
import { loadVaultsConfig, selectVault } from "../../engine/config/vault-config.js";

const execFile = promisify(execFileCb);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Engine-owned caches and logs under a vault's .mcp/. Never committed. */
export const DERIVED_VAULT_FILES = [
  ".mcp/search-index.json",
  ".mcp/embeddings.json",
  ".mcp/search-log.jsonl",
  ".mcp/recall-log.jsonl",
];

export interface CommitResult {
  id: string;
  path: string;
  committed: boolean;
  pushed: boolean;
  skipped?: string;
  error?: string;
}

/**
 * The one git writer for vaults. Ported from the launchd committer: bail on a
 * live index.lock, stage, no-op on an empty diff, commit, push only when the
 * vault opts in. Reads policy from vaults.json instead of hardcoded paths.
 */
export async function commitVault(
  cfg: { id: string; path: string; gitAutoCommit?: boolean; gitAutoPush?: boolean },
  opts: { only?: string; message?: string; push?: boolean; dryRun?: boolean } = {}
): Promise<CommitResult> {
  const out: CommitResult = { id: cfg.id, path: cfg.path, committed: false, pushed: false };
  if (cfg.gitAutoCommit === false) return { ...out, skipped: "gitAutoCommit is false" };
  if (!existsSync(path.join(cfg.path, ".git"))) return { ...out, skipped: "not a git repository" };
  if (existsSync(path.join(cfg.path, ".git", "index.lock"))) return { ...out, skipped: "index.lock present; another git process is active" };
  const git = (args: string[]) => execFile("git", ["-C", cfg.path, ...args], { timeout: 60_000 });
  try {
    await git(["add", opts.only ? "--" : "-A", ...(opts.only ? [opts.only] : [])]);
    // Derived, machine-local state under .mcp/ never belongs in the vault's history,
    // whatever the vault's .gitignore says: it is large, it churns on every read,
    // and an older vault predates the ignore entries.
    await git(["rm", "-r", "-q", "--cached", "--ignore-unmatch", "--", ...DERIVED_VAULT_FILES]);
    let dirty = true;
    try {
      await git(["diff", "--cached", "--quiet"]);
      dirty = false;
    } catch {
      dirty = true;
    }
    if (!dirty) return { ...out, skipped: "nothing to commit" };
    if (opts.dryRun) return { ...out, skipped: "dry run: changes staged but not committed" };
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    await git(["commit", "-q", "-m", opts.message ?? `vault-sync: ${stamp}`]);
    out.committed = true;
    const push = opts.push ?? cfg.gitAutoPush === true;
    if (push) {
      try {
        await git(["push", "-q"]);
        out.pushed = true;
      } catch (err) {
        out.error = `push failed: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`;
      }
    }
    return out;
  } catch (err) {
    return { ...out, error: err instanceof Error ? err.message.split("\n")[0] : String(err) };
  }
}

export const commit = defineCommand({
  name: "commit",
  group: "ops",
  summary: "Commit (and push, if the vault opts in) vault changes. The only git writer.",
  description:
    "Stages and commits every registered vault with gitAutoCommit enabled (or one with --vault), pushing when gitAutoPush is true. Skips vaults with a live index.lock or nothing to commit. Run it from a timer; nothing else in accretion runs git.",
  input: z.object({
    vault: vaultFlag,
    only: z.string().optional().describe("Stage only this vault-relative path (capture hook use)."),
    message: z.string().optional().describe("Commit message (default 'vault-sync: <timestamp>')."),
    push: z.boolean().optional().describe("Override the vault's gitAutoPush for this run (--no-push to suppress)."),
    "dry-run": z.boolean().optional().describe("Stage and report, do not commit."),
  }),
  async run(args) {
    const vaults = await loadVaultsConfig();
    const targets = args.vault ? [selectVault(vaults, args.vault)] : vaults;
    const results: CommitResult[] = [];
    for (const cfg of targets) {
      results.push(await commitVault(cfg, { only: args.only, message: args.message, push: args.push, dryRun: args["dry-run"] }));
    }
    return results;
  },
  format(result) {
    return (result as CommitResult[])
      .map((r) => {
        const what = r.error ? `error: ${r.error}` : r.skipped ? `skipped (${r.skipped})` : `committed${r.pushed ? " + pushed" : ""}`;
        return `${r.id}: ${what}`;
      })
      .join("\n");
  },
});

/** Wrap a repo script until it is ported; argv passes through untouched. */
function scriptCommand(name: string, script: string, summary: string, group: "ops" | "lifecycle" = "ops") {
  return defineCommand({
    name,
    group,
    summary,
    passthrough: true,
    input: z.object({}),
    async run(_args, _ctx, rawArgv) {
      const file = path.join(REPO, "scripts", script);
      if (!existsSync(file)) throw new Error(`${script} not found in ${REPO}`);
      const code: number = await new Promise((resolve) => {
        const child = spawn(process.execPath, [file, ...rawArgv], { stdio: "inherit", env: { ...process.env, ACCRETION_HOME: REPO } });
        child.on("exit", (c) => resolve(c ?? 1));
      });
      if (code !== 0) process.exitCode = code;
      return null;
    },
    format() {
      return "";
    },
  });
}

export const evalCmd = scriptCommand("eval", "memory-eval.mjs", "Retrieval + routing eval against known-answer cases; writes a scorecard.", "lifecycle");
export const doctor = scriptCommand("doctor", "doctor.mjs", "Read-only health check: Node, registry, vaults, hooks, weekly loop.");
export const setupVault = scriptCommand("setup-vault", "setup-vault.mjs", "Create a vault skeleton, register it, route project slugs to it.");
export const bootstrap = scriptCommand("bootstrap", "bootstrap.mjs", "Fresh-machine install: build, capture hook, weekly command, settings.");
