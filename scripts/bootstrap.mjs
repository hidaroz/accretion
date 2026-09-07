#!/usr/bin/env node

/**
 * Fresh-machine bootstrap for accretion. Idempotent, built-ins only, backs up
 * anything it overwrites. Installs the same pieces the Claude Code plugin
 * carries, into the per-user locations Claude Code reads without a plugin:
 *   1. verify Node version
 *   2. npm install + npm run build          (skip with --skip-install)
 *   3. hooks: dist/hooks/*.mjs → ~/.claude/hooks/   (capture + passive recall)
 *   4. project map seeded if absent
 *   5. skills: plugin/skills/* → ~/.claude/skills/  (accretion, memory-weekly)
 *   6. settings.json: SessionEnd + UserPromptSubmit wired (backed up)
 *   7. `accretion` on PATH: ~/.local/bin/accretion → plugin/bin/accretion
 *   8. registry migration: ~/.config/obsidian-mcp/vaults.json → ~/.config/accretion/
 *   9. optional launchd committer agent (--committer, macOS)
 *
 * Install modes (--install):
 *   plugin (default)  symlink plugin/ into ~/.claude/skills/accretion; Claude Code loads it
 *                     as a plugin every session (skills, hooks, bin, MCP). Nothing copied.
 *   hooks             copy hooks into ~/.claude/hooks and wire settings.json; copy skills.
 *                     For clients or setups that do not load skills-dir plugins.
 *
 * Usage: node scripts/bootstrap.mjs [--install plugin|hooks] [--skip-install] [--committer] [--bin-dir <dir>]
 * Env:   CLAUDE_HOME (default ~/.claude), ACCRETION_HOME (default: this checkout)
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  mergeSessionEndHook,
  mergePromptRecallHook,
  sessionJournalCommand,
  promptRecallCommand,
} from "./lib/settings-merge.mjs";
import { expandHome } from "./lib/expand-home.mjs";

const REPO =
  process.env.ACCRETION_HOME ||
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const valueOf = (f) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : undefined);
const SKIP_INSTALL = has("--skip-install");
const INSTALL = valueOf("--install") || "plugin";
if (!["plugin", "hooks"].includes(INSTALL)) die(`--install must be plugin or hooks, got ${INSTALL}`);
const COMMITTER = has("--committer");
const CLAUDE_HOME = expandHome(process.env.CLAUDE_HOME || path.join(os.homedir(), ".claude"));
const BIN_DIR = expandHome(valueOf("--bin-dir") || path.join(os.homedir(), ".local", "bin"));
const CONFIG_DIR = path.join(os.homedir(), ".config", "accretion");
const LEGACY_CONFIG = path.join(os.homedir(), ".config", "obsidian-mcp", "vaults.json");
const MIN_NODE_MAJOR = 20;

const log = (m) => console.log(m);
const ok = (m) => console.log(`  ✓ ${m}`);
const info = (m) => console.log(`  • ${m}`);
const die = (m) => { console.error(`✗ ${m}`); process.exit(1); };

/** Copy src → dest, backing up a differing existing file first. Returns "installed" | "unchanged" | "replaced". */
function installFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest)) {
    const same = fs.readFileSync(dest).equals(fs.readFileSync(src));
    if (same) return "unchanged";
    const backup = `${dest}.bak-${Date.now()}`;
    fs.copyFileSync(dest, backup);
    fs.copyFileSync(src, dest);
    return `replaced (backup ${path.basename(backup)})`;
  }
  fs.copyFileSync(src, dest);
  return "installed";
}

log(`accretion bootstrap\n  repo: ${REPO}\n  CLAUDE_HOME: ${CLAUDE_HOME}\n  bin: ${BIN_DIR}\n`);

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
for (const f of ["dist/cli/main.js", "dist/hooks/session-journal.mjs", "dist/hooks/prompt-recall.mjs"]) {
  if (!fs.existsSync(path.join(REPO, f))) die(`${f} missing; run \`npm run build\` first`);
}

