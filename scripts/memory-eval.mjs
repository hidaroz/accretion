#!/usr/bin/env node

/**
 * Memory-quality evaluation harness. Measures retrieval (keyword / semantic /
 * hybrid-RRF) + brief-routing precision against a fixture of known-answer cases.
 * Deterministic, no LLM. The measurable loop that gates autonomy.
 *
 * Usage:
 *   node scripts/memory-eval.mjs --vault demo [--k 5] [--no-semantic] [--faithful] [--cases path]
 *   node scripts/memory-eval.mjs --vault demo --sweep-routing   # grid for floor/marginRatio
 *
 * Case: { id, query, topic?, expectedNotes:[], expectedBrief: path|null, negative?, stratum? }
 * Requires `npm run build`.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, resolveVaultRoot, fail } from "./memory-lib.mjs";
import { VaultManager } from "../dist/engine/vault/vault-manager.js";
import { SearchIndex } from "../dist/engine/retrieval/search-index.js";
import { EmbeddingIndex } from "../dist/engine/retrieval/embedding-index.js";
import { createLocalEmbedder } from "../dist/engine/retrieval/embedder.js";
import { loadBriefMap } from "../dist/engine/retrieval/brief-map-loader.js";
import { rrf, isRawSession } from "../dist/engine/retrieval/hybrid.js";
import { routeBrief } from "../dist/engine/retrieval/brief-routing.js";
import { scoreRetrieval, aggregate, bootstrapCI } from "../dist/engine/eval/metrics.js";

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

// Frozen clock for the regression harness: SearchIndex applies age-based recency
// boosts off the wall clock, so without this the scorecard drifts as notes age
// past the 7/30-day thresholds. Fix it to the snapshot the eval is calibrated
// against so re-running yields identical numbers. Production still uses Date.now.
//
// Overridable so a fixture with different note dates can pin its own epoch —
// the docs described this as a re-pinnable knob long before it actually was.
const EVAL_EPOCH = Date.parse(process.env.EVAL_EPOCH || "2026-08-01T00:00:00Z");
if (Number.isNaN(EVAL_EPOCH)) fail(`EVAL_EPOCH is not a parseable date: ${process.env.EVAL_EPOCH}`);

/**
 * Routing precision/recall/abstention for a given (floor,marginRatio). `keyOf`
 * selects what string is routed: topic keyword (faithful to `get_brief`) or raw
 * query (what live `hybrid_search` pins on). `wrongRoutes` counts cases where
 * routing returns a brief that is NOT the expected one — a wrong *route*, which
 * the main loop further classifies into applied vs regression *pins*.
 */
function evalRouting(cases, briefMap, searchIndex, opts, keyOf = (c) => c.topic || c.query) {
  const positives = cases.filter((c) => !c.negative);
  let routes = 0, correct = 0, abst = 0, negTotal = 0, negAbst = 0;
  const wrongRouteIds = [];
  for (const c of cases) {
    const r = routeBrief(briefMap, searchIndex, keyOf(c), opts);
    const routed = r.path !== null;
    if (routed) routes++; else abst++;
    if (c.negative) {
      negTotal++;
      if (!routed) negAbst++;
      else wrongRouteIds.push(c.id); // negative that routed → unwanted route
    } else if (routed && r.path === c.expectedBrief) {
      correct++;
    } else if (routed) {
      wrongRouteIds.push(c.id); // positive routed to the wrong brief → wrong route
    }
  }
  return {
    precision: routes ? correct / routes : 1,
    recall: positives.length ? correct / positives.length : 0,
    abstention: abst / cases.length,
    negAccuracy: negTotal ? negAbst / negTotal : 1,
    // A wrong *route* — not yet a wrong *pin*. rrf() only applies pins that were
    // retrieved (kw∪sem); the applied/regression tiers are computed in the main loop.
    wrongRoutes: wrongRouteIds.length,
    wrongRouteIds,
  };
}

