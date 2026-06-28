#!/usr/bin/env node

/**
 * Memory-quality evaluation harness. Measures retrieval (keyword / semantic /
 * hybrid-RRF) + brief-routing against a fixture of known-answer cases —
 * deterministic, no LLM. The measurable loop a senior review flagged as the
 * prerequisite for trusting any autonomy.
 *
 * Usage:
 *   node scripts/memory-eval.mjs --vault work [--k 5] [--no-semantic] [--cases evals/cases.jsonl]
 *
 * Case format (one JSON object per line in evals/cases.jsonl):
 *   { "id", "query", "topic"?, "expectedNotes": [...], "expectedBrief": path|null,
 *     "negative"?: true }   // negative = should route to NO brief
 *
 * Requires `npm run build`. Writes evals/results/{date}.md (+ .json), prints a
 * scorecard, and a WIN/NO-WIN verdict for hybrid vs the better single index.
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
import { rrf, isRawSession } from "../dist/vault/hybrid.js";
import { scoreRetrieval, routingHit, aggregate } from "../dist/eval/metrics.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const K = args.k ? Number(args.k) : 5;
const withSemantic = args["no-semantic"] !== true;
const casesPath = path.resolve(
  typeof args.cases === "string" ? args.cases : path.join(REPO, "evals", "cases.jsonl")
);

function resolveBrief(query, briefMap, searchIndex) {
  const norm = query.toLowerCase().trim();
  if (briefMap[norm]) return briefMap[norm].replace(/^\.\//, "");
  const r = searchIndex.search(norm, { tag: "type/brief", limit: 1 });
  return r.length > 0 ? r[0].path : null;
}

const EMPTY = { precision: 0, recall: 0, hits: 0, success: false, rr: 0 };

try {
  const vaultRoot = await resolveVaultRoot(args.vault);
  const cases = fs
    .readFileSync(casesPath, "utf8")
    .split("\n").map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
  if (cases.length === 0) fail(`no cases in ${casesPath}`);

  const vm = new VaultManager(vaultRoot);
  const notes = await vm.getAllNotes();
  const searchIndex = new SearchIndex();
  await searchIndex.buildFromVault(vm, notes);
  const briefMap = await loadBriefMap(vaultRoot);

  let embeddingIndex = null;
  if (withSemantic) {
    embeddingIndex = new EmbeddingIndex(createLocalEmbedder(), {
      cachePath: path.join(vaultRoot, ".mcp", "embeddings.json"),
    });
    await embeddingIndex.loadCache();
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
    const negative = c.negative === true;
    const expectedNotes = c.expectedNotes || [];

    const kw = searchIndex.search(c.query, { limit: K * 3 }).map((r) => r.path);
    let sem = [];
    if (embeddingIndex) {
      const seen = new Set();
      for (const r of await embeddingIndex.search(c.query, K * 3)) {
        if (!seen.has(r.path)) { seen.add(r.path); sem.push(r.path); }
      }
    }
    const hyb = rrf([kw, sem], { weight: (p) => (isRawSession(p) ? 0.7 : 1) });

    const keyword = negative ? EMPTY : scoreRetrieval(kw, expectedNotes, K);
    const semantic = negative || !embeddingIndex ? EMPTY : scoreRetrieval(sem, expectedNotes, K);
    const hybrid = negative ? EMPTY : scoreRetrieval(hyb, expectedNotes, K);

    const resolved = resolveBrief(c.topic || c.query, briefMap, searchIndex);
    const rHit = routingHit(resolved, c.expectedBrief ?? null);

    scores.push({ id: c.id, negative, keyword, semantic, hybrid, routingHit: rHit });

    if (negative && !rHit) {
      misses.push(`\`${c.id}\` (negative) — routed to ${resolved} but expected none`);
    } else if (!negative && (!hybrid.success || !rHit)) {
      misses.push(
        `\`${c.id}\` — hybrid success ${hybrid.success ? "y" : "n"} (kw ${keyword.success ? "y" : "n"}/sem ${semantic.success ? "y" : "n"}), routing ${rHit ? "ok" : `got ${resolved || "none"}, want ${c.expectedBrief || "none"}`}`
      );
    }
  }

  const a = aggregate(scores);
  const pct = (x) => (x * 100).toFixed(1) + "%";
  const f = (x) => x.toFixed(3);
  const stamp = new Date().toISOString();
  const date = stamp.slice(0, 10);

  const win =
    withSemantic &&
    a.hybrid.recall >= a.keyword.recall && a.hybrid.recall >= a.semantic.recall &&
    a.hybrid.mrr >= a.keyword.mrr && a.hybrid.mrr >= a.semantic.mrr &&
    (a.hybrid.recall > a.keyword.recall || a.hybrid.recall > a.semantic.recall ||
     a.hybrid.mrr > a.keyword.mrr || a.hybrid.mrr > a.semantic.mrr);
  const verdict = !withSemantic
    ? "semantic off — no hybrid comparison"
    : win
      ? "✅ WIN — hybrid ≥ both singles on recall@k and MRR (and strictly better on at least one)"
      : "❌ NO WIN — hybrid did not beat both singles; do not ship hybrid_search yet";

  const md = [
    `# Memory eval scorecard — ${date}`,
    ``,
    `vault: \`${args.vault || "default"}\` · cases: ${a.count} (${a.positives} positive, ${a.negatives} negative) · k: ${K} · semantic: ${withSemantic ? "on" : "off"} · ${stamp}`,
    ``,
    `| Mode | recall@${K} | success@${K} | MRR |`,
    `|---|---|---|---|`,
    `| Keyword | ${pct(a.keyword.recall)} | ${pct(a.keyword.success)} | ${f(a.keyword.mrr)} |`,
    `| Semantic | ${withSemantic ? pct(a.semantic.recall) : "—"} | ${withSemantic ? pct(a.semantic.success) : "—"} | ${withSemantic ? f(a.semantic.mrr) : "—"} |`,
    `| **Hybrid (RRF)** | ${withSemantic ? pct(a.hybrid.recall) : "—"} | ${withSemantic ? pct(a.hybrid.success) : "—"} | ${withSemantic ? f(a.hybrid.mrr) : "—"} |`,
    ``,
    `Brief routing accuracy (positives): **${pct(a.routingAccuracy)}** · negative-routing accuracy: **${pct(a.negativeRoutingAccuracy)}**`,
    ``,
    `**Verdict:** ${verdict}`,
    ``,
    `## Misses (${misses.length})`,
    ...(misses.length ? misses.map((m) => `- ${m}`) : ["- none"]),
    ``,
  ].join("\n");

  const outDir = path.join(REPO, "evals", "results");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${date}.md`), md);
  fs.writeFileSync(path.join(outDir, `${date}.json`), JSON.stringify({ stamp, vault: args.vault, k: K, withSemantic, win, aggregate: a, scores }, null, 2));

  console.log(md);
  console.log(`\nScorecard written to evals/results/${date}.md`);
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
