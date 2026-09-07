import { z } from "zod";
import { defineCommand, vaultFlag, semanticFlags, semanticFrom } from "../spec.js";
import { openVault, type SearchOutput, type BriefOutput } from "../../engine/index.js";
import { loadVaultsConfig, DEFAULT_WRITABLE_PATHS } from "../../engine/config/vault-config.js";
import type { AssembledContext } from "../../engine/context/assemble.js";
import type { RecallResult } from "../../engine/context/recall.js";
import type { NoteInfo } from "../../engine/vault/vault-manager.js";

export const search = defineCommand({
  name: "search",
  group: "retrieval",
  summary: "Hybrid search: keyword + semantic fused by RRF, routed brief pinned.",
  description:
    "Hybrid retrieval over one vault. Keyword (MiniSearch) and, when enabled, semantic (local embeddings) results are fused by reciprocal-rank fusion; raw session journals are demoted; the brief routed from the query is pinned if retrieved. Returns ranked paths with titles and snippets.",
  mcp: true,
  positional: { key: "query", label: "query", rest: true },
  input: z.object({
    query: z.string().min(1).describe("Natural-language query."),
    vault: vaultFlag,
    limit: z.coerce.number().int().min(1).max(25).default(8).describe("Max results."),
    explain: z.boolean().optional().describe("Include the routing decision in JSON output."),
    ...semanticFlags,
  }),
  async run(args) {
    const v = await openVault({ vaultId: args.vault, semantic: semanticFrom(args) });
    return v.search(args.query, { limit: args.limit, explain: args.explain });
  },
  format(result, args) {
    const r = result as SearchOutput;
    if (r.results.length === 0) return `No results for "${args.query}".`;
    return r.results
      .map((h) => {
        const snippet = h.snippet ? `\n   > ${h.snippet.replace(/\n/g, " ").slice(0, 200)}` : "";
        return `${h.rank}. ${h.title} (${h.path})${snippet}`;
      })
      .join("\n");
  },
});

export const brief = defineCommand({
  name: "brief",
  group: "retrieval",
  summary: "Route a topic to its domain brief; abstains rather than guess.",
  description:
    "Resolve a topic keyword to the single curated brief (or playbook / rejected-decision note) that owns it, via the brief map, exact title, or a gated fuzzy match with a domain trigger. When nothing clears the gate it abstains and lists possibly related notes instead. Trust the abstention.",
  mcp: true,
  jsonIndent: 0,
  positional: { key: "topic", label: "topic", rest: true },
  input: z.object({
    topic: z.string().min(1).describe("Topic keyword, e.g. 'routing', 'roasting'."),
    vault: vaultFlag,
  }),
  async run(args) {
    const v = await openVault({ vaultId: args.vault, semantic: false });
    return v.brief(args.topic);
  },
  format(result, args) {
    const r = result as BriefOutput;
    if (r.found) {
      const caveat = r.method === "tag_search" ? " (fuzzy match; verify this is the correct brief)" : "";
      return `# ${r.title}\n\n${r.content}\n\n---\n_Resolved via: ${r.method}${caveat}_`;
    }
    if (r.related.length === 0) return `No brief or related notes found for "${args.topic}".`;
    const lines = r.related.map((n, i) => `${i + 1}. ${n.title} (${n.path})\n   > ${n.snippet}`);
    return `No domain brief confidently matches "${args.topic}"; not routing to avoid a wrong brief.\nPossibly related notes (verify before relying on them):\n\n${lines.join("\n\n")}`;
  },
});

export const context = defineCommand({
  name: "context",
  group: "retrieval",
  summary: "Assemble several briefs under one token budget.",
  description:
    "Route each topic to its brief and concatenate them under a shared token budget, fair-shared across the briefs that resolved. Topics that do not route are listed at the end. One call instead of several brief lookups.",
  mcp: true,
  positional: { key: "topics", label: "topic", rest: true, list: true },
  input: z.object({
    topics: z.array(z.string().min(1)).min(1).max(6).describe("Topic keywords."),
    vault: vaultFlag,
    "max-tokens": z.coerce.number().int().min(1000).max(20000).default(8000).describe("Approximate output ceiling."),
  }),
  async run(args) {
    const v = await openVault({ vaultId: args.vault, semantic: false });
    return v.context(args.topics, { maxTokens: args["max-tokens"] });
  },
  format(result, args) {
    const r = result as AssembledContext;
    if (r.text.trim().length === 0) return `No briefs found for topics: ${args.topics.join(", ")}. Try \`accretion search\`.`;
    return r.text;
  },
});

