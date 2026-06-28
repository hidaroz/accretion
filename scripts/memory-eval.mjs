#!/usr/bin/env node

/**
 * Memory-quality evaluation harness. Measures retrieval (keyword / semantic /
 * hybrid-RRF) + brief-routing precision against a fixture of known-answer cases.
 * Deterministic, no LLM. The measurable loop that gates autonomy.
 *
 * Usage:
 *   node scripts/memory-eval.mjs --vault work [--k 5] [--no-semantic] [--faithful] [--cases path]
 *   node scripts/memory-eval.mjs --vault work --sweep-routing   # grid for floor/marginRatio
 *
 * Case: { id, query, topic?, expectedNotes:[], expectedBrief: path|null, negative?, stratum? }
 * Requires `npm run build`.
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
import { routeBrief } from "../dist/vault/brief-routing.js";
import { scoreRetrieval, aggregate, bootstrapCI } from "../dist/eval/metrics.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const K = args.k ? Number(args.k) : 5;
const withSemantic = args["no-semantic"] !== true;
const faithful = args.faithful === true; // index ALL notes incl. raw sessions
const sweep = args["sweep-routing"] === true;
const casesPath = path.resolve(
  typeof args.cases === "string" ? args.cases : path.join(REPO, "evals", "cases.jsonl")
);
const pct = (x) => (x * 100).toFixed(1) + "%";
const f = (x) => x.toFixed(3);
const EMPTY = { precision: 0, recall: 0, hits: 0, success: false, rr: 0 };

/** Routing precision/recall/abstention for a given (floor,marginRatio). */
function evalRouting(cases, briefMap, searchIndex, opts) {
  const positives = cases.filter((c) => !c.negative);
  let routes = 0, correct = 0, abst = 0, negTotal = 0, negAbst = 0;
  for (const c of cases) {
    const r = routeBrief(briefMap, searchIndex, c.topic || c.query, opts);
    const routed = r.path !== null;
    if (routed) routes++; else abst++;
    if (c.negative) { negTotal++; if (!routed) negAbst++; }
    else if (routed && r.path === c.expectedBrief) correct++;
  }
  return {
    precision: routes ? correct / routes : 1,
    recall: positives.length ? correct / positives.length : 0,
    abstention: abst / cases.length,
    negAccuracy: negTotal ? negAbst / negTotal : 1,
  };
}

