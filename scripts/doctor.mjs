#!/usr/bin/env node

/**
 * Read-only health check for an accretion install. Prints a PASS / WARN / FAIL
 * checklist with a fix hint for anything that isn't right. Exits non-zero if
 * any hard check FAILs. Built-ins only. Honors CLAUDE_HOME and VAULTS_CONFIG.
 *
 * Usage: accretion doctor   (or node scripts/doctor.mjs)
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { hasSessionJournalHook, hasPromptRecallHook } from "./lib/settings-merge.mjs";
import { expandHome } from "./lib/expand-home.mjs";

const REPO =
  process.env.ACCRETION_HOME ||
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLAUDE_HOME = expandHome(process.env.CLAUDE_HOME || path.join(os.homedir(), ".claude"));
const CONFIG_PATH = path.join(os.homedir(), ".config", "accretion", "vaults.json");
const LEGACY_CONFIG = path.join(os.homedir(), ".config", "obsidian-mcp", "vaults.json");
const VAULTS_CONFIG = process.env.VAULTS_CONFIG
  ? expandHome(process.env.VAULTS_CONFIG)
  : fs.existsSync(CONFIG_PATH)
    ? CONFIG_PATH
    : fs.existsSync(LEGACY_CONFIG)
      ? LEGACY_CONFIG
      : CONFIG_PATH;
const MIN_NODE_MAJOR = 20;
// Weekly schedule + a sleeping-Mac allowance. Past this the job is not running.
const MAX_RUN_AGE_DAYS = 10;
// context assembly caps at 20k tokens across all briefs; ~4 chars/token.
const BRIEF_WARN_KB = 32;
const BRIEF_FAIL_KB = 64;
const CLI = path.join(REPO, "dist", "cli", "main.js");

let failures = 0;
const pass = (m) => console.log(`  ✓ ${m}`);
const warn = (m, hint) => console.log(`  ! ${m}${hint ? `\n      ↳ ${hint}` : ""}`);
const fail = (m, hint) => { failures++; console.log(`  ✗ ${m}${hint ? `\n      ↳ ${hint}` : ""}`); };

console.log(`accretion doctor\n  repo: ${REPO}\n  CLAUDE_HOME: ${CLAUDE_HOME}\n  vaults.json: ${VAULTS_CONFIG}\n`);

// 1. Node
const major = Number(process.versions.node.split(".")[0]);
if (major >= MIN_NODE_MAJOR) pass(`Node ${process.versions.node} (>= ${MIN_NODE_MAJOR})`);
else fail(`Node ${process.versions.node} too old`, `install Node >= ${MIN_NODE_MAJOR} (see .nvmrc)`);

// 2. Build
if (fs.existsSync(CLI)) pass("dist/ is built (CLI present)");
else fail("dist/cli/main.js not built", "run `npm run build`");
for (const h of ["session-journal.mjs", "prompt-recall.mjs"]) {
  if (!fs.existsSync(path.join(REPO, "dist", "hooks", h))) warn(`dist/hooks/${h} not built`, "run `npm run build`");
}

// 3. accretion on PATH
let onPath = null;
try {
  onPath = execFileSync("sh", ["-c", "command -v accretion"], { encoding: "utf8" }).trim() || null;
} catch {
  /* not found */
}
if (onPath) pass(`accretion on PATH (${onPath})`);
else warn("`accretion` is not on PATH", "run `node scripts/bootstrap.mjs` (links ~/.local/bin/accretion), or add plugin/bin to PATH");