export const recall = defineCommand({
  name: "recall",
  group: "retrieval",
  summary: "What passive recall would inject for a prompt (the hook's decision, inspectable).",
  positional: { key: "prompt", label: "prompt", rest: true },
  input: z.object({
    prompt: z.string().min(1).describe("The user prompt."),
    vault: vaultFlag,
    budget: z.coerce.number().int().min(100).optional().describe("Token budget for the injected block."),
    mode: z.enum(["brief-only", "brief-or-hits", "off"]).optional().describe("Recall mode."),
    ...semanticFlags,
  }),
  async run(args) {
    const v = await openVault({ vaultId: args.vault, semantic: semanticFrom(args) ?? false });
    return v.recall(args.prompt, { budget: args.budget, mode: args.mode });
  },
  format(result) {
    const r = result as RecallResult;
    return r.text ?? `(nothing to inject: tier ${r.tier}, route ${r.route.method})`;
  },
});

export const read = defineCommand({
  name: "read",
  group: "retrieval",
  summary: "Read one note: frontmatter, body, metadata.",
  mcp: true,
  positional: { key: "path", label: "path" },
  input: z.object({
    path: z.string().min(1).describe("Vault-relative note path."),
    vault: vaultFlag,
  }),
  async run(args) {
    const v = await openVault({ vaultId: args.vault, semantic: false });
    const n = await v.vault.read(args.path);
    return { path: n.path, title: n.title, tags: n.tags, modifiedAt: n.modifiedAt, size: n.size, frontmatter: n.frontmatter, content: n.content };
  },
  format(result) {
    const n = result as { path: string; title: string; tags: string[]; modifiedAt: string; frontmatter: Record<string, unknown>; content: string };
    const fm = Object.keys(n.frontmatter).length ? `\n\`\`\`yaml\n${JSON.stringify(n.frontmatter, null, 2)}\n\`\`\`\n` : "";
    return `# ${n.title}\n\nPath: ${n.path}\nModified: ${n.modifiedAt}${n.tags.length ? `\nTags: ${n.tags.join(", ")}` : ""}\n${fm}\n${n.content}`;
  },
});

export const list = defineCommand({
  name: "list",
  group: "retrieval",
  summary: "List notes in a folder, newest first.",
  mcp: true,
  positional: { key: "folder", label: "folder" },
  input: z.object({
    folder: z.string().optional().default("").describe("Vault-relative folder; omit for the root."),
    vault: vaultFlag,
    recursive: z.boolean().default(true).describe("Include subfolders."),
    limit: z.coerce.number().int().min(1).max(500).default(100).describe("Max notes."),
  }),
  async run(args) {
    const v = await openVault({ vaultId: args.vault, semantic: false });
    return v.searchIndex.listNotes(args.folder, args.recursive, args.limit);
  },
  format(result) {
    const notes = result as NoteInfo[];
    if (notes.length === 0) return "No notes.";
    return notes.map((n) => `${n.modifiedAt.slice(0, 10)}  ${n.path}  ${n.title}`).join("\n");
  },
});

export const tags = defineCommand({
  name: "tags",
  group: "retrieval",
  summary: "Tag counts across the vault.",
  input: z.object({
    vault: vaultFlag,
    prefix: z.string().optional().describe("Only tags starting with this prefix, e.g. 'type/'."),
  }),
  async run(args) {
    const v = await openVault({ vaultId: args.vault, semantic: false });
    return v.searchIndex.tagCounts(args.prefix);
  },
  format(result) {
    const t = result as Array<{ tag: string; count: number }>;
    return t.length ? t.map((x) => `${String(x.count).padStart(5)}  ${x.tag}`).join("\n") : "No tags.";
  },
});

export const listVaults = defineCommand({
  name: "list-vaults",
  group: "retrieval",
  summary: "Registered vaults and their settings.",
  input: z.object({
    md: z.boolean().optional().describe("Print a markdown table (for skills and docs)."),
  }),
  async run() {
    const vaults = await loadVaultsConfig();
    return vaults.map((v) => ({
      id: v.id,
      displayName: v.displayName,
      path: v.path,
      default: v.default === true,
      semantic: v.semantic ?? "auto",
      writablePaths: v.writablePaths ?? DEFAULT_WRITABLE_PATHS,
      gitAutoCommit: v.gitAutoCommit !== false,
      gitAutoPush: v.gitAutoPush === true,
    }));
  },
  format(result, args) {
    const vs = result as Array<{ id: string; displayName: string; path: string; default: boolean; semantic: unknown }>;
    if (args.md) {
      return ["| id | name | path | semantic |", "|---|---|---|---|", ...vs.map((v) => `| \`${v.id}\`${v.default ? " (default)" : ""} | ${v.displayName} | \`${v.path}\` | ${String(v.semantic)} |`)].join("\n");
    }
    return vs.map((v) => `${v.id}${v.default ? " (default)" : ""}  ${v.path}  ${v.displayName}`).join("\n");
  },
});
