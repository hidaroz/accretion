#!/usr/bin/env node

/**
 * Onboard a new project vault: create the standard skeleton, register it in
 * vaults.json, route its project slug(s) to it in project-vault-map.json, and
 * optionally git-init and generate a launchd plist. Idempotent.
 *
 * Usage:
 *   node scripts/setup-vault.mjs --id acme --path ~/work/acme-vault \
 *     [--display "Acme"] [--project acme-foo,acme-bar] \
 *     [--default] [--git] [--push] [--launchd]
 *
 * Env overrides (also used by tests): VAULTS_CONFIG, --map <project-map path>.
 * New vaults default to gitAutoCommit:true, gitAutoPush:false (opt in with --push).
 *
 * Requires `npm run build` (imports compiled dist/).
 */

import fs from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./memory-lib.mjs";
import { expandHome } from "./lib/expand-home.mjs";
import {
  upsertVault,
  upsertProjectMap,
  SKELETON_DIRS,
  gitignoreContent,
  homeMocStub,
} from "../dist/vault/vault-onboarding.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));

function fail(msg) {
  console.error(`Error: ${msg}`);
  process.exit(1);
}
function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}
function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n");
}

if (typeof args.id !== "string") fail("--id <vaultId> is required");
if (typeof args.path !== "string") fail("--path <vault path> is required");

const id = args.id;
const vaultPath = path.resolve(expandHome(args.path));
const displayName = typeof args.display === "string" ? args.display : id;
const push = args.push === true;
const isDefault = args.default === true;

let slugs =
  typeof args.project === "string"
    ? args.project.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
if (slugs.length === 0) slugs = [path.basename(vaultPath)];

const VAULTS_CONFIG = expandHome(
  process.env.VAULTS_CONFIG ||
    path.join(homedir(), ".config", "accretion", "vaults.json")
);
const MAP_PATH = expandHome(
  typeof args.map === "string"
    ? args.map
    : path.join(homedir(), ".claude", "hooks", "project-vault-map.json")
);

// 1. Skeleton
for (const d of SKELETON_DIRS) {
  fs.mkdirSync(path.join(vaultPath, d), { recursive: true });
}

// 2. Seed files (only if absent — never clobber existing content)
const seed = (rel, content) => {
  const p = path.join(vaultPath, rel);
  if (!fs.existsSync(p)) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
};
seed(".mcp/brief-map.json", "{}\n");
seed(".gitignore", gitignoreContent());
seed("Home.md", homeMocStub(displayName));

// 3. Register in vaults.json
const cfg = readJson(VAULTS_CONFIG, { vaults: [] });
cfg.vaults = upsertVault(cfg.vaults || [], {
  id,
  path: vaultPath,
  displayName,
  gitAutoCommit: true,
  gitAutoPush: push,
  ...(isDefault ? { default: true } : {}),
});
writeJson(VAULTS_CONFIG, cfg);

// 4. Route project slug(s) → vault
writeJson(MAP_PATH, upsertProjectMap(readJson(MAP_PATH, {}), slugs, id));

// 5. Optional git init (never pushes)
//
// `add -A && commit` is safe in a repo this script just created, and reckless
// in one it did not: --path can legitimately point at an existing repo, since
// onboarding is advertised as idempotent and re-runnable. Committing there
// would sweep up every unstaged change the user had in flight, under a message
// about initializing a memory vault. So: only auto-commit a clean tree.
if (args.git === true) {
  // execFileSync, not execSync: displayName and vaultPath come from argv and
  // would otherwise be interpolated into a shell string, where a quote or a
  // backtick in either turns a commit message into arbitrary execution.
  const git = (gitArgs, opts = {}) =>
    execFileSync("git", ["-C", vaultPath, ...gitArgs], { stdio: "ignore", ...opts });

  try {
    const preexisting = fs.existsSync(path.join(vaultPath, ".git"));
    if (!preexisting) git(["init", "-q"]);

    const dirty = git(["status", "--porcelain"], {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();

    if (preexisting && dirty) {
      console.error(
        `git commit skipped: ${vaultPath} is an existing repo with uncommitted changes.\n` +
          `  Commit or stash them yourself — refusing to sweep unrelated work into ` +
          `"chore: initialize ${displayName} memory vault".`
      );
    } else if (dirty) {
      git(["add", "-A"]);
      git(["commit", "-q", "-m", `chore: initialize ${displayName} memory vault`]);
    }
  } catch (err) {
    console.error(`git init/commit skipped: ${err.message}`);
  }
}

// 6. Optional launchd plist for the autonomous weekly run
let plistOut = null;
if (args.launchd === true) {
  const label = `com.memory-weekly.${id}`;
  const logDir = path.join(homedir(), "Library", "Logs", "memory-weekly", id);
  fs.mkdirSync(logDir, { recursive: true });
  const tmpl = fs.readFileSync(
    path.join(REPO, "launchd", "memory-weekly.plist.template"),
    "utf8"
  );
  const filled = tmpl
    .replaceAll("__LABEL__", label)
    .replaceAll("__WRAPPER__", path.join(REPO, "bin", "memory-weekly-run.sh"))
    .replaceAll("__VAULT__", id)
    .replaceAll("__LOGDIR__", logDir);
  plistOut = path.join(REPO, "launchd", `${label}.plist`);
  fs.writeFileSync(plistOut, filled);
}

// 7. Summary
console.log(`✓ Vault '${id}' ready at ${vaultPath}`);
console.log(`  vaults.json: ${VAULTS_CONFIG} (gitAutoPush: ${push})`);
console.log(`  project map: ${MAP_PATH} (${slugs.join(", ")} → ${id})`);
if (plistOut) {
  console.log(`  launchd plist: ${plistOut}`);
  console.log(
    `  schedule it: cp "${plistOut}" ~/Library/LaunchAgents/ && launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/${path.basename(plistOut)}`
  );
}
console.log(
  `\nNext: work in a directory named one of [${slugs.join(", ")}] — sessions auto-route to '${id}'.`
);
console.log(`Supervised first memory run: bin/memory-weekly-run.sh ${id}`);