// 4. Registry
let vaults = null;
if (VAULTS_CONFIG === LEGACY_CONFIG) {
  warn(`registry read from legacy path ${LEGACY_CONFIG}`, `copy it to ${CONFIG_PATH} (bootstrap does this)`);
}
if (!fs.existsSync(VAULTS_CONFIG)) {
  fail("vaults.json not found", "run `accretion setup-vault --id <name> --path <abs> --default`");
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
for (const v of vaults ?? []) {
  const p = v.path ? path.resolve(expandHome(v.path)) : "";
  if (!p || !fs.existsSync(p)) { fail(`vault "${v.id}" path missing: ${v.path}`, "create it or fix vaults.json"); continue; }
  v.path = p;
  if (!fs.existsSync(path.join(p, ".mcp"))) warn(`vault "${v.id}" has no .mcp/ dir`, "re-run setup-vault for it");
  else pass(`vault "${v.id}" → ${p}`);
}

// 5. Install mode. Plugin mode = ~/.claude/skills/accretion is (a link to) the
// plugin directory; Claude Code then provides hooks, skills, bin and MCP itself.
// Hooks mode = files copied into ~/.claude/hooks and wired in settings.json.
const pluginDest = path.join(CLAUDE_HOME, "skills", "accretion");
const pluginMode = fs.existsSync(path.join(pluginDest, ".claude-plugin", "plugin.json"));
const hooksDir = path.join(CLAUDE_HOME, "hooks");
const settingsPath = path.join(CLAUDE_HOME, "settings.json");
let settings = null;
if (fs.existsSync(settingsPath)) {
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  } catch (e) {
    fail(`settings.json not valid JSON: ${e.message}`, "fix the syntax");
  }
}
if (pluginMode) {
  let target = pluginDest;
  try { target = fs.readlinkSync(pluginDest); } catch { /* real dir */ }
  pass(`plugin installed at ${pluginDest}${target !== pluginDest ? ` → ${target}` : ""} (hooks, skills, bin, MCP from the plugin)`);
  if (target !== pluginDest && path.resolve(target) !== path.join(REPO, "plugin")) {
    warn(`plugin link points at a different checkout than this repo`, `expected ${path.join(REPO, "plugin")}`);
  }
  if (settings && (hasSessionJournalHook(settings) || hasPromptRecallHook(settings))) {
    warn("settings.json still wires accretion hooks; with the plugin installed they fire twice", "run `node scripts/bootstrap.mjs` (plugin mode removes them, with a backup)");
  }
  for (const name of ["memory", "memory-weekly"]) {
    if (fs.existsSync(path.join(REPO, "plugin", "skills", name, "SKILL.md"))) pass(`plugin skill: /accretion:${name}`);
    else fail(`plugin skill missing: ${name}`, "the checkout is incomplete");
  }
  if (fs.existsSync(path.join(CLAUDE_HOME, "commands", "memory-weekly.md"))) {
    warn("~/.claude/commands/memory-weekly.md still present; /memory-weekly and /accretion:memory-weekly both exist", "run `node scripts/bootstrap.mjs` to retire it");
  }
} else {
  for (const h of ["session-journal.mjs", "prompt-recall.mjs"]) {
    if (fs.existsSync(path.join(hooksDir, h))) pass(`hook installed: ${h}`);
    else warn(`hook not installed: ${h}`, "run `node scripts/bootstrap.mjs` (plugin mode) or `--install hooks`");
  }
  if (!settings) {
    warn("no settings.json", "run `node scripts/bootstrap.mjs`");
  } else {
    if (hasSessionJournalHook(settings)) pass("SessionEnd capture hook wired");
    else warn("SessionEnd capture hook not wired", "run `node scripts/bootstrap.mjs`");
    if (hasPromptRecallHook(settings)) pass("UserPromptSubmit recall hook wired");
    else warn("UserPromptSubmit recall hook not wired", "run `node scripts/bootstrap.mjs`");
  }
  for (const name of ["memory", "memory-weekly"]) {
    const p = path.join(CLAUDE_HOME, "skills", name, "SKILL.md");
    if (fs.existsSync(p)) pass(`skill installed: ${name}`);
    else warn(`skill not installed: ${name}`, "run `node scripts/bootstrap.mjs`");
  }
}
const mapPath = process.env.PROJECT_VAULT_MAP
  ? expandHome(process.env.PROJECT_VAULT_MAP)
  : path.join(hooksDir, "project-vault-map.json");
if (fs.existsSync(mapPath)) {
  try {
    const map = JSON.parse(fs.readFileSync(mapPath, "utf8"));
    const mapped = Object.keys(map).filter((k) => k !== "_default" && k !== "_comment" && map[k]);
    pass(`project map: ${mapped.length} slug(s) mapped, _default ${map._default ? `"${map._default}" (capture everything)` : "null (opt-in)"}`);
  } catch (e) {
    fail(`project map not valid JSON: ${e.message}`, `fix ${mapPath}`);
  }
} else {
  warn("no project map; capture and recall are off everywhere", `run \`accretion setup-vault --project <slug>\` or seed ${mapPath}`);
}

// 7. Pipeline liveness per vault. Everything above answers "is this installed?";
// this answers "is it still running?", which is how the pipeline has died in
// silence before: a hook that vanished, an agent generated but never loaded.
console.log("");
const hasRuns = (v) => {
  const dir = path.join(v.path, "sessions", "digests", "_runs");
  return fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f.endsWith(".md"));
};

