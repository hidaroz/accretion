#!/usr/bin/env node
// SessionEnd hook: extracts session metadata from transcript JSONL
// and writes a session note directly to the Obsidian vault.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join, basename, dirname, sep } from 'path';
import { homedir } from 'os';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Deliberately duplicated from scripts/lib/expand-home.mjs rather than
// imported: this file is copied standalone into ~/.claude/hooks/, where the
// rest of the repo is not on disk. It must have no local imports.
function expandHome(p) {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return p;
}

// Machine-agnostic: honor VAULTS_CONFIG, else ~/.config/accretion/vaults.json.
const VAULTS_CONFIG = expandHome(
  process.env.VAULTS_CONFIG || join(homedir(), '.config', 'accretion', 'vaults.json')
);
const VAULT_MAP = expandHome(
  process.env.PROJECT_VAULT_MAP || join(__dirname, 'project-vault-map.json')
);

// Only run as a hook when executed directly. Importing the module (to test
// redactSecrets, say) must not try to read a session off stdin.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main();
  } catch (err) {
    console.error('[session-journal]', err.message);
    process.exit(0);
  }
}

function main() {
  const input = JSON.parse(readFileSync('/dev/stdin', 'utf8'));
  const { session_id, transcript_path, cwd } = input;
  if (!transcript_path || !session_id) return;

  const lines = readFileSync(transcript_path, 'utf8')
    .trim()
    .split('\n')
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);

  const messages = lines.filter(l => l.type === 'user' || l.type === 'assistant');
  const toolCalls = extractToolCalls(lines);
  const writeOps = toolCalls.filter(t => t.name === 'Edit' || t.name === 'Write');

  if (messages.length < 6 && writeOps.length === 0) return;

  const aiTitleEntry = lines.find(l => l.type === 'ai-title');
  const aiTitle = aiTitleEntry?.aiTitle;
  const firstUserMsg = getFirstUserMessage(lines);
  // Redact here, not just in the note body: the title also becomes the git
  // commit message below, which the whole-content pass never sees. A session
  // that opens with `export NEON_API_KEY=...` would otherwise put the key in
  // git log.
  const title = redactSecrets(
    aiTitle || (firstUserMsg ? `Session: ${firstUserMsg.slice(0, 80)}` : `Session: ${session_id.slice(0, 8)}`)
  );

  const projectSlug = cwd ? basename(cwd) : 'unknown';
  const vaultId = resolveVault(projectSlug);
  if (!vaultId) return; // unmapped project, and capture is opt-in
  const vaultPath = getVaultPath(vaultId);
  if (!vaultPath) return;

  const now = new Date();
  const dateDir = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const fileName = `${projectSlug}-${session_id.slice(0, 8)}.md`;

  // A resumed session ends more than once. Writing to today's date directory
  // each time produces byte-identical copies of one note, which crowd real
  // results out of retrieval. Reuse the note this session already has,
  // wherever it lives, and update it in place.
  const existingPath = findExistingSessionNote(vaultPath, fileName);
  const notePath = existingPath || `sessions/${dateDir}/${fileName}`;
  const fullPath = join(vaultPath, notePath);

  // `created` stays at first capture. Digests group sessions by created-week,
  // so bumping it would let an already-digested note hop into a later week and
  // read as an uncovered session forever.
  const created =
    (existingPath && readCreated(fullPath)) || now.toISOString();

  const topics = extractTopics(lines);
  const filesChanged = extractFilesChanged(toolCalls);
  const commands = extractCommands(toolCalls);

  const frontmatter = [
    '---',
    `title: '${escapeYaml(title)}'`,
    'tags:',
    '  - type/session',
    `  - project/${slugify(projectSlug)}`,
    `created: '${created}'`,
    `updated: '${now.toISOString()}'`,
    `session_id: '${session_id}'`,
    `project: '${escapeYaml(projectSlug)}'`,
    `cwd: '${escapeYaml(cwd || '')}'`,
    '---',
  ].join('\n');

  let body = `# ${title}\n`;

  if (topics.length > 0) {
    body += '\n## Topics\n\n';
    topics.forEach(t => { body += `- ${t}\n`; });
  }

  if (filesChanged.length > 0) {
    body += '\n## Files Changed\n\n';
    filesChanged.forEach(f => { body += `- \`${f}\`\n`; });
  }

  if (commands.length > 0) {
    body += '\n## Commands\n\n';
    commands.forEach(c => { body += `- \`${c}\`\n`; });
  }

  // No `## Decisions` section. It used to regex-grep assistant prose for
  // "decided|chose|going with", which recorded unverified model claims as
  // durable record — notes asserted fixes that were never committed. Digests
  // extract decisions from the transcript with judgment; that is the right
  // layer for it.

  // Redact once, over the assembled note. Doing it here rather than in each
  // extractor means a section added later cannot quietly bypass it.
  const content = redactSecrets(`${frontmatter}\n\n${body}`);

  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, 'utf8');

  // execFile, not exec: the commit message is derived from a user message, and
  // the previous shell-string form relied on escapeShell's denylist to keep it
  // from breaking out. An argument array involves no shell at all, so nothing
  // in a session title can be interpreted.
  const git = (...args) =>
    execFileSync('git', ['-C', vaultPath, ...args], { stdio: 'ignore', timeout: 30000 });

  try {
    git('add', notePath);
    git('commit', '-m', `Session: ${title.slice(0, 60)}`);
  } catch {
    // not a repo, nothing to commit, etc. — that's fine
    return;
  }

  // Session capture is the busiest writer in the vault, so a hook that only
  // ever commits is the main reason an off-machine backup falls behind — it can
  // sit dozens of commits stale without anything saying so. Push when the vault
  // opts in, matching what the MCP write path already does with this flag.
  //
  // Best-effort by design: this runs at session end, offline or on a dead
  // network, and a failed backup must never be louder than the work it follows.
  // The next successful push carries these commits anyway.
  if (!getVaultAutoPush(vaultId)) return;
  try {
    git('push', '--quiet');
  } catch {
    // offline, no upstream, rejected — the next push takes it
  }
}

