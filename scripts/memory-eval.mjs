#!/usr/bin/env node

/**
 * Memory-quality evaluation harness. Measures retrieval + brief-routing against
 * a fixture of known-answer cases — deterministic, no LLM. The measurable loop
 * a senior review flagged as the prerequisite for trusting (any) autonomy.
 *
 * Usage:
 *   node scripts/memory-eval.mjs --vault work [--k 5] [--no-semantic] [--cases evals/cases.jsonl]
 *
 * Case format (one JSON object per line in evals/cases.jsonl):
 *   { "id": "...", "query": "natural language", "topic": "keyword-for-get_brief",
 *     "expectedNotes": ["path", ...], "expectedBrief": "path"|null, "note": "..." }
 *
 * Requires `npm run build` (imports compiled dist/). Writes a scorecard to
 * evals/results/{date}.md (+ .json) and prints a summary.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, resolveVaultRoot, fail } from "./memory-lib.mjs";
import { VaultManager } from "../dist/vault/vault-manager.js";
import { SearchIndex } from "../dist/vault/search-index.js";
import { EmbeddingIndex } from "../dist/vault/embedding-index.js";
import { createLocalEmbedder } from "../dist/vault/embedder.js";
import { loadBriefMap } from "../dist/vault/brief-map-loader.js";
import {
  precisionRecallAtK,
  routingHit,
  aggregate,
} from "../dist/eval/metrics.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const K = args.k ? Number(args.k) : 5;
const withSemantic = args["no-semantic"] !== true;
const casesPath = path.resolve(
  typeof args.cases === "string" ? args.cases : path.join(REPO, "evals", "cases.jsonl")
);

function resolveBrief(query, briefMap, searchIndex) {
  const norm = query.toLowerCase().trim();
  if (briefMap[norm]) return { path: briefMap[norm].replace(/^\.\//, ""), method: "direct_map" };
  const r = searchIndex.search(norm, { tag: "type/brief", limit: 1 });
  if (r.length > 0) return { path: r[0].path, method: "tag_search" };
  return { path: null, method: "not_found" };
}

try {
  const vaultRoot = await resolveVaultRoot(args.vault);
  const cases = fs
    .readFileSync(casesPath, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  if (cases.length === 0) fail(`no cases in ${casesPath}`);

  const vm = new VaultManager(vaultRoot);
  const notes = await vm.getAllNotes();
  const searchIndex = new SearchIndex();
  await searchIndex.buildFromVault(vm, notes);
  const briefMap = await loadBriefMap(vaultRoot);

  let embeddingIndex = null;
  if (withSemantic) {
    // Reuse + persist the vault's embedding cache so the slow embed is a
    // one-time cost (and shared with the server), not paid on every eval run.
    embeddingIndex = new EmbeddingIndex(createLocalEmbedder(), {
      cachePath: path.join(vaultRoot, ".mcp", "embeddings.json"),
    });
    await embeddingIndex.loadCache();
    // Index curated knowledge (briefs/digests/notes), not the hundreds of raw
    // session journals — far faster and on-target for measuring brief recall.
    // (Diverges from the server's all-notes index; documented in evals/README.)
    const curated = notes.filter(
      (n) => !n.path.startsWith("sessions/") || n.path.startsWith("sessions/digests/")
    );
    await embeddingIndex.buildFromVault(
      curated.map((n) => ({ path: n.path, title: n.title, content: n.content }))
    );
    await embeddingIndex.saveCache();
  }

  const scores = [];
  const misses = [];
  for (const c of cases) {
    const expectedNotes = c.expectedNotes || [];
    const kw = searchIndex.search(c.query, { limit: K }).map((r) => r.path);
    const keyword = precisionRecallAtK(kw, expectedNotes, K);

    let semantic = { precision: 0, recall: 0, hits: 0 };
    if (embeddingIndex) {
      const sem = [];
      for (const r of await embeddingIndex.search(c.query, K * 3)) {
        if (!sem.includes(r.path)) sem.push(r.path);
      }
      semantic = precisionRecallAtK(sem, expectedNotes, K);
    }

    const routed = resolveBrief(c.topic || c.query, briefMap, searchIndex);
    const rHit = routingHit(routed.path, c.expectedBrief ?? null);

    scores.push({ id: c.id, keyword, semantic, routingHit: rHit });
    if (keyword.recall < 1 || (embeddingIndex && semantic.recall < 1) || !rHit) {
      misses.push({
        id: c.id,
        keywordRecall: keyword.recall,
        semanticRecall: embeddingIndex ? semantic.recall : null,
        routing: rHit ? "ok" : `got ${routed.path || "none"} (${routed.method}), want ${c.expectedBrief || "none"}`,
      });
    }
  }

  const agg = aggregate(scores);
  const pct = (x) => (x * 100).toFixed(1) + "%";
  const stamp = new Date().toISOString();
  const date = stamp.slice(0, 10);

  const md = [
    `# Memory eval scorecard — ${date}`,
    ``,
    `vault: \`${args.vault || "default"}\` · cases: ${agg.count} · k: ${K} · semantic: ${withSemantic ? "on" : "off"} · ${stamp}`,
    ``,
    `| Metric | Score |`,
    `|---|---|`,
    `| Keyword precision@${K} | ${pct(agg.keywordPrecision)} |`,
    `| Keyword recall@${K} | ${pct(agg.keywordRecall)} |`,
    `| Semantic precision@${K} | ${withSemantic ? pct(agg.semanticPrecision) : "—"} |`,
    `| Semantic recall@${K} | ${withSemantic ? pct(agg.semanticRecall) : "—"} |`,
    `| Brief routing accuracy | ${pct(agg.routingAccuracy)} |`,
    ``,
    `## Misses (${misses.length})`,
    ...(misses.length
      ? misses.map((m) => `- \`${m.id}\` — kw recall ${pct(m.keywordRecall)}${m.semanticRecall !== null ? `, sem recall ${pct(m.semanticRecall)}` : ""}, routing: ${m.routing}`)
      : ["- none — all cases fully hit"]),
    ``,
  ].join("\n");

  const outDir = path.join(REPO, "evals", "results");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${date}.md`), md);
  fs.writeFileSync(path.join(outDir, `${date}.json`), JSON.stringify({ stamp, vault: args.vault, k: K, withSemantic, aggregate: agg, scores, misses }, null, 2));

  console.log(md);
  console.log(`\nScorecard written to evals/results/${date}.md`);
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
