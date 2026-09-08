import { describe, it, expect } from "vitest";
import {
  aggregate,
  buildJudgePrompt,
  buildRecallPrompt,
  labelFor,
  parseJudgeOutput,
  renderScorecard,
  shuffleWithSeed,
  type AgentAnswer,
  type Condition,
  type Judgment,
  type RubricScore,
  type TaskCase,
} from "../engine/eval/task-eval.js";
import { buildAnswerArgs, buildJudgeArgs } from "../cli/task-eval-runner.js";

const cases: TaskCase[] = [
  { id: "c1", question: "what is k in rrf", gold: "60", sources: ["a.md"], stratum: "factual" },
  { id: "c2", question: "why demote sessions", gold: "verbose", sources: ["b.md"], stratum: "rationale" },
  { id: "c3", question: "how to shard pinecone", gold: "not covered", sources: [], stratum: "negative", negative: true },
];
const conds: Condition[] = ["bare", "recall", "plugin"];

function score(correctness: 0 | 1 | 2, grounding: 0 | 1 | 2 = correctness, fabrication: 0 | 1 = 0, abstained = false): RubricScore {
  return { correctness, grounding, fabrication, abstained };
}

function judgment(caseId: string, pass: number, ranking: Condition[], scores: Partial<Record<Condition, RubricScore>>): Judgment {
  return { caseId, pass, order: conds, ranking, scores, reason: `pass ${pass}` };
}

describe("shuffleWithSeed", () => {
  it("is deterministic and a permutation", () => {
    const a = shuffleWithSeed(conds, 7);
    const b = shuffleWithSeed(conds, 7);
    expect(a).toEqual(b);
    expect([...a].sort()).toEqual([...conds].sort());
    expect(shuffleWithSeed(conds, 8)).not.toEqual(shuffleWithSeed(conds, 9));
  });
});

describe("judge prompt and parsing", () => {
  it("labels answers in the shown order and maps labels back", () => {
    const answers: AgentAnswer[] = [
      { caseId: "c1", condition: "bare", text: "I do not know." },
      { caseId: "c1", condition: "recall", text: "k is 60." },
      { caseId: "c1", condition: "plugin", text: "", error: "timed out" },
    ];
    const order: Condition[] = ["recall", "plugin", "bare"];
    const p = buildJudgePrompt(cases[0], answers, order);
    expect(p.indexOf("### Answer A\n\nk is 60.")).toBeGreaterThan(0);
    expect(p).toContain("### Answer B\n\n(no answer: timed out)");
    expect(p).toContain("### Answer C\n\nI do not know.");
    expect(labelFor(2)).toBe("C");

    const parsed = parseJudgeOutput(
      { scores: [{ label: "A", correctness: 2, grounding: 2, fabrication: 0, abstained: false }, { label: "Answer C", correctness: 0, grounding: 0, fabrication: 0, abstained: true }], ranking: ["A", "C"], reason: "A matches." },
      order
    );
    expect(parsed.scores.recall).toEqual(score(2, 2));
    expect(parsed.scores.bare).toEqual({ correctness: 0, grounding: 0, fabrication: 0, abstained: true });
    expect(parsed.ranking).toEqual(["recall", "bare", "plugin"]);
  });

  it("adds the negative-case instruction and keeps the recall block ahead of the question", () => {
    expect(buildJudgePrompt(cases[2], [], conds)).toContain("NOT covered by the knowledge base");
    expect(buildJudgePrompt(cases[0], [], conds)).not.toContain("NOT covered");
    expect(buildRecallPrompt("Retrieved from vault", "q?")).toBe("Retrieved from vault\n\n---\n\nq?");
    expect(buildRecallPrompt(null, "q?")).toBe("q?");
  });
});

