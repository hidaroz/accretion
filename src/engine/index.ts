// Public API of the engine. Everything a caller (CLI, hooks, MCP adapter)
// needs is reachable from here, and the one-shot `openVault` is the entry
// point for processes that live for a single command.
//
// What a caller must know (the interface, not just the types):
// - `openVault` reads the registry (VAULTS_CONFIG, then ~/.config/accretion,
//   then the legacy ~/.config/obsidian-mcp path) and picks by id, else default.
// - Keyword index comes from `.mcp/search-index.json` when present and is
//   refreshed against file mtimes; pass `index: "rebuild"` to force a full read.
// - Embeddings follow `semantic` in the vault config ("auto" by default: on
//   once the curated layer has `semanticThreshold` notes). `DISABLE_EMBEDDINGS`
//   forces off. When on, the first call pays the model load.
// - Writes go through `VaultManager`, which enforces `writablePaths`.
//   Curated notes change only via `applyProposal`.
// - Nothing here runs git. `accretion commit` owns that.
// - Errors: `VaultNotFoundError`, `NoteNotFoundError`, `WriteNotAllowedError`,
//   `PathSafetyError` are user errors; anything else is a bug or an I/O fault.

import path from "node:path";
import { VaultManager } from "./vault/vault-manager.js";
import { SearchIndex, type SearchResult } from "./retrieval/search-index.js";
import { EmbeddingIndex } from "./retrieval/embedding-index.js";
import { createLocalEmbedder } from "./retrieval/embedder.js";
import { loadBriefMap } from "./retrieval/brief-map-loader.js";
import { routeBrief, type RouteResult } from "./retrieval/brief-routing.js";
import { rrf, isRawSession } from "./retrieval/hybrid.js";
import { SESSION_FUSION_WEIGHT } from "./retrieval/weights.js";
import { JsonIndexStore, loadOrBuildSearchIndex } from "./retrieval/index-store.js";
import {
  loadVaultsConfig,
  loadVaultsConfigFrom,
  selectVault,
  resolveSemantic,
  DEFAULT_WRITABLE_PATHS,
  type VaultConfig,
} from "./config/vault-config.js";
import { assembleContext, type AssembleOptions, type AssembledContext } from "./context/assemble.js";
import { recallForPrompt, type RecallConfig, type RecallResult } from "./context/recall.js";
import type { NoteContent } from "./vault/vault-manager.js";

export interface OpenVaultOptions {
  vaultId?: string;
  /** Explicit registry path; otherwise resolved from env / defaults. */
  configPath?: string;
  /** Override the vault's `semantic` setting for this process. */
  semantic?: "auto" | boolean;
  /** "snapshot" (default) uses/refreshes .mcp/search-index.json; "rebuild" reads every note. */
  index?: "snapshot" | "rebuild";
  /** Injectable clock for recency boosts (the eval freezes it). */
  now?: () => number;
  /** Lift the write allowlist (tests, migrations). */
  unrestrictedWrites?: boolean;
}

export interface SearchHit {
  rank: number;
  path: string;
  title: string;
  snippet: string;
}

/** The CLI's `search --json` contract. Byte-compatible with the private vault-search. */
export interface SearchOutput {
  count: number;
  semantic: boolean;
  results: SearchHit[];
}

export type BriefOutput =
  | { found: true; path: string; method: RouteResult["method"]; title: string; content: string }
  | {
      found: false;
      method: "abstain";
      related: Array<{ path: string; title: string; snippet: string }>;
    };

export interface VaultHandle {
  id: string;
  config: VaultConfig;
  vault: VaultManager;
  searchIndex: SearchIndex;
  embeddingIndex: EmbeddingIndex | null;
  semantic: boolean;
  briefMap: Record<string, string>;
  /** Present only when a full read happened (rebuild, or no snapshot). */
  notes: NoteContent[] | null;
  search(query: string, opts?: { limit?: number; explain?: boolean }): Promise<SearchOutput & { route?: RouteResult }>;
  brief(topic: string): Promise<BriefOutput>;
  context(topics: string[], opts?: AssembleOptions): Promise<AssembledContext>;
  recall(prompt: string, opts?: RecallConfig): Promise<RecallResult>;
}

