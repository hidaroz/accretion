// Pure helpers for onboarding a new vault (used by scripts/setup-vault.mjs).
// No I/O here so the upsert logic is unit-testable; the CLI does the fs/git work.

export interface VaultConfigEntry {
  id: string;
  path: string;
  displayName: string;
  default?: boolean;
  gitAutoCommit?: boolean;
  gitAutoPush?: boolean;
}

/** Standard vault skeleton — the folders the lifecycle tools expect. */
export const SKELETON_DIRS = [
  "sessions/digests/_runs",
  "sessions/archive",
  "proposals/brief-updates",
  "MOCs",
  "Knowledge",
  "00-Index",
  ".mcp",
] as const;

/**
 * Add or replace a vault entry by id (idempotent). If the new entry is
 * `default`, any other vault's default flag is cleared so at most one remains.
 */
export function upsertVault(
  vaults: VaultConfigEntry[],
  entry: VaultConfigEntry
): VaultConfigEntry[] {
  const next = entry.default
    ? vaults.map((v) => ({ ...v, default: false }))
    : [...vaults];
  const idx = next.findIndex((v) => v.id === entry.id);
  if (idx >= 0) next[idx] = entry;
  else next.push(entry);
  return next;
}

/**
 * Map each project slug to the vault id (idempotent) and guarantee a
 * `_default` entry. An existing `_default` is preserved.
 */
export function upsertProjectMap(
  map: Record<string, string>,
  slugs: string[],
  vaultId: string
): Record<string, string> {
  const next = { ...map };
  for (const slug of slugs) {
    if (slug && slug !== "_default") next[slug] = vaultId;
  }
  if (!next._default) next._default = "general";
  return next;
}

/** Contents for a new vault's .gitignore (derived/local files only). */
export function gitignoreContent(): string {
  return [
    ".obsidian/workspace.json",
    ".obsidian/workspace-mobile.json",
    ".mcp/search-log.jsonl",
    ".mcp/embeddings.json",
    ".DS_Store",
    ".trash/",
    "",
  ].join("\n");
}

/** A minimal Home MOC so the vault is structurally valid from day one. */
export function homeMocStub(displayName: string): string {
  return [
    "---",
    `title: ${displayName} Home`,
    "tags:",
    "  - type/moc",
    "---",
    "",
    `# ${displayName} Home`,
    "",
    "Map of Content for this vault. Link domain MOCs here as they grow.",
    "",
  ].join("\n");
}