try {
  const vaultRoot = await resolveVaultRoot(args.vault);
  const cases = fs.readFileSync(casesPath, "utf8").split("\n")
    .map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));
  if (cases.length === 0) fail(`no cases in ${casesPath}`);

  const vm = new VaultManager(vaultRoot);
  const notes = await vm.getAllNotes();
  const searchIndex = new SearchIndex({ now: () => EVAL_EPOCH });
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
  // Pin-harm tiers (split from the routing-only wrongRoutes count). Only the loop
  // has the retrieval candidate set, so applied/regression are computed here.
  const appliedWrongPinIds = [];
  // Retrieval regression caused by the pin, measured vs raw RRF (NOT all user harm).
  const severeRegressionIds = []; // severe: an expected note dropped out of top-k
  const rankingRegressionIds = []; // ranking: expected note demoted from rank 1 (still in top-k)
  const normPath = (p) => p.replace(/^\.\//, "");
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
    // Parity split. Live hybrid_search pins the brief routed from the raw query;
    // the eval historically pinned from the clean `topic` keyword users never
    // supply, inflating recall. Measure all three: raw (no pin), query-pin
    // (live-faithful, headline), topic-pin (diagnostic — the old number).
    const routeQuery = routeBrief(briefMap, searchIndex, c.query);
    const routeTopic = routeBrief(briefMap, searchIndex, c.topic || c.query);
    const weight = (p) => (isRawSession(p) ? 0.7 : 1);
    const hybRaw = rrf([kw, sem], { weight });
    const hybQueryPin = rrf([kw, sem], { weight, pins: routeQuery.path ? [routeQuery.path] : [] });
    const hybTopicPin = rrf([kw, sem], { weight, pins: routeTopic.path ? [routeTopic.path] : [] });

    const keyword = negative ? EMPTY : scoreRetrieval(kw, expectedNotes, K);
    const semantic = negative || !embeddingIndex ? EMPTY : scoreRetrieval(sem, expectedNotes, K);
    const hybridRaw = negative ? EMPTY : scoreRetrieval(hybRaw, expectedNotes, K);
    const hybridQueryPin = negative ? EMPTY : scoreRetrieval(hybQueryPin, expectedNotes, K);
    const hybridTopicPin = negative ? EMPTY : scoreRetrieval(hybTopicPin, expectedNotes, K);
    // Routing correctness reported on the topic keyword (faithful to get_brief).
    const rHit = c.negative ? routeTopic.path === null : routeTopic.path === (c.expectedBrief ?? null);
    scores.push({ id: c.id, negative, stratum: c.stratum || "untagged", keyword, semantic, hybridRaw, hybridQueryPin, hybridTopicPin, routingHit: rHit });

    // Pin-harm tiers for the live query path. A wrong *route* becomes a wrong
    // *pin* only if the routed brief was retrieved (rrf ignores unretrieved pins),
    // and a regression (vs raw RRF) only if it displaced an expected note from top-k or rank 1.
    const rq = routeQuery.path;
    const eb = c.expectedBrief ?? null;
    if (rq !== null && rq !== eb) {
      const cand = new Set([...kw, ...sem].map(normPath));
      if (cand.has(normPath(rq))) {
        appliedWrongPinIds.push(c.id);
        if (!negative) {
          const exp = new Set(expectedNotes.map(normPath));
          const rawTop = hybRaw.slice(0, K).map(normPath);
          const pinTop = hybQueryPin.slice(0, K).map(normPath);
          const droppedTopK = rawTop.some((p) => exp.has(p)) && !pinTop.some((p) => exp.has(p));
          const lostRank1 = rawTop.length > 0 && exp.has(rawTop[0]) && !(pinTop.length > 0 && exp.has(pinTop[0]));
          // Classify by severity; a top-k drop subsumes a rank-1 loss.
          if (droppedTopK) severeRegressionIds.push(c.id);
          else if (lostRank1) rankingRegressionIds.push(c.id);
        }
      }
    }

    // Headline misses use the live-faithful query-pin mode.
    if (negative && !rHit) misses.push(`\`${c.id}\` (negative) — routed to ${routeTopic.path}`);
    else if (!negative && (!hybridQueryPin.success || !rHit))
      misses.push(`\`${c.id}\` [${c.stratum || "?"}] — query-pin ${hybridQueryPin.success ? "y" : "n"} (raw ${hybridRaw.success ? "y" : "n"}/topic-pin ${hybridTopicPin.success ? "y" : "n"}/kw ${keyword.success ? "y" : "n"}/sem ${semantic.success ? "y" : "n"}), routing ${rHit ? "ok" : `→ ${routeTopic.path || "abstain"} (${routeTopic.method}), want ${c.expectedBrief || "none"}`}`);
  }

  const a = aggregate(scores);
  // Topic path = faithful to get_brief (explicit topic arg). Query path = what
  // live hybrid_search pins on; its false positives are live wrong-pin risk.
  const routingTopic = evalRouting(cases, briefMap, searchIndex, {});
  const routingQuery = evalRouting(cases, briefMap, searchIndex, {}, (c) => c.query);
  const hybRecallCI = bootstrapCI(scores.filter((s) => !s.negative).map((s) => s.hybridQueryPin.recall));

  // per-stratum success (hybrid query-pin) — only meaningful with semantic on.
  const strata = [...new Set(scores.map((s) => s.stratum))].sort();
  const stratLines = strata.map((st) => {
    const ss = scores.filter((s) => s.stratum === st);
    const pos = ss.filter((s) => !s.negative);
    const succ = !withSemantic ? "—" : pos.length ? pct(pos.filter((s) => s.hybridQueryPin.success).length / pos.length) : "—";
    const negAcc = ss.some((s) => s.negative)
      ? pct(ss.filter((s) => s.negative && s.routingHit).length / ss.filter((s) => s.negative).length)
      : "—";
    return `| ${st} | ${ss.length} | ${succ} | ${negAcc} |`;
  });

  const stamp = new Date().toISOString();
  const date = stamp.slice(0, 10);
  const mode = faithful ? "faithful" : withSemantic ? "curated" : "no-semantic";
  const epochIso = new Date(EVAL_EPOCH).toISOString();
  // Three tiers of decreasing blast radius: route (wrong destination) ⊇ applied
  // (rrf actually pinned it) ⊇ regression (it displaced an expected note vs raw RRF).
  const wrongRoutes = routingQuery.wrongRoutes;
  const applied = appliedWrongPinIds.length;
  const severeRegression = severeRegressionIds.length;
  const rankingRegression = rankingRegressionIds.length;
  const regression = severeRegression + rankingRegression;
  const idList = (ids) => ids.map((id) => `\`${id}\``).join(", ");
  const semCell = (v) => (withSemantic ? `**${v}**` : "— (suppressed in no-semantic)");
  const md = [
    `# Memory eval scorecard — ${date}`,
    ``,
    `vault: \`${args.vault || "default"}\` · cases: ${a.count} (${a.positives} pos / ${a.negatives} neg) · k: ${K} · mode: \`${mode}\` · semantic: ${withSemantic ? (faithful ? "on (faithful/all-notes)" : "on (curated)") : "off"} · clock: ${epochIso} (frozen) · ${stamp}`,
    ``,
    `## Retrieval`,
    `| Mode | recall@${K} | success@${K} | MRR |`,
    `|---|---|---|---|`,
    `| Keyword | ${pct(a.keyword.recall)} | ${pct(a.keyword.success)} | ${f(a.keyword.mrr)} |`,
    `| Semantic | ${withSemantic ? pct(a.semantic.recall) : "—"} | ${withSemantic ? pct(a.semantic.success) : "—"} | ${withSemantic ? f(a.semantic.mrr) : "—"} |`,
    `| Hybrid raw (no pin) | ${withSemantic ? pct(a.hybridRaw.recall) : "—"} | ${withSemantic ? pct(a.hybridRaw.success) : "—"} | ${withSemantic ? f(a.hybridRaw.mrr) : "—"} |`,
    `| **Hybrid query-pin (live)** | ${withSemantic ? pct(a.hybridQueryPin.recall) : "—"} | ${withSemantic ? pct(a.hybridQueryPin.success) : "—"} | ${withSemantic ? f(a.hybridQueryPin.mrr) : "—"} |`,
    `| Hybrid topic-pin (diagnostic) | ${withSemantic ? pct(a.hybridTopicPin.recall) : "—"} | ${withSemantic ? pct(a.hybridTopicPin.success) : "—"} | ${withSemantic ? f(a.hybridTopicPin.mrr) : "—"} |`,
    ``,
    `Headline **query-pin** mirrors live \`hybrid_search\` (pins the brief routed from the raw query). **topic-pin** pins from the clean \`topic\` keyword the eval supplies but real callers don't — the topic-pin − query-pin gap is harness assistance, not product behavior.`,
    ``,
    `Parity delta (topic-pin − query-pin) recall@${K}: ${withSemantic ? pct(a.hybridTopicPin.recall - a.hybridQueryPin.recall) : "—"} · success@${K}: ${withSemantic ? pct(a.hybridTopicPin.success - a.hybridQueryPin.success) : "—"}`,
    ``,
    `Hybrid query-pin recall@${K} 95% CI: ${withSemantic ? `[${pct(hybRecallCI[0])}, ${pct(hybRecallCI[1])}]` : "— (suppressed in no-semantic)"}`,
    ``,
    `## Brief routing — topic path (faithful to \`get_brief\`)`,
    `\`get_brief\` takes an explicit topic argument, so this measures routing on the \`topic\` keyword. Precision over recall — abstain beats wrong.`,
    `| Metric | Score |`,
    `|---|---|`,
    `| Routing precision (of routed) | **${pct(routingTopic.precision)}** |`,
    `| Routing recall (positives routed correctly) | ${pct(routingTopic.recall)} |`,
    `| Abstention rate | ${pct(routingTopic.abstention)} |`,
    `| Negative-routing accuracy | **${pct(routingTopic.negAccuracy)}** |`,
    ``,
    `## Brief routing — query path (live \`hybrid_search\` pin source)`,
    `Live \`hybrid_search\` routes/pins on the raw **query**. A wrong route only *applies* as a pin if the routed brief was retrieved (rrf ignores unretrieved pins), and only causes a *retrieval regression* if that pin displaces an expected note **relative to raw RRF**. Subset chain — regression ⊆ applied ⊆ wrong-routes. NB: this measures retrieval regression vs raw RRF, not all possible user harm (a wrong pin at rank 1 can mislead first context even when recall is unchanged — tracked separately, later).`,
    `| Metric | Score |`,
    `|---|---|`,
    `| Routing precision (of routed) | **${pct(routingQuery.precision)}** |`,
    `| Routing recall (positives routed correctly) | ${pct(routingQuery.recall)} |`,
    `| Abstention rate | ${pct(routingQuery.abstention)} |`,
    `| Negative-routing accuracy | **${pct(routingQuery.negAccuracy)}** |`,
    `| Wrong query routes (route ≠ expected brief) | **${wrongRoutes}** |`,
    `| ↳ Applied wrong pins (route was retrieved → pinned) | ${semCell(applied)} |`,
    `| ↳ Pin-induced retrieval regression (vs raw RRF) | ${semCell(regression)} |`,
    `| &nbsp;&nbsp;&nbsp;• severe — expected note dropped from top-${K} | ${semCell(severeRegression)} |`,
    `| &nbsp;&nbsp;&nbsp;• mild (ranking) — demoted from rank 1, still in top-${K} | ${semCell(rankingRegression)} |`,
    ...(wrongRoutes ? [``, `Wrong-route cases: ${idList(routingQuery.wrongRouteIds)}`] : []),
    ...(withSemantic && applied ? [`Applied wrong-pin cases: ${idList(appliedWrongPinIds)}`] : []),
    ...(withSemantic && severeRegression ? [`Severe regression (top-${K} drop) cases: ${idList(severeRegressionIds)}`] : []),
    ...(withSemantic && rankingRegression ? [`Ranking regression (rank-1 demotion) cases: ${idList(rankingRegressionIds)}`] : []),
    ``,
    `## Per-stratum`,
    `| Stratum | n | query-pin success@${K} | neg-routing acc |`,
    `|---|---|---|---|`,
    ...stratLines,
    ``,
    `## Misses (${withSemantic ? misses.length : "—"})`,
    ...(withSemantic
      ? (misses.length ? misses.map((m) => `- ${m}`) : ["- none"])
      : ["- (hybrid misses require semantic; re-run without --no-semantic)"]),
    ``,
  ].join("\n");

  const outDir = path.join(REPO, "evals", "results");
  fs.mkdirSync(outDir, { recursive: true });
  // Mode-stamped so curated / no-semantic / faithful runs never clobber each other.
  const base = `${date}-${mode}`;
  fs.writeFileSync(path.join(outDir, `${base}.md`), md);
  fs.writeFileSync(
    path.join(outDir, `${base}.json`),
    JSON.stringify(
      {
        stamp, vault: args.vault, k: K, mode, faithful, evalEpoch: epochIso,
        aggregate: a,
        routing: { topic: routingTopic, query: routingQuery },
        pinAnalysis: {
          wrongRoutes: routingQuery.wrongRoutes,
          wrongRouteIds: routingQuery.wrongRouteIds,
          // applied/regression need the retrieval candidate set → null without semantic.
          appliedWrongPins: withSemantic ? appliedWrongPinIds.length : null,
          appliedWrongPinIds: withSemantic ? appliedWrongPinIds : null,
          // Retrieval regression vs raw RRF (not all user harm). null when suppressed.
          pinRegressions: withSemantic ? regression : null,
          severeRegressionIds: withSemantic ? severeRegressionIds : null,
          rankingRegressionIds: withSemantic ? rankingRegressionIds : null,
        },
        hybRecallCI, scores,
      },
      null,
      2
    )
  );
  console.log(md);
  console.log(`\nScorecard written to evals/results/${base}.md`);
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