export async function openVault(options: OpenVaultOptions = {}): Promise<VaultHandle> {
  const configs = options.configPath
    ? await loadVaultsConfigFrom(options.configPath)
    : await loadVaultsConfig();
  const config = selectVault(configs, options.vaultId);

  const vault = new VaultManager(config.path, {
    writablePaths: options.unrestrictedWrites
      ? undefined
      : config.writablePaths ?? DEFAULT_WRITABLE_PATHS,
  });

  const store =
    options.index === "rebuild"
      ? null
      : new JsonIndexStore(path.join(config.path, ".mcp", "search-index.json"));
  const loaded = await loadOrBuildSearchIndex(vault, store, { now: options.now });
  const searchIndex = loaded.index;
  let notes = loaded.notes;

  const fileMap = await loadBriefMap(config.path);
  const briefMap = searchIndex.briefMap(fileMap);

  const semanticSetting = options.semantic ?? config.semantic;
  const semantic = resolveSemantic(
    { semantic: semanticSetting, semanticThreshold: config.semanticThreshold },
    searchIndex.curatedCount
  );

  let embeddingIndex: EmbeddingIndex | null = null;
  if (semantic) {
    try {
      notes = notes ?? (await vault.getAllNotes());
      embeddingIndex = new EmbeddingIndex(createLocalEmbedder(), {
        cachePath: path.join(config.path, ".mcp", "embeddings.json"),
      });
      await embeddingIndex.loadCache();
      await embeddingIndex.buildFromVault(notes);
      await embeddingIndex.saveCache();
    } catch (err) {
      process.stderr.write(`Warning: semantic index unavailable (${String(err)}); keyword only.\n`);
      embeddingIndex = null;
    }
  }

  const handle: VaultHandle = {
    id: config.id,
    config,
    vault,
    searchIndex,
    embeddingIndex,
    semantic: embeddingIndex !== null,
    briefMap,
    notes,

    async search(query, opts = {}) {
      const limit = Math.max(1, Math.min(25, opts.limit ?? 8));
      const wide = limit * 3;
      const kw: SearchResult[] = searchIndex.search(query, { limit: wide });
      const sem = embeddingIndex ? await embeddingIndex.search(query, wide) : [];

      const meta = new Map<string, { title: string; snippet: string }>();
      for (const r of kw) meta.set(r.path, { title: r.title, snippet: r.snippet });
      const semPaths: string[] = [];
      for (const r of sem) {
        if (!meta.has(r.path)) {
          meta.set(r.path, {
            title: r.path.split("/").pop()?.replace(/\.md$/, "") ?? r.path,
            snippet: r.snippet,
          });
        }
        if (!semPaths.includes(r.path)) semPaths.push(r.path);
      }

      const route = routeBrief(briefMap, searchIndex, query);
      const fused = rrf([kw.map((r) => r.path), semPaths], {
        weight: (p) => (isRawSession(p) ? SESSION_FUSION_WEIGHT : 1),
        pins: route.path ? [route.path] : [],
      }).slice(0, limit);

      const results = fused.map((p, i) => ({
        rank: i + 1,
        path: p,
        title: meta.get(p)?.title ?? p,
        snippet: meta.get(p)?.snippet ?? "",
      }));
      const out: SearchOutput & { route?: RouteResult } = {
        count: results.length,
        semantic: embeddingIndex !== null,
        results,
      };
      if (opts.explain) out.route = route;
      return out;
    },

    async brief(topic) {
      const t = topic.toLowerCase().trim();
      const route = routeBrief(briefMap, searchIndex, t);
      if (route.path) {
        const note = await vault.read(route.path);
        return { found: true, path: route.path, method: route.method, title: note.title, content: note.content };
      }
      const related = searchIndex.search(t, { limit: 3 });
      return {
        found: false,
        method: "abstain",
        related: related.map((r) => ({ path: r.path, title: r.title, snippet: r.snippet })),
      };
    },

    context(topics, opts) {
      return assembleContext(vault, briefMap, searchIndex, topics, opts);
    },

    recall(prompt, opts) {
      return recallForPrompt(
        { vaultId: config.id, vault, searchIndex, briefMap, embeddingIndex },
        prompt,
        { ...config.recall, ...opts }
      );
    },
  };

  return handle;
}

// Re-exports: the engine surface.
export * from "./config/vault-config.js";
export * from "./vault/vault-manager.js";
export * from "./vault/frontmatter.js";
export * from "./vault/note-scan.js";
export * from "./vault/tag-index.js";
export * from "./vault/wikilink-index.js";
export * from "./vault/vault-onboarding.js";
export * from "./retrieval/search-index.js";
export * from "./retrieval/embedding-index.js";
export * from "./retrieval/embedder.js";
export * from "./retrieval/hybrid.js";
export * from "./retrieval/brief-routing.js";
export * from "./retrieval/brief-keywords.js";
export * from "./retrieval/brief-map-loader.js";
export * from "./retrieval/index-store.js";
export * from "./retrieval/weights.js";
export * from "./retrieval/search-analytics.js";
export * from "./context/assemble.js";
export * from "./context/recall.js";
export * from "./lifecycle/session-scan.js";
export * from "./lifecycle/digest-candidates.js";
export * from "./lifecycle/brief-staleness.js";
export * from "./lifecycle/proposal-apply.js";
export * from "./lifecycle/archive.js";
export * from "./lifecycle/resurface-review.js";
export * from "./lifecycle/orphan-detection.js";
export * from "./lifecycle/structure-validation.js";
export * from "./lifecycle/domain-candidates.js";
export * from "./lifecycle/garden.js";
export * from "./lifecycle/log.js";
export * from "./eval/metrics.js";
export * from "./utils/errors.js";
export * from "./utils/path-safety.js";
export { logger } from "./utils/logger.js";