/** Whether this vault opts into pushing, per the shared vault registry. */
function getVaultAutoPush(vaultId) {
  try {
    const config = JSON.parse(readFileSync(VAULTS_CONFIG, 'utf8'));
    return config.vaults.find(v => v.id === vaultId)?.gitAutoPush === true;
  } catch {
    return false;
  }
}

/**
 * Strip credentials before anything reaches the vault.
 *
 * Session notes copy user messages and shell commands verbatim, so a pasted
 * token or an `export API_KEY=...` line ends up in the note — and the vault
 * auto-commits and can be pushed. Live API keys and database passwords have
 * reached git history exactly this way.
 *
 * Deliberately blunt: a false positive costs a redacted word in a note, a false
 * negative costs a leaked credential. Order matters — specific vendor patterns
 * run before the generic assignment rule so the label survives in the output.
 */
/**
 * Values that are structurally incapable of being a leaked credential:
 * literals opening a collection, and the placeholders documentation uses.
 * Vendor-prefixed patterns (napi_, npg_, ...) never reach this check.
 */
function isPlaceholder(raw) {
  const v = raw.replace(/^["']|["']$/g, "").trim();
  if (v.startsWith("[") || v.startsWith("{")) return true; // array/object literal
  if (v.length < 8) return true;                            // too short to be a key
  return /^(\.{3}|<.*>|x{3,}|your[-_ ]|my[-_ ]|some[-_ ]|changeme|example|placeholder|redacted|\$\{|\$[A-Z_]+$)/i
    .test(v);
}

export function redactSecrets(text) {
  const rules = [
    // Vendor-shaped tokens, matched on their own prefixes.
    [/\bnapi_[A-Za-z0-9]{20,}/g, 'napi_[REDACTED]'],                 // Neon API key
    [/\bnpg_[A-Za-z0-9]{8,}/g, 'npg_[REDACTED]'],                    // Neon role password
    [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, 'github_pat_[REDACTED]'],
    [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, 'gh?_[REDACTED]'],
    [/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, 'xox?-[REDACTED]'],          // Slack
    [/\bsk-[A-Za-z0-9_-]{20,}/g, 'sk-[REDACTED]'],
    [/\bAKIA[0-9A-Z]{16}\b/g, 'AKIA[REDACTED]'],                     // AWS access key id
    [/\bASIA[0-9A-Z]{16}\b/g, 'ASIA[REDACTED]'],
    // JWTs — three base64url segments.
    [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]+/g, '[REDACTED_JWT]'],
    // Two-segment JWT fragments (truncated pastes still identify a user).
    [/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{5,}/g, '[REDACTED_JWT]'],
    // A lone base64 JSON blob — a JWT header whose payload got truncated away.
    // Not itself secret (the `kid` is published in the JWKS), but it trips
    // every credential scan, so it is not worth keeping in a note.
    [/\beyJ[A-Za-z0-9_+/=-]{37,}/g, '[REDACTED_JWT]'],
    // Credentials embedded in a URL: keep scheme and host, drop user:pass.
    [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[REDACTED]@'],
    // PEM private keys.
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
      '[REDACTED_PRIVATE_KEY]'],
    // Generic assignments: FOO_TOKEN=..., PGPASSWORD=..., "apiKey": "..."
    // The optional quote before the separator covers JSON/YAML keys.
    //
    // The value is matched via a callback rather than inline so obvious
    // non-secrets survive. Without that, `queryKey: ['rides', id]`
    // became `queryKey: [REDACTED]'rides', id]` — the rule ate a code
    // example — and documented placeholders like `NEON_API_KEY="your-key"`
    // were redacted for no benefit.
    [/\b([A-Za-z_][A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)S?)(["']?\s*[:=]\s*)("[^"\n]*"|'[^'\n]*'|[^\s"';,)]+)/gi,
      (match, name, sep, value) => (isPlaceholder(value) ? match : `${name}${sep}[REDACTED]`)],
  ];
  let out = String(text);
  for (const [re, replacement] of rules) out = out.replace(re, replacement);
  return out;
}

function extractToolCalls(lines) {
  const calls = [];
  for (const line of lines) {
    if (line.type !== 'assistant') continue;
    const content = line.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type === 'tool_use') {
        calls.push({ name: block.name, input: block.input || {} });
      }
    }
  }
  return calls;
}

