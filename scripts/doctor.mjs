#!/usr/bin/env node

/**
 * Read-only health check for an obsidian-mcp-server install. Verifies the pieces
 * a fresh machine needs and prints a PASS / WARN / FAIL checklist with a fix hint
 * for anything that isn't right. Exits non-zero if any hard check FAILs.
 * Built-ins only. Honors CLAUDE_HOME and VAULTS_CONFIG.
 *
 * Usage: node scripts/doctor.mjs
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { hasSessionJournalHook } from "./lib/settings-merge.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLAUDE_HOME = process.env.CLAUDE_HOME || path.join(os.homedir(), ".claude");
const VAULTS_CONFIG =
  process.env.VAULTS_CONFIG || path.join(os.homedir(), ".config", "obsidian-mcp", "vaults.json");
const PORT = process.env.PORT || "3001";
const HOST = process.env.HOST || "127.0.0.1";
const MIN_NODE_MAJOR = 20;
// Weekly schedule + a sleeping-Mac allowance. Anything past this means the job
// is not running, not that it ran late.
const MAX_RUN_AGE_DAYS = 10;
// get_context's ceiling is 20k tokens across all briefs it assembles; ~4 chars
// per token puts a single brief's share well under 32 KB.
const BRIEF_WARN_KB = 32;
const BRIEF_FAIL_KB = 64;

let failures = 0;
const pass = (m) => console.log(`  ✓ ${m}`);
const warn = (m, hint) => console.log(`  ! ${m}${hint ? `\n      ↳ ${hint}` : ""}`);
const fail = (m, hint) => { failures++; console.log(`  ✗ ${m}${hint ? `\n      ↳ ${hint}` : ""}`); };

console.log(`obsidian-mcp-server doctor\n  repo: ${REPO}\n  CLAUDE_HOME: ${CLAUDE_HOME}\n  vaults.json: ${VAULTS_CONFIG}\n`);

// 1. Node version
const major = Number(process.versions.node.split(".")[0]);
if (major >= MIN_NODE_MAJOR) pass(`Node ${process.versions.node} (>= ${MIN_NODE_MAJOR})`);
else fail(`Node ${process.versions.node} too old`, `install Node >= ${MIN_NODE_MAJOR} (see .nvmrc)`);

// 2. Build present
if (fs.existsSync(path.join(REPO, "dist", "index.js"))) pass("dist/ is built");
else warn("dist/ not built", "run `npm run build`");

// 3. vaults.json present + valid
let vaults = null;
if (!fs.existsSync(VAULTS_CONFIG)) {
  fail("vaults.json not found", "run `node scripts/setup-vault.mjs --id <name> --path <abs> --default`");
} else {
  try {
    const parsed = JSON.parse(fs.readFileSync(VAULTS_CONFIG, "utf8"));
    vaults = Array.isArray(parsed?.vaults) ? parsed.vaults : null;
    if (!vaults || vaults.length === 0) fail("vaults.json has no vaults", "add one with setup-vault");
    else {
      const defaults = vaults.filter((v) => v.default).length;
      if (defaults > 1) fail("vaults.json has >1 default vault", "mark exactly one `default: true`");
      else pass(`vaults.json valid (${vaults.length} vault${vaults.length === 1 ? "" : "s"})`);
    }
  } catch (e) {
    fail(`vaults.json is not valid JSON: ${e.message}`, "fix the syntax");
  }
}

// 3b. each vault path exists + has .mcp/
for (const v of vaults ?? []) {
  if (!v.path || !path.isAbsolute(v.path)) { fail(`vault "${v.id}" path is not absolute`, "use an absolute path"); continue; }
  if (!fs.existsSync(v.path)) { fail(`vault "${v.id}" path missing: ${v.path}`, "create it or fix vaults.json"); continue; }
  if (!fs.existsSync(path.join(v.path, ".mcp"))) warn(`vault "${v.id}" has no .mcp/ dir`, "re-run setup-vault for it");
  else pass(`vault "${v.id}" → ${v.path}`);
}

// 4. capture hook installed
if (fs.existsSync(path.join(CLAUDE_HOME, "hooks", "session-journal.mjs"))) pass("capture hook installed");
else warn("capture hook not installed", "run `node scripts/bootstrap.mjs`");

// 5. SessionEnd wired
const settingsPath = path.join(CLAUDE_HOME, "settings.json");
if (!fs.existsSync(settingsPath)) {
  warn("no settings.json", "run `node scripts/bootstrap.mjs` to wire the SessionEnd hook");
} else {
  try {
    if (hasSessionJournalHook(JSON.parse(fs.readFileSync(settingsPath, "utf8")))) pass("SessionEnd capture hook wired");
    else warn("SessionEnd hook not wired", "run `node scripts/bootstrap.mjs`");
  } catch (e) {
    fail(`settings.json not valid JSON: ${e.message}`, "fix the syntax");
  }
}

// 6. server reachable (optional)
try {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 1500);
  const res = await fetch(`http://${HOST}:${PORT}/health`, { signal: ctrl.signal });
  clearTimeout(t);
  if (res.ok) pass(`server reachable at http://${HOST}:${PORT}/health`);
  else warn(`server returned HTTP ${res.status}`, "check server logs");
} catch {
  warn(`server not reachable at http://${HOST}:${PORT}`, "start it with `npm start` (ok if intentionally off)");
}

// 7. Pipeline liveness.
//
// Everything above answers "is this installed?". None of it answers "is it
// still running?" — and that is how this pipeline has died, twice, in silence:
// once when the capture hook vanished (2026-07-28), once when the weekly agent
// was generated but never loaded (unnoticed for six weeks, found 2026-08-05).
// Nothing broke loudly either time. These checks are the alarm.
console.log("");

// 7a. The command the wrapper invokes. bootstrap.mjs does not install it, so a
// fresh machine has a scheduled job calling a slash command that does not exist.
const commandPath = path.join(CLAUDE_HOME, "commands", "memory-weekly.md");
if (fs.existsSync(commandPath)) pass("/memory-weekly command installed");
else
  fail(
    "/memory-weekly command missing",
    `create ${commandPath} — the launchd wrapper runs \`claude -p "/memory-weekly …"\` and fails without it`
  );

for (const v of vaults ?? []) {
  if (!v.path || !fs.existsSync(v.path)) continue;

  // 7b/7c. Weekly curation liveness.
  //
  // A vault that has never had a run has simply not been set up — that is a
  // WARN. A vault that has run before and then stopped has *regressed*, and
  // that is the state worth shouting about. Failing on both would keep an
  // unmanaged vault permanently red, and a check that is always red is a check
  // nobody reads.
  const runsDir = path.join(v.path, "sessions", "digests", "_runs");
  const runs = fs.existsSync(runsDir)
    ? fs.readdirSync(runsDir).filter((f) => f.endsWith(".md"))
    : [];
  const managed = runs.length > 0;
  const setupHint =
    `node scripts/setup-vault.mjs --id ${v.id} --path ${v.path} --launchd`;

  if (process.platform === "darwin") {
    const label = `com.memory-weekly.${v.id}`;
    let loaded = false;
    try {
      execFileSync("launchctl", ["print", `gui/${process.getuid()}/${label}`], {
        stdio: "ignore",
        timeout: 5000,
      });
      loaded = true;
    } catch {
      /* not loaded */
    }
    if (loaded) pass(`weekly agent loaded (${label})`);
    else if (managed)
      fail(
        `weekly agent not loaded (${label}) — this vault is curated but unscheduled`,
        `${setupHint}, then cp to ~/Library/LaunchAgents/ and \`launchctl bootstrap\``
      );
    else warn(`vault "${v.id}": no weekly agent (never curated)`, setupHint);
  }

  if (!managed) {
    warn(`vault "${v.id}": no memory-run report has ever been written`, `bin/memory-weekly-run.sh ${v.id}`);
  } else {
    const newest = Math.max(...runs.map((f) => fs.statSync(path.join(runsDir, f)).mtimeMs));
    const days = Math.floor((Date.now() - newest) / 86_400_000);
    if (days <= MAX_RUN_AGE_DAYS) pass(`vault "${v.id}": last memory-weekly run ${days}d ago`);
    else
      fail(
        `vault "${v.id}": last memory-weekly run was ${days}d ago (limit ${MAX_RUN_AGE_DAYS}d)`,
        `the weekly job is not running — check \`launchctl print\` and ~/Library/Logs/memory-weekly/${v.id}`
      );
  }

  const notes = collectMarkdown(v.path);

  // 7d. Digest backlog. Delegates to the same script the weekly run uses, so
  // the grouping rule has exactly one definition.
  if (fs.existsSync(path.join(REPO, "dist", "index.js"))) {
    try {
      const raw = execFileSync(
        process.execPath,
        [path.join(REPO, "scripts", "memory-digest-candidates.mjs"), "--vault", v.id],
        { encoding: "utf8", timeout: 60_000, maxBuffer: 64 * 1024 * 1024 }
      );
      const pending = (JSON.parse(raw).groups ?? []).filter((g) => g.exists === false);
      if (pending.length === 0) pass(`vault "${v.id}": no digest backlog`);
      else
        warn(
          `vault "${v.id}": ${pending.length} project-week(s) awaiting a digest`,
          pending.map((g) => `${g.period}-${g.project}`).join(", ")
        );
    } catch (e) {
      warn(`vault "${v.id}": could not check digest backlog`, e.message.split("\n")[0]);
    }
  }

  // 7e. Embedding freshness. A stale index is invisible: semantic search keeps
  // answering, just without anything written since the last build.
  const embeddings = path.join(v.path, ".mcp", "embeddings.json");
  if (fs.existsSync(embeddings)) {
    const built = fs.statSync(embeddings).mtimeMs;
    const newer = notes.filter((n) => fs.statSync(n).mtimeMs > built).length;
    if (newer === 0) pass(`vault "${v.id}": embedding index current`);
    else
      warn(
        `vault "${v.id}": ${newer} note(s) changed since the embedding index was built`,
        "restart the server to rebuild, or it will keep answering without them"
      );
  }

  // 7f. Brief size. get_context concatenates whole briefs under a token budget,
  // so one oversized brief starves every other topic in an assembled context.
  // brief-observability.md reached 78 KB — more than the 20k-token ceiling
  // the tool allows in total.
  for (const n of notes) {
    if (!path.basename(n).startsWith("brief-")) continue;
    const kb = fs.statSync(n).size / 1024;
    const rel = path.relative(v.path, n);
    if (kb > BRIEF_FAIL_KB)
      fail(
        `brief too large: ${rel} (${Math.round(kb)} KB)`,
        "split into a routing brief plus linked deep-dives — it cannot fit a get_context budget"
      );
    else if (kb > BRIEF_WARN_KB)
      warn(`brief getting large: ${rel} (${Math.round(kb)} KB)`, "consider splitting before it crowds out other topics");
  }
}

console.log(`\n${failures === 0 ? "✓ doctor: no hard failures" : `✗ doctor: ${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);

/** Every .md in the vault, excluding Obsidian's own config. */
function collectMarkdown(root) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith(".md")) out.push(full);
    }
  };
  walk(root);
  return out;
}