if (INSTALL === "hooks") {
// 3. hooks
const hooksDir = path.join(CLAUDE_HOME, "hooks");
for (const f of ["session-journal.mjs", "prompt-recall.mjs"]) {
  const r = installFile(path.join(REPO, "dist", "hooks", f), path.join(hooksDir, f));
  ok(`hook ${f}: ${r}`);
}

// 4. project map (legacy location is still the canonical one; the engine reads it)
var mapDest = path.join(hooksDir, "project-vault-map.json");
if (!fs.existsSync(mapDest)) {
  fs.copyFileSync(path.join(REPO, "hooks", "project-vault-map.json.example"), mapDest);
  ok(`seeded ${mapDest} (capture is opt-in: map a project slug to a vault id)`);
} else {
  info(`kept existing ${mapDest}`);
}

// 5. skills
for (const name of ["accretion", "memory-weekly"]) {
  const destDir = path.join(CLAUDE_HOME, "skills", name);
  try {
    const st = fs.lstatSync(destDir);
    if (st.isSymbolicLink()) {
      const target = fs.readlinkSync(destDir);
      fs.unlinkSync(destDir);
      info(`replaced symlink ${destDir} → ${target} with a real directory`);
    }
  } catch {
    /* absent */
  }
  const r = installFile(path.join(REPO, "plugin", "skills", name, "SKILL.md"), path.join(destDir, "SKILL.md"));
  ok(`skill ${name}: ${r}`);
}
// the old /memory-weekly command is superseded by the skill of the same name
const oldCmd = path.join(CLAUDE_HOME, "commands", "memory-weekly.md");
if (fs.existsSync(oldCmd)) {
  const backup = `${oldCmd}.bak-${Date.now()}`;
  fs.renameSync(oldCmd, backup);
  info(`retired ${oldCmd} (backup ${path.basename(backup)}); /memory-weekly is now the skill`);
}

// 6. settings.json hooks (idempotent, backed up)
const settingsPath = path.join(CLAUDE_HOME, "settings.json");
let settings = {};
if (fs.existsSync(settingsPath)) {
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  } catch (e) {
    die(`could not parse ${settingsPath}: ${e.message} (fix or move it, then re-run)`);
  }
}
let merged = mergeSessionEndHook(settings, sessionJournalCommand(hooksDir));
const recall = mergePromptRecallHook(merged.settings, promptRecallCommand(hooksDir));
const changed = merged.changed || recall.changed;
merged = recall;
if (changed) {
  if (fs.existsSync(settingsPath)) {
    const backup = `${settingsPath}.bak-${Date.now()}`;
    fs.copyFileSync(settingsPath, backup);
    info(`backed up settings.json → ${path.basename(backup)}`);
  }
  fs.mkdirSync(CLAUDE_HOME, { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(merged.settings, null, 2) + "\n");
  ok(`wired SessionEnd (capture) and UserPromptSubmit (recall) hooks into ${settingsPath}`);
} else {
  info("hooks already wired in settings.json");
}

}
else {
// 3-6 (plugin mode). One symlink; Claude Code discovers skills/, hooks/hooks.json,
// bin/ and .mcp.json from the manifest on every session. Updating the checkout
// updates the install.
const pluginSrc = path.join(REPO, "plugin");
const pluginDest = path.join(CLAUDE_HOME, "skills", "accretion");
fs.mkdirSync(path.dirname(pluginDest), { recursive: true });
try {
  const st = fs.lstatSync(pluginDest);
  if (st.isSymbolicLink()) {
    const cur = fs.readlinkSync(pluginDest);
    if (cur !== pluginSrc) { fs.unlinkSync(pluginDest); fs.symlinkSync(pluginSrc, pluginDest); ok(`relinked ${pluginDest} → ${pluginSrc}`); }
    else info(`plugin already linked at ${pluginDest}`);
  } else {
    const backup = `${pluginDest}.bak-${Date.now()}`;
    fs.renameSync(pluginDest, backup);
    fs.symlinkSync(pluginSrc, pluginDest);
    ok(`linked ${pluginDest} → ${pluginSrc} (previous directory moved to ${path.basename(backup)})`);
  }
} catch {
  fs.symlinkSync(pluginSrc, pluginDest);
  ok(`linked ${pluginDest} → ${pluginSrc}`);
}
// A hooks-mode install left behind would fire the capture hook twice.
const settingsPathP = path.join(CLAUDE_HOME, "settings.json");
if (fs.existsSync(settingsPathP)) {
  try {
    const s = JSON.parse(fs.readFileSync(settingsPathP, "utf8"));
    let stripped = 0;
    for (const ev of ["SessionEnd", "UserPromptSubmit"]) {
      const groups = Array.isArray(s?.hooks?.[ev]) ? s.hooks[ev] : [];
      const kept = groups.filter((g) => !(Array.isArray(g?.hooks) && g.hooks.some((h) => /session-journal\.mjs|prompt-recall\.mjs/.test(String(h?.command)))));
      stripped += groups.length - kept.length;
      if (kept.length !== groups.length) s.hooks[ev] = kept;
    }
    if (stripped > 0) {
      const backup = `${settingsPathP}.bak-${Date.now()}`;
      fs.copyFileSync(settingsPathP, backup);
      fs.writeFileSync(settingsPathP, JSON.stringify(s, null, 2) + "\n");
      ok(`removed ${stripped} settings.json hook entr${stripped === 1 ? "y" : "ies"} the plugin now provides (backup ${path.basename(backup)})`);
    }
  } catch (e) {
    die(`could not parse ${settingsPathP}: ${e.message}`);
  }
}
for (const stale of [path.join(CLAUDE_HOME, "commands", "memory-weekly.md"), path.join(CLAUDE_HOME, "skills", "memory-weekly")]) {
  try {
    const st = fs.lstatSync(stale);
    const backup = `${stale}.bak-${Date.now()}`;
    if (st.isSymbolicLink()) { fs.unlinkSync(stale); info(`removed symlink ${stale} (plugin provides /accretion:memory-weekly)`); }
    else { fs.renameSync(stale, backup); info(`retired ${stale} → ${path.basename(backup)} (plugin provides /accretion:memory-weekly)`); }
  } catch { /* absent */ }
}
var mapDest = path.join(CLAUDE_HOME, "hooks", "project-vault-map.json");
if (!fs.existsSync(mapDest)) {
  fs.mkdirSync(path.dirname(mapDest), { recursive: true });
  fs.copyFileSync(path.join(REPO, "hooks", "project-vault-map.json.example"), mapDest);
  ok(`seeded ${mapDest} (capture is opt-in: map a project slug to a vault id)`);
} else {
  info(`kept existing ${mapDest}`);
}

}