try {
  const vaultRoot = await resolveVaultRoot(args.vault);
  const cases = fs.readFileSync(casesPath, "utf8").split("\n")
    .map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
  if (cases.length === 0) fail(`no cases in ${casesPath}`);

  const vm = new VaultManager(vaultRoot);
  const notes = await vm.getAllNotes();
  const searchIndex = new SearchIndex();
  await searchIndex.buildFromVault(vm, notes);
  const briefMap = await loadBriefMap(vaultRoot);

  // --- Routing threshold sweep (calibration) ---
  if (sweep) {
    const floors = [4, 6, 8, 10];
    const ratios = [1.0, 1.3, 1.6, 2.0];
    console.log(`Routing sweep — vault ${args.vault}, ${cases.length} cases\n`);
    console.log("floor  ratio  precision  recall  abstain  neg-acc");
    for (const floor of floors) {
      for (const marginRatio of ratios) {
        const r = evalRouting(cases, briefMap, searchIndex, { floor, marginRatio });
        console.log(
          `${String(floor).padEnd(6)} ${String(marginRatio).padEnd(6)} ${pct(r.precision).padEnd(10)} ${pct(r.recall).padEnd(7)} ${pct(r.abstention).padEnd(8)} ${pct(r.negAccuracy)}`
        );
      }
    }
    process.exit(0);
  }

  let embeddingIndex = null;
  if (withSemantic) {
    embeddingIndex = new EmbeddingIndex(createLocalEmbedder(), {
      cachePath: path.join(vaultRoot, ".mcp", "embeddings.json"),
    });
    await embeddingIndex.loadCache();
    const indexed = faithful
      ? notes
      : notes.filter((n) => !n.path.startsWith("sessions/") || n.path.startsWith("sessions/digests/"));
    await embeddingIndex.buildFromVault(
      indexed.map((n) => ({ path: n.path, title: n.title, content: n.content }))
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
    const route = routeBrief(briefMap, searchIndex, c.topic || c.query);
    const rHit = c.negative ? route.path === null : route.path === (c.expectedBrief ?? null);
    scores.push({ id: c.id, negative, stratum: c.stratum || "untagged", keyword, semantic, hybrid, routingHit: rHit });

    if (negative && !rHit) misses.push(`\`${c.id}\` (negative) — routed to ${route.path}`);
    else if (!negative && (!hybrid.success || !rHit))
      misses.push(`\`${c.id}\` [${c.stratum || "?"}] — hybrid ${hybrid.success ? "y" : "n"} (kw ${keyword.success ? "y" : "n"}/sem ${semantic.success ? "y" : "n"}), routing ${rHit ? "ok" : `→ ${route.path || "abstain"} (${route.method}), want ${c.expectedBrief || "none"}`}`);
  }

  const a = aggregate(scores);
  const routing = evalRouting(cases, briefMap, searchIndex, {}); // default (calibrated) thresholds
  const hybRecallCI = bootstrapCI(scores.filter((s) => !s.negative).map((s) => s.hybrid.recall));

  // per-stratum success (hybrid)
  const strata = [...new Set(scores.map((s) => s.stratum))].sort();
  const stratLines = strata.map((st) => {
    const ss = scores.filter((s) => s.stratum === st);
    const pos = ss.filter((s) => !s.negative);
    const succ = pos.length ? pct(pos.filter((s) => s.hybrid.success).length / pos.length) : "—";
    const negAcc = ss.some((s) => s.negative)
      ? pct(ss.filter((s) => s.negative && s.routingHit).length / ss.filter((s) => s.negative).length)
      : "—";
    return `| ${st} | ${ss.length} | ${succ} | ${negAcc} |`;
  });

  const stamp = new Date().toISOString();
  const date = stamp.slice(0, 10);
  const md = [
    `# Memory eval scorecard — ${date}`,
    ``,
    `vault: \`${args.vault || "default"}\` · cases: ${a.count} (${a.positives} pos / ${a.negatives} neg) · k: ${K} · semantic: ${withSemantic ? (faithful ? "on (faithful/all-notes)" : "on (curated)") : "off"} · ${stamp}`,
    ``,
    `## Retrieval`,
    `| Mode | recall@${K} | success@${K} | MRR |`,
    `|---|---|---|---|`,
    `| Keyword | ${pct(a.keyword.recall)} | ${pct(a.keyword.success)} | ${f(a.keyword.mrr)} |`,
    `| Semantic | ${withSemantic ? pct(a.semantic.recall) : "—"} | ${withSemantic ? pct(a.semantic.success) : "—"} | ${withSemantic ? f(a.semantic.mrr) : "—"} |`,
    `| **Hybrid (RRF)** | ${withSemantic ? pct(a.hybrid.recall) : "—"} | ${withSemantic ? pct(a.hybrid.success) : "—"} | ${withSemantic ? f(a.hybrid.mrr) : "—"} |`,
    ``,
    `Hybrid recall@${K} 95% CI: [${pct(hybRecallCI[0])}, ${pct(hybRecallCI[1])}]`,
    ``,
    `## Brief routing (precision over recall — abstain beats wrong)`,
    `| Metric | Score |`,
    `|---|---|`,
    `| Routing precision (of routed) | **${pct(routing.precision)}** |`,
    `| Routing recall (positives routed correctly) | ${pct(routing.recall)} |`,
    `| Abstention rate | ${pct(routing.abstention)} |`,
    `| Negative-routing accuracy | **${pct(routing.negAccuracy)}** |`,
    ``,
    `## Per-stratum`,
    `| Stratum | n | hybrid success@${K} | neg-routing acc |`,
    `|---|---|---|---|`,
    ...stratLines,
    ``,
    `## Misses (${misses.length})`,
    ...(misses.length ? misses.map((m) => `- ${m}`) : ["- none"]),
    ``,
  ].join("\n");

  const outDir = path.join(REPO, "evals", "results");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${date}.md`), md);
  fs.writeFileSync(path.join(outDir, `${date}.json`), JSON.stringify({ stamp, vault: args.vault, k: K, faithful, aggregate: a, routing, hybRecallCI, scores }, null, 2));
  console.log(md);
  console.log(`\nScorecard written to evals/results/${date}.md`);
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
