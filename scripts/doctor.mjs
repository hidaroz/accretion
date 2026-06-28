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
import { hasSessionJournalHook } from "./lib/settings-merge.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLAUDE_HOME = process.env.CLAUDE_HOME || path.join(os.homedir(), ".claude");
const VAULTS_CONFIG =
  process.env.VAULTS_CONFIG || path.join(os.homedir(), ".config", "obsidian-mcp", "vaults.json");
const PORT = process.env.PORT || "3001";
const HOST = process.env.HOST || "127.0.0.1";
const MIN_NODE_MAJOR = 20;

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

console.log(`\n${failures === 0 ? "✓ doctor: no hard failures" : `✗ doctor: ${failures} failure(s)`}`);
process.exit(failures === 0 ? 0 : 1);