// 7. accretion on PATH
const shim = path.join(REPO, "plugin", "bin", "accretion");
const link = path.join(BIN_DIR, "accretion");
fs.mkdirSync(BIN_DIR, { recursive: true });
try {
  const current = fs.readlinkSync(link);
  if (current !== shim) {
    fs.unlinkSync(link);
    fs.symlinkSync(shim, link);
    ok(`relinked ${link} → ${shim} (was ${current})`);
  } else {
    info(`accretion already on PATH via ${link}`);
  }
} catch {
  if (fs.existsSync(link)) {
    const backup = `${link}.bak-${Date.now()}`;
    fs.renameSync(link, backup);
    info(`moved existing ${link} → ${path.basename(backup)}`);
  }
  fs.symlinkSync(shim, link);
  ok(`linked ${link} → ${shim}`);
}
if (!(process.env.PATH || "").split(path.delimiter).includes(BIN_DIR)) {
  info(`add ${BIN_DIR} to your PATH (it is not there in this shell)`);
}

// 8. registry migration
const config = path.join(CONFIG_DIR, "vaults.json");
if (!fs.existsSync(config) && fs.existsSync(LEGACY_CONFIG)) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.copyFileSync(LEGACY_CONFIG, config);
  ok(`migrated registry ${LEGACY_CONFIG} → ${config} (legacy file left in place)`);
} else if (fs.existsSync(config)) {
  info(`registry: ${config}`);
} else {
  info(`no registry yet: run \`accretion setup-vault --id <name> --path <abs> --default\``);
}

// 9. optional committer agent (macOS)
if (COMMITTER) {
  if (process.platform !== "darwin") {
    info("--committer is macOS-only (launchd); schedule `bin/vault-commit.sh` with cron elsewhere");
  } else {
    const label = "com.accretion.committer";
    const logDir = path.join(os.homedir(), "Library", "Logs", "accretion");
    fs.mkdirSync(logDir, { recursive: true });
    const plist = fs
      .readFileSync(path.join(REPO, "launchd", "vault-committer.plist.template"), "utf8")
      .replaceAll("__LABEL__", label)
      .replaceAll("__WRAPPER__", path.join(REPO, "bin", "vault-commit.sh"))
      .replaceAll("__LOGDIR__", logDir);
    const dest = path.join(os.homedir(), "Library", "LaunchAgents", `${label}.plist`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, plist);
    ok(`wrote ${dest}`);
    info(`load it:  launchctl bootstrap gui/$(id -u) "${dest}"`);
  }
}

log(`
Next steps:
  1. Register a vault:     accretion setup-vault --id <name> --path <abs-path> --default
  2. Map projects:         edit ${mapDest} (slug → vault id; _default null keeps capture opt-in)
  3. Verify:               accretion doctor
  4. Try it:               accretion search "how does routing abstain"
  Passive recall now runs on every prompt in a mapped project directory.
`);
