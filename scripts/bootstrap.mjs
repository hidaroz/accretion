#!/usr/bin/env node

/**
 * Fresh-machine bootstrap for accretion. Idempotent. Built-ins only,
 * so it runs before `npm install`. Wires the per-machine pieces that
 * setup-vault (per-project) does not:
 *   1. verify Node version
 *   2. npm install + npm run build   (skip with --skip-install)
 *   3. copy the SessionEnd capture hook into ~/.claude/hooks/
 *   4. merge the SessionEnd hook into ~/.claude/settings.json (backed up, idempotent)
 *   5. optionally install a launchd agent that auto-starts the server (--server-autostart, macOS)
 *
 * Then run `accretion-setup-vault` per project and `accretion-doctor` to verify.
 *
 * Usage: node scripts/bootstrap.mjs [--skip-install] [--server-autostart]
 * Env:   CLAUDE_HOME (default ~/.claude) — override to test against a temp dir.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mergeSessionEndHook, sessionJournalCommand } from "./lib/settings-merge.mjs";

// See doctor.mjs — ACCRETION_HOME overrides script-relative resolution for
// callers that are not running from a checkout.
const REPO =
  process.env.ACCRETION_HOME ||
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const SKIP_INSTALL = args.has("--skip-install");
const SERVER_AUTOSTART = args.has("--server-autostart");
const CLAUDE_HOME = process.env.CLAUDE_HOME || path.join(os.homedir(), ".claude");
const MIN_NODE_MAJOR = 20;

const log = (m) => console.log(m);
const ok = (m) => console.log(`  ✓ ${m}`);
const info = (m) => console.log(`  • ${m}`);
const die = (m) => { console.error(`✗ ${m}`); process.exit(1); };

log(`accretion bootstrap\n  repo: ${REPO}\n  CLAUDE_HOME: ${CLAUDE_HOME}\n`);

// 1. Node version
const major = Number(process.versions.node.split(".")[0]);
if (Number.isFinite(major) && major < MIN_NODE_MAJOR) {
  die(`Node ${process.versions.node} is too old; need >= ${MIN_NODE_MAJOR}. (see .nvmrc)`);
}
ok(`Node ${process.versions.node}`);

// 2. install + build
if (SKIP_INSTALL) {
  info("skipping npm install / build (--skip-install)");
} else {
  log("Installing dependencies and building…");
  execSync("npm install", { cwd: REPO, stdio: "inherit" });
  execSync("npm run build", { cwd: REPO, stdio: "inherit" });
  ok("installed + built");
}

// 3. capture hook
const hooksDir = path.join(CLAUDE_HOME, "hooks");
fs.mkdirSync(hooksDir, { recursive: true });
fs.copyFileSync(
  path.join(REPO, "hooks", "session-journal.mjs"),
  path.join(hooksDir, "session-journal.mjs")
);
ok(`installed capture hook → ${path.join(hooksDir, "session-journal.mjs")}`);

const mapDest = path.join(hooksDir, "project-vault-map.json");
if (!fs.existsSync(mapDest)) {
  fs.copyFileSync(path.join(REPO, "hooks", "project-vault-map.json.example"), mapDest);
  ok(`seeded ${mapDest}`);
} else {
  info(`kept existing ${mapDest}`);
}

// 4. settings.json SessionEnd hook (idempotent, backed up)
const settingsPath = path.join(CLAUDE_HOME, "settings.json");
let settings = {};
if (fs.existsSync(settingsPath)) {
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  } catch (e) {
    die(`could not parse ${settingsPath}: ${e.message} (fix or move it, then re-run)`);
  }
}
const cmd = sessionJournalCommand(hooksDir);
const { settings: merged, changed } = mergeSessionEndHook(settings, cmd);
if (changed) {
  if (fs.existsSync(settingsPath)) {
    const backup = `${settingsPath}.bak-${Date.now()}`;
    fs.copyFileSync(settingsPath, backup);
    info(`backed up settings.json → ${path.basename(backup)}`);
  }
  fs.mkdirSync(CLAUDE_HOME, { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + "\n");
  ok(`wired SessionEnd hook into ${settingsPath}`);
} else {
  info("SessionEnd capture hook already wired");
}

// 5. optional server auto-start (macOS launchd)
if (SERVER_AUTOSTART) {
  if (process.platform !== "darwin") {
    info("--server-autostart is macOS-only; skipped");
  } else {
    const template = fs.readFileSync(
      path.join(REPO, "infra", "launchd", "mcp-server.plist.template"),
      "utf8"
    );
    const label = "com.accretion.server";
    const logDir = path.join(os.homedir(), "Library", "Logs", "accretion");
    fs.mkdirSync(logDir, { recursive: true });
    const plist = template
      .replaceAll("__LABEL__", label)
      .replaceAll("__WRAPPER__", path.join(REPO, "bin", "mcp-server-run.sh"))
      .replaceAll("__LOGDIR__", logDir);
    const dest = path.join(os.homedir(), "Library", "LaunchAgents", `${label}.plist`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, plist);
    ok(`wrote ${dest}`);
    info(`load it with:  launchctl load -w ${dest}`);
    info(`(ensure ${path.join(REPO, ".env")} has API_KEY + VAULTS_CONFIG first)`);
  }
}

log(`
Next steps:
  1. Configure a vault:   node scripts/setup-vault.mjs --id <name> --path <abs-path> --default
  2. Set secrets:         cp .env.example .env  &&  edit API_KEY (+ VAULTS_CONFIG)
  3. Start the server:    npm start
  4. Register your MCP client (see README → "Register with your MCP client")
  5. Verify everything:   node scripts/doctor.mjs
`);
