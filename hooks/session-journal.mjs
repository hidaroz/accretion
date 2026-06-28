#!/usr/bin/env node
// SessionEnd hook: extracts session metadata from transcript JSONL
// and writes a session note directly to the Obsidian vault.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, basename, dirname } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Machine-agnostic: honor VAULTS_CONFIG, else ~/.config/obsidian-mcp/vaults.json.
const VAULTS_CONFIG =
  process.env.VAULTS_CONFIG || join(homedir(), '.config', 'obsidian-mcp', 'vaults.json');
const VAULT_MAP = join(__dirname, 'project-vault-map.json');

try {
  main();
} catch (err) {
  console.error('[session-journal]', err.message);
  process.exit(0);
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
  const title = aiTitle || (firstUserMsg ? `Session: ${firstUserMsg.slice(0, 80)}` : `Session: ${session_id.slice(0, 8)}`);

  const projectSlug = cwd ? basename(cwd) : 'unknown';
  const vaultId = resolveVault(projectSlug);
  const vaultPath = getVaultPath(vaultId);
  if (!vaultPath) return;

  const now = new Date();
  const dateDir = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const fileName = `${projectSlug}-${session_id.slice(0, 8)}.md`;
  const notePath = `sessions/${dateDir}/${fileName}`;
  const fullPath = join(vaultPath, notePath);

  const topics = extractTopics(lines);
  const filesChanged = extractFilesChanged(toolCalls);
  const commands = extractCommands(toolCalls);
  const decisions = extractDecisions(lines);

  const frontmatter = [
    '---',
    `title: '${escapeYaml(title)}'`,
    'tags:',
    '  - type/session',
    `  - project/${slugify(projectSlug)}`,
    `created: '${now.toISOString()}'`,
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

  if (decisions.length > 0) {
    body += '\n## Decisions\n\n';
    decisions.forEach(d => { body += `- ${d}\n`; });
  }

  const content = `${frontmatter}\n\n${body}`;

  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, 'utf8');

  try {
    execSync(`git -C "${vaultPath}" add "${notePath}" && git -C "${vaultPath}" commit -m "Session: ${escapeShell(title.slice(0, 60))}"`, {
      stdio: 'ignore',
      timeout: 10000,
    });
  } catch {
    // git commit failed (not a repo, nothing to commit, etc.) — that's fine
  }
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

function extractDecisions(lines) {
  const keywords = /\b(decided|chose|chosen|instead of|tradeoff|trade-off|approach:|going with|opted for|picked)\b/i;
  const decisions = [];
  for (const line of lines) {
    if (line.type !== 'assistant') continue;
    const content = line.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type !== 'text') continue;
      const sentences = block.text.split(/(?<=[.!?])\s+/);
      for (const s of sentences) {
        if (keywords.test(s) && s.length > 20 && s.length < 300) {
          decisions.push(s.trim());
        }
      }
    }
  }
  return [...new Set(decisions)].slice(0, 10);
}

function resolveVault(projectSlug) {
  try {
    const map = JSON.parse(readFileSync(VAULT_MAP, 'utf8'));
    return map[projectSlug] || map._default || 'general';
  } catch {
    return 'general';
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

function escapeShell(str) {
  return str.replace(/['"\\$`!]/g, '');
}