function getFirstUserMessage(lines) {
  for (const line of lines) {
    if (line.type !== 'user') continue;
    const content = line.message?.content;
    if (typeof content !== 'string') continue;
    const clean = content
      .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
      .replace(/<task-notification>[\s\S]*?<\/task-notification>/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (clean.length > 10) return clean.slice(0, 200);
  }
  return null;
}

function extractTopics(lines) {
  const topics = [];
  for (const line of lines) {
    if (line.type !== 'user') continue;
    const content = line.message?.content;
    if (typeof content !== 'string') continue;
    const clean = content
      .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
      .replace(/<task-notification>[\s\S]*?<\/task-notification>/g, '')
      .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, '')
      .replace(/<command-[^>]*>[\s\S]*?<\/command-[^>]*>/g, '')
      .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (clean.length > 10 && !/^[a-f0-9-]{20,}$/i.test(clean)) {
      topics.push(clean.slice(0, 100) + (clean.length > 100 ? '...' : ''));
    }
  }
  return topics.slice(0, 20);
}

function extractFilesChanged(toolCalls) {
  const files = new Set();
  for (const call of toolCalls) {
    if (call.name === 'Edit' || call.name === 'Write') {
      const fp = call.input.file_path;
      if (fp) files.add(fp);
    }
  }
  return [...files];
}

function extractCommands(toolCalls) {
  const readOnlyPrefixes = ['ls ', 'cat ', 'head ', 'tail ', 'grep ', 'find ', 'echo ', 'wc ', 'file ', 'which '];
  const cmds = [];
  for (const call of toolCalls) {
    if (call.name !== 'Bash') continue;
    const cmd = call.input.command;
    if (!cmd) continue;
    if (readOnlyPrefixes.some(p => cmd.trimStart().startsWith(p))) continue;
    cmds.push(cmd.slice(0, 100) + (cmd.length > 100 ? '...' : ''));
  }
  return [...new Set(cmds)].slice(0, 30);
}

/**
 * Locate the note this session already wrote, if any.
 *
 * Keyed on the full `{project}-{id8}.md` filename rather than the session id
 * alone: one Claude session run from two repos (`work` and `atlas-mobile-app`)
 * is two different pieces of work and keeps two notes. Searches the archive
 * too, so resuming a session whose note was already archived updates it in
 * place instead of resurrecting a live duplicate.
 */
export function findExistingSessionNote(vaultPath, fileName) {
  const sessionsDir = join(vaultPath, 'sessions');
  if (!existsSync(sessionsDir)) return null;
  let entries;
  try {
    entries = readdirSync(sessionsDir, { recursive: true, withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isFile() || entry.name !== fileName) continue;
    // parentPath is absolute; make it vault-relative with forward slashes.
    const dir = entry.parentPath || entry.path;
    return join(dir, entry.name).slice(vaultPath.length + 1).split(sep).join('/');
  }
  return null;
}

/** Read `created:` out of an existing note's frontmatter, or null. */
export function readCreated(fullPath) {
  try {
    const head = readFileSync(fullPath, 'utf8').slice(0, 2000);
    const m = head.match(/^created:\s*'?([^'\n]+)'?\s*$/m);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

/**
 * Which vault should this project's sessions go to, if any.
 *
 * Returns null when the project is unmapped and no `_default` is set, and the
 * caller then writes nothing. Capture is opt-in by design: this hook is
 * installed globally and fires in *every* project the user opens, recording
 * prompts, changed files, and executed shell commands. Defaulting that on for
 * directories the user never named is not a reasonable thing to do to someone.
 *
 * Set `_default` to a vault id to capture everything instead.
 */
export function resolveVault(projectSlug, mapPath = VAULT_MAP) {
  try {
    const map = JSON.parse(readFileSync(mapPath, 'utf8'));
    return map[projectSlug] || map._default || null;
  } catch {
    return null;
  }
}

function getVaultPath(vaultId) {
  try {
    const config = JSON.parse(readFileSync(VAULTS_CONFIG, 'utf8'));
    const vault = config.vaults.find(v => v.id === vaultId);
    return vault?.path || null;
  } catch {
    return null;
  }
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function escapeYaml(str) {
  return str.replace(/'/g, "''");
}