describe("aggregate", () => {
  const answers: AgentAnswer[] = cases.flatMap((c) =>
    conds.map((cond) => ({ caseId: c.id, condition: cond, text: "x", latencyMs: cond === "plugin" ? 30000 : 5000, costUsd: 0.1 }))
  );
  const judgments: Judgment[] = [
    // c1: recall and plugin beat bare in both passes
    judgment("c1", 0, ["plugin", "recall", "bare"], { bare: score(0), recall: score(2), plugin: score(2) }),
    judgment("c1", 1, ["recall", "plugin", "bare"], { bare: score(0), recall: score(2), plugin: score(2) }),
    // c2: recall beats bare once, loses once (tie); plugin loses both
    judgment("c2", 0, ["recall", "bare", "plugin"], { bare: score(1), recall: score(1), plugin: score(0, 0, 1) }),
    judgment("c2", 1, ["bare", "recall", "plugin"], { bare: score(1), recall: score(1), plugin: score(0, 0, 1) }),
    // c3 negative: bare abstains, plugin fabricates
    judgment("c3", 0, ["bare", "recall", "plugin"], { bare: score(2, 0, 0, true), recall: score(2, 0, 0, true), plugin: score(0, 1, 1, false) }),
    judgment("c3", 1, ["recall", "bare", "plugin"], { bare: score(2, 0, 0, true), recall: score(2, 0, 0, true), plugin: score(0, 1, 1, false) }),
  ];

  it("computes wins only when a condition beats the baseline in every pass", () => {
    const r = aggregate(cases, answers, judgments, { baseline: "bare", conditions: conds });
    const recall = r.conditions.find((c) => c.condition === "recall")!;
    const plugin = r.conditions.find((c) => c.condition === "plugin")!;
    expect([recall.wins, recall.ties, recall.losses]).toEqual([1, 2, 0]);
    expect([plugin.wins, plugin.ties, plugin.losses]).toEqual([1, 0, 2]);
    expect(recall.winRate).toBeCloseTo(1 / 3);
    expect(plugin.fabricationRate).toBeCloseTo(4 / 6);
    expect(plugin.negativeAbstainRate).toBe(0);
    expect(recall.negativeAbstainRate).toBe(1);
    expect(plugin.meanLatencyMs).toBe(30000);
    expect(r.cases.find((c) => c.id === "c2")!.outcome).toEqual({ recall: "tie", plugin: "loss" });
    const neg = r.perStratum.find((s) => s.stratum === "negative")!;
    expect(neg.winRate.plugin).toBe(0);
    expect(r.passes).toBe(2);
  });

  it("renders a scorecard with the headline table, losses, and per-case rows", () => {
    const r = aggregate(cases, answers, judgments, { baseline: "bare", conditions: conds });
    const md = renderScorecard(r, { vault: "demo", date: "2026-09-08", casesPath: "x", seed: 42, stamp: "s" });
    expect(md).toContain("| **recall** |");
    expect(md).toContain("`c2` [rationale] lost with plugin");
    expect(md).toContain("| `c3` | negative (neg) |");
    expect(md).not.toContain("—|—");
  });
});

describe("claude argument builders", () => {
  it("bare and recall deny every tool and replace the system prompt; plugin allows only accretion", () => {
    const bare = buildAnswerArgs("bare", "q", {});
    expect(bare).toContain("--system-prompt");
    expect(bare.join(" ")).toContain("--disallowedTools Bash,Read,Write");
    expect(bare).not.toContain("--plugin-dir");
    const plugin = buildAnswerArgs("plugin", "q", { pluginDir: "/p", model: "sonnet" });
    expect(plugin).toContain("--append-system-prompt");
    expect(plugin).not.toContain("--system-prompt");
    expect(plugin.slice(plugin.indexOf("--allowedTools"), plugin.indexOf("--allowedTools") + 3)).toEqual(["--allowedTools", "Bash(accretion *)", "Read"]);
    expect(plugin).toContain("--plugin-dir");
    expect(plugin).toContain("sonnet");
    const judge = buildJudgeArgs("j", { model: "opus" });
    expect(judge).toContain("--json-schema");
    expect(judge[judge.indexOf("--model") + 1]).toBe("opus");
  });
});