if (process.platform === "darwin") {
  const committerLabels = ["com.accretion.committer", "com.vault.committer"];
  const loaded = committerLabels.find((label) => {
    try {
      execFileSync("launchctl", ["print", `gui/${process.getuid()}/${label}`], { stdio: "ignore", timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  });
  if (loaded) pass(`committer agent loaded (${loaded})`);
  else warn("no committer agent loaded; vault commits depend on the capture hook alone", "node scripts/bootstrap.mjs --committer, then launchctl bootstrap");
}

for (const v of vaults ?? []) {
  if (!v.path || !fs.existsSync(v.path)) continue;
  const runsDir = path.join(v.path, "sessions", "digests", "_runs");
  const runs = fs.existsSync(runsDir) ? fs.readdirSync(runsDir).filter((f) => f.endsWith(".md")) : [];
  const managed = runs.length > 0;
  const setupHint = `accretion setup-vault --id ${v.id} --path ${v.path} --launchd`;

  if (process.platform === "darwin") {
    const label = `com.memory-weekly.${v.id}`;
    let loaded = false;
    try {
      execFileSync("launchctl", ["print", `gui/${process.getuid()}/${label}`], { stdio: "ignore", timeout: 5000 });
      loaded = true;
    } catch {
      /* not loaded */
    }
    if (loaded) pass(`weekly agent loaded (${label})`);
    else if (managed) fail(`weekly agent not loaded (${label}); this vault is curated but unscheduled`, `${setupHint}, then cp to ~/Library/LaunchAgents/ and \`launchctl bootstrap\``);
    else warn(`vault "${v.id}": no weekly agent (never curated)`, setupHint);
  }

  if (!managed) {
    warn(`vault "${v.id}": no memory-run report has ever been written`, `bin/memory-weekly-run.sh ${v.id}`);
  } else {
    const newest = Math.max(...runs.map((f) => fs.statSync(path.join(runsDir, f)).mtimeMs));
    const days = Math.floor((Date.now() - newest) / 86_400_000);
    if (days <= MAX_RUN_AGE_DAYS) pass(`vault "${v.id}": last memory-weekly run ${days}d ago`);
    else fail(`vault "${v.id}": last memory-weekly run was ${days}d ago (limit ${MAX_RUN_AGE_DAYS}d)`, `check \`launchctl print\` and ~/Library/Logs/memory-weekly/${v.id}`);
  }

  // Digest backlog, through the same command the weekly run uses.
  if (fs.existsSync(CLI)) {
    try {
      const raw = execFileSync(process.execPath, [CLI, "digest-candidates", "--vault", v.id], {
        encoding: "utf8", timeout: 60_000, maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, VAULTS_CONFIG, LOG_LEVEL: "error" },
      });
      const pending = (JSON.parse(raw).groups ?? []).filter((g) => g.exists === false);
      if (pending.length === 0) pass(`vault "${v.id}": no digest backlog`);
      else warn(`vault "${v.id}": ${pending.length} project-week(s) awaiting a digest`, pending.map((g) => `${g.period}-${g.project}`).join(", "));
    } catch (e) {
      warn(`vault "${v.id}": could not check digest backlog`, String(e.message).split("\n")[0]);
    }
  }

  const notes = collectMarkdown(v.path);

  // Derived .mcp/ files must stay out of the vault's git history. `accretion commit`
  // unstages them regardless, but a hand-run `git add -A` would not.
  if (fs.existsSync(path.join(v.path, ".git"))) {
    const ignore = fs.existsSync(path.join(v.path, ".gitignore")) ? fs.readFileSync(path.join(v.path, ".gitignore"), "utf8") : "";
    const missing = [".mcp/search-index.json", ".mcp/embeddings.json", ".mcp/search-log.jsonl", ".mcp/recall-log.jsonl"].filter((f) => !ignore.split("\n").includes(f));
    if (missing.length === 0) pass(`vault "${v.id}": derived .mcp files ignored`);
    else warn(`vault "${v.id}": .gitignore lacks ${missing.join(", ")}`, "append them; `accretion commit` unstages them but plain git will not");
  }

  // Embedding freshness: a stale index keeps answering without recent notes.
  const embeddings = path.join(v.path, ".mcp", "embeddings.json");
  if (fs.existsSync(embeddings)) {
    const built = fs.statSync(embeddings).mtimeMs;
    const newer = notes.filter((n) => fs.statSync(n).mtimeMs > built).length;
    if (newer === 0) pass(`vault "${v.id}": embedding index current`);
    else warn(`vault "${v.id}": ${newer} note(s) changed since the embedding index was built`, "any `accretion search` with embeddings on refreshes it");
  }

  // Brief size: one oversized brief starves every other topic in assembled context.
  for (const n of notes) {
    if (!path.basename(n).startsWith("brief-")) continue;
    const kb = fs.statSync(n).size / 1024;
    const rel = path.relative(v.path, n);
    if (kb > BRIEF_FAIL_KB) fail(`brief too large: ${rel} (${Math.round(kb)} KB)`, "split into a routing brief plus linked deep-dives");
    else if (kb > BRIEF_WARN_KB) warn(`brief getting large: ${rel} (${Math.round(kb)} KB)`, "consider splitting before it crowds out other topics");
  }
}

console.log(`\n${failures === 0 ? "✓ doctor: no hard failures" : `✗ doctor: ${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);

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
