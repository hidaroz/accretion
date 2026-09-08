// Task-level eval: does the vault make an agent's answers better?
//
// A case is a real question, a human-written gold answer, and the notes a good
// answer draws on. Each case is answered under several conditions (no vault,
// passive recall only, the full plugin), then a blind judge scores every answer
// against the gold. Judging runs twice per case with the answers shuffled, so a
// condition only "wins" when it beats the baseline in both orders. Everything
// here is pure: runners and judges are injected, so the harness is testable
// without a model.

import { bootstrapCI } from "./metrics.js";

export interface TaskCase {
  id: string;
  question: string;
  gold: string;
  sources: string[];
  stratum: string;
  negative?: boolean;
  notes?: string;
  draft?: boolean;
}

export type Condition = "bare" | "recall" | "plugin";
export const ALL_CONDITIONS: Condition[] = ["bare", "recall", "plugin"];

export interface AgentAnswer {
  caseId: string;
  condition: Condition;
  text: string;
  model?: string;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  turns?: number;
  /** Paths passive recall injected (recall condition) or the CLI read (plugin). */
  injected?: string[];
  /** Recall condition only: which tier produced the injected block ("brief", "hits", "none"). */
  recallTier?: string;
  error?: string;
}

export interface RubricScore {
  /** 0 wrong or missing, 1 partly right, 2 matches the gold. */
  correctness: 0 | 1 | 2;
  /** 0 generic, 1 some vault-specific detail, 2 clearly drawn from the notes. */
  grounding: 0 | 1 | 2;
  /** 1 when the answer asserts vault-specific facts the gold contradicts or does not support. */
  fabrication: 0 | 1;
  /** The answer says the material is not covered (what a negative case wants). */
  abstained: boolean;
}

export interface Judgment {
  caseId: string;
  pass: number;
  /** Conditions in the order the judge saw them, labelled A, B, C. */
  order: Condition[];
  scores: Partial<Record<Condition, RubricScore>>;
  /** Best first. */
  ranking: Condition[];
  reason: string;
}

export interface AgentRunner {
  answer(c: TaskCase, condition: Condition): Promise<AgentAnswer>;
}

export interface Judge {
  judge(c: TaskCase, answers: AgentAnswer[], order: Condition[], pass: number): Promise<Judgment>;
}

/** Deterministic shuffle so a scorecard is reproducible from its seed. */
export function shuffleWithSeed<T>(items: T[], seed: number): T[] {
  const out = [...items];
  let s = (seed >>> 0) || 1;
  const rand = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function labelFor(i: number): string {
  return String.fromCharCode(65 + i);
}

/** The recall condition: the same block the hook would inject, ahead of the question. */
export function buildRecallPrompt(injected: string | null, question: string): string {
  if (!injected) return question;
  return `${injected}\n\n---\n\n${question}`;
}

export const ANSWER_SYSTEM_PROMPT =
  "You answer a question about a specific project or knowledge base. Be concrete and brief (under 200 words). " +
  "If you do not have the information to answer, say so plainly instead of guessing; do not invent project-specific facts.";

export const JUDGE_SCHEMA = {
  type: "object",
  properties: {
    scores: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          correctness: { type: "integer", minimum: 0, maximum: 2 },
          grounding: { type: "integer", minimum: 0, maximum: 2 },
          fabrication: { type: "integer", minimum: 0, maximum: 1 },
          abstained: { type: "boolean" },
        },
        required: ["label", "correctness", "grounding", "fabrication", "abstained"],
      },
    },
    ranking: { type: "array", items: { type: "string" } },
    reason: { type: "string" },
  },
  required: ["scores", "ranking", "reason"],
} as const;

export function buildJudgePrompt(c: TaskCase, answers: AgentAnswer[], order: Condition[]): string {
  const byCond = new Map(answers.map((a) => [a.condition, a]));
  const blocks = order.map((cond, i) => {
    const a = byCond.get(cond);
    const text = a?.error ? `(no answer: ${a.error})` : (a?.text ?? "(no answer)");
    return `### Answer ${labelFor(i)}\n\n${text.trim()}`;
  });
  const negativeNote = c.negative
    ? "\nThis question is NOT covered by the knowledge base. The best answer says so plainly. Mark `abstained` true for an answer that declines or says the material is not available, and score fabrication 1 for any answer that supplies knowledge-base-specific guidance anyway.\n"
    : "";
  return [
    "You are grading answers to one question about a private knowledge base. You see the question, a reference answer written by the base's owner, and several candidate answers labelled A, B, C. You do not know which system produced which answer.",
    "",
    "Score each candidate:",
    "- correctness 0-2: 0 wrong or missing, 1 partly right, 2 matches the reference in substance.",
    "- grounding 0-2: 0 generic advice, 1 some specifics that match the reference, 2 clearly drawn from the same material as the reference.",
    "- fabrication 0/1: 1 if the answer asserts knowledge-base-specific facts the reference contradicts or does not support. Generic, hedged statements are not fabrication.",
    "- abstained: true if the answer says it does not have the information.",
    "Then rank the labels best to worst (ties broken by fewer fabrications, then shorter). One sentence of reason.",
    negativeNote,
    `## Question\n\n${c.question}`,
    "",
    `## Reference answer\n\n${c.gold}`,
    c.notes ? `\nJudge notes: ${c.notes}` : "",
    "",
    ...blocks.flatMap((b) => [b, ""]),
  ].join("\n");
}

export interface RawJudgeOutput {
  scores: Array<{ label: string; correctness: number; grounding: number; fabrication: number; abstained: boolean }>;
  ranking: string[];
  reason: string;
}

export function parseJudgeOutput(raw: RawJudgeOutput, order: Condition[]): Pick<Judgment, "scores" | "ranking" | "reason"> {
  const labelToCond = new Map(order.map((c, i) => [labelFor(i), c]));
  const scores: Partial<Record<Condition, RubricScore>> = {};
  for (const s of raw.scores ?? []) {
    const cond = labelToCond.get(String(s.label).trim().toUpperCase().replace(/^ANSWER\s+/, ""));
    if (!cond) continue;
    scores[cond] = {
      correctness: clamp(s.correctness, 0, 2) as 0 | 1 | 2,
      grounding: clamp(s.grounding, 0, 2) as 0 | 1 | 2,
      fabrication: clamp(s.fabrication, 0, 1) as 0 | 1,
      abstained: !!s.abstained,
    };
  }
  const ranking = (raw.ranking ?? [])
    .map((l) => labelToCond.get(String(l).trim().toUpperCase().replace(/^ANSWER\s+/, "")))
    .filter((c): c is Condition => !!c);
  // Any condition the judge forgot to rank goes last, in shown order.
  for (const c of order) if (!ranking.includes(c)) ranking.push(c);
  return { scores, ranking, reason: String(raw.reason ?? "") };
}

function clamp(n: unknown, lo: number, hi: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

export interface SourceExcerpt {
  path: string;
  content: string;
}

export type ClaimStatus = "supported" | "unsupported" | "contradicted";

/**
 * The second judge pass. The comparative judge sees only the gold, so a true
 * vault fact the gold omits looks like fabrication. This pass sees the source
 * notes and lists every knowledge-base-specific claim with its status.
 */
export interface FabricationJudgment {
  caseId: string;
  condition: Condition;
  claims: Array<{ claim: string; status: ClaimStatus }>;
  /** The answer supplies project-specific how-to guidance (bad on a negative case). */
  offersGuidance: boolean;
  abstained: boolean;
  reason: string;
}

export const FABRICATION_SCHEMA = {
  type: "object",
  properties: {
    claims: {
      type: "array",
      items: {
        type: "object",
        properties: {
          claim: { type: "string" },
          status: { type: "string", enum: ["supported", "unsupported", "contradicted"] },
        },
        required: ["claim", "status"],
      },
    },
    offersGuidance: { type: "boolean" },
    abstained: { type: "boolean" },
    reason: { type: "string" },
  },
  required: ["claims", "offersGuidance", "abstained", "reason"],
} as const;

/** Bump when the fabrication rubric changes; the cache key carries it so old judgments retire. */
export const FABRICATION_RUBRIC_VERSION = 4;

export function buildFabricationPrompt(c: TaskCase, answer: AgentAnswer, sources: SourceExcerpt[]): string {
  const src = sources.length
    ? sources.map((s) => `### ${s.path}\n\n${s.content.trim()}`).join("\n\n")
    : "(no source notes; every knowledge-base-specific claim is therefore unsupported)";
  const negativeNote = c.negative
    ? "\nThis question is NOT answered by the knowledge base. The notes below are the nearest material, included so you can tell a quoted fact from an extrapolated one. Any project-specific procedure, setting, or fact the notes do not state is unsupported, even if plausible.\n"
    : "";
  return [
    "You are checking one answer against the source notes it was supposed to draw on. You do not know which system produced it.",
    "",
    "List every claim the answer presents as true OF THIS PROJECT OR KNOWLEDGE BASE: a fact, number, name, path, setting, mechanism, or procedure attributed to the project, its notes, its code, or its conventions. For each claim give a status:",
    "- supported: stated in the notes below in substance; a paraphrase or a direct consequence of what the notes say counts as supported.",
    "- unsupported: not in the notes, presented as a fact about this project.",
    "- contradicted: the notes say otherwise.",
    "Not claims, leave them out: general knowledge about the world or the domain stated as general knowledge (baking, cycling, how an algorithm is usually described, what a standard tool does), hedged statements (\"typically\", \"in general\", \"one option is\"), and statements about the answerer's own situation such as what its context did or did not contain, what was truncated, or what it could not access. Only what is asserted about this project counts.",
    "Then: offersGuidance is true if the answer supplies project-specific how-to guidance or a procedure (a generic recommendation is not guidance); abstained is true if the answer says the project material is not available or that it does not know. One sentence of reason.",
    negativeNote,
    `## Question\n\n${c.question}`,
    "",
    `## Answer\n\n${(answer.error ? `(no answer: ${answer.error})` : answer.text).trim()}`,
    "",
    "## Source notes",
    "",
    src,
    "",
  ].join("\n");
}

export interface RawFabricationOutput {
  claims?: Array<{ claim?: string; status?: string }>;
  offersGuidance?: boolean;
  abstained?: boolean;
  reason?: string;
}

export function parseFabricationOutput(raw: RawFabricationOutput, caseId: string, condition: Condition): FabricationJudgment {
  const claims = (Array.isArray(raw.claims) ? raw.claims : [])
    .filter((c) => c && typeof c.claim === "string" && c.claim.trim())
    .map((c) => {
      const st = String(c.status ?? "").toLowerCase();
      const status: ClaimStatus = st === "contradicted" ? "contradicted" : st === "supported" ? "supported" : "unsupported";
      return { claim: c.claim!.trim(), status };
    });
  return {
    caseId,
    condition,
    claims,
    offersGuidance: !!raw.offersGuidance,
    abstained: !!raw.abstained,
    reason: String(raw.reason ?? ""),
  };
}

export function hasUnsupported(f: FabricationJudgment): boolean {
  return f.claims.some((c) => c.status !== "supported");
}

export interface ConditionSummary {
  condition: Condition;
  n: number;
  meanCorrectness: number;
  meanGrounding: number;
  fabricationRate: number;
  /** Negative cases where the answer abstained (higher is better). */
  negativeAbstainRate: number | null;
  /** Non-negative cases where correctness == 2 in both passes. */
  fullyCorrectRate: number;
  /** Positive cases where the comparative judge saw an abstention (over-abstention; lower is better). */
  positiveAbstainRate: number;
  /** From the source-aware pass: answers with at least one unsupported or contradicted claim. Null without the pass. */
  unsupportedRate: number | null;
  /** From the source-aware pass: answers with at least one contradicted claim. */
  contradictedRate: number | null;
  /** Negative cases where the answer abstained and offered no project-specific guidance. */
  negativeCleanAbstainRate: number | null;
  /** vs baseline: won in both judge passes / lost in both / otherwise tie. */
  wins: number;
  losses: number;
  ties: number;
  winRate: number;
  winRateCI: [number, number];
  meanLatencyMs: number | null;
  meanCostUsd: number | null;
  errors: number;
}

export interface CaseSummary {
  id: string;
  stratum: string;
  negative: boolean;
  /** Per condition: mean correctness over passes. */
  correctness: Partial<Record<Condition, number>>;
  /** vs baseline per condition: "win" | "loss" | "tie". */
  outcome: Partial<Record<Condition, "win" | "loss" | "tie">>;
  reasons: string[];
  /** From the source-aware pass: unsupported or contradicted claims per condition. */
  unsupported: Partial<Record<Condition, string[]>>;
}

export interface RecallTierSummary {
  tier: string;
  n: number;
  meanCorrectness: number;
  unsupportedRate: number | null;
}

export interface TaskEvalReport {
  conditions: ConditionSummary[];
  /** The recall condition broken down by the tier that produced the injection. */
  recallByTier: RecallTierSummary[];
  cases: CaseSummary[];
  perStratum: Array<{ stratum: string; n: number; winRate: Partial<Record<Condition, number>>; meanCorrectness: Partial<Record<Condition, number>> }>;
  baseline: Condition;
  passes: number;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function aggregate(
  cases: TaskCase[],
  answers: AgentAnswer[],
  judgments: Judgment[],
  options: { baseline?: Condition; conditions?: Condition[]; seed?: number; fabrications?: FabricationJudgment[] } = {}
): TaskEvalReport {
  const baseline = options.baseline ?? "bare";
  const fabs = options.fabrications ?? [];
  const fabOf = (id: string, cond: Condition) => fabs.find((f) => f.caseId === id && f.condition === cond);
  const conditions = options.conditions ?? ALL_CONDITIONS;
  const passes = Math.max(1, ...judgments.map((j) => j.pass + 1));
  const byCase = new Map<string, Judgment[]>();
  for (const j of judgments) byCase.set(j.caseId, [...(byCase.get(j.caseId) ?? []), j]);
  const answerOf = (id: string, cond: Condition) => answers.find((a) => a.caseId === id && a.condition === cond);

  const caseSummaries: CaseSummary[] = [];
  for (const c of cases) {
    const js = byCase.get(c.id) ?? [];
    const cs: CaseSummary = { id: c.id, stratum: c.stratum, negative: !!c.negative, correctness: {}, outcome: {}, reasons: js.map((j) => j.reason), unsupported: {} };
    for (const cond of conditions) {
      const f = fabOf(c.id, cond);
      if (f && hasUnsupported(f)) cs.unsupported[cond] = f.claims.filter((x) => x.status !== "supported").map((x) => `${x.claim} [${x.status}]`);
      const scores = js.map((j) => j.scores[cond]).filter((s): s is RubricScore => !!s);
      if (scores.length) cs.correctness[cond] = mean(scores.map((s) => s.correctness));
      if (cond === baseline || js.length === 0) continue;
      const beats = js.map((j) => j.ranking.indexOf(cond) < j.ranking.indexOf(baseline));
      cs.outcome[cond] = beats.every(Boolean) ? "win" : beats.every((b) => !b) ? "loss" : "tie";
    }
    caseSummaries.push(cs);
  }

  const summaries: ConditionSummary[] = conditions.map((cond) => {
    const scores: RubricScore[] = [];
    const negAbstain: boolean[] = [];
    const posAbstain: boolean[] = [];
    const fullyCorrect: boolean[] = [];
    const unsupported: boolean[] = [];
    const contradicted: boolean[] = [];
    const negClean: boolean[] = [];
    const lat: number[] = [];
    const cost: number[] = [];
    let errors = 0;
    for (const c of cases) {
      const js = byCase.get(c.id) ?? [];
      const s = js.map((j) => j.scores[cond]).filter((x): x is RubricScore => !!x);
      scores.push(...s);
      if (c.negative && s.length) negAbstain.push(s.every((x) => x.abstained));
      if (!c.negative && s.length) posAbstain.push(s.some((x) => x.abstained));
      if (!c.negative && s.length) fullyCorrect.push(s.every((x) => x.correctness === 2));
      const f = fabOf(c.id, cond);
      if (f) {
        unsupported.push(hasUnsupported(f));
        contradicted.push(f.claims.some((x) => x.status === "contradicted"));
        if (c.negative) negClean.push(f.abstained && !f.offersGuidance);
      }
      const a = answerOf(c.id, cond);
      if (a?.error) errors++;
      if (a?.latencyMs !== undefined) lat.push(a.latencyMs);
      if (a?.costUsd !== undefined) cost.push(a.costUsd);
    }
    const outcomes = caseSummaries.map((cs) => cs.outcome[cond]).filter((o): o is "win" | "loss" | "tie" => !!o);
    const wins = outcomes.filter((o) => o === "win").length;
    const losses = outcomes.filter((o) => o === "loss").length;
    const ties = outcomes.filter((o) => o === "tie").length;
    const winVector = outcomes.map((o) => (o === "win" ? 1 : 0));
    return {
      condition: cond,
      n: cases.length,
      meanCorrectness: mean(scores.map((s) => s.correctness)),
      meanGrounding: mean(scores.map((s) => s.grounding)),
      fabricationRate: mean(scores.map((s) => s.fabrication)),
      negativeAbstainRate: negAbstain.length ? mean(negAbstain.map(Number)) : null,
      fullyCorrectRate: mean(fullyCorrect.map(Number)),
      positiveAbstainRate: mean(posAbstain.map(Number)),
      unsupportedRate: unsupported.length ? mean(unsupported.map(Number)) : null,
      contradictedRate: contradicted.length ? mean(contradicted.map(Number)) : null,
      negativeCleanAbstainRate: negClean.length ? mean(negClean.map(Number)) : null,
      wins,
      losses,
      ties,
      winRate: outcomes.length ? wins / outcomes.length : 0,
      winRateCI: cond === baseline || winVector.length === 0 ? [0, 0] : bootstrapCI(winVector, 1000, options.seed ?? 42),
      meanLatencyMs: lat.length ? mean(lat) : null,
      meanCostUsd: cost.length ? mean(cost) : null,
      errors,
    };
  });

  const strata = [...new Set(cases.map((c) => c.stratum))].sort();
  const perStratum = strata.map((stratum) => {
    const ids = new Set(cases.filter((c) => c.stratum === stratum).map((c) => c.id));
    const css = caseSummaries.filter((cs) => ids.has(cs.id));
    const winRate: Partial<Record<Condition, number>> = {};
    const meanCorrectness: Partial<Record<Condition, number>> = {};
    for (const cond of conditions) {
      const outs = css.map((cs) => cs.outcome[cond]).filter(Boolean);
      if (cond !== baseline && outs.length) winRate[cond] = outs.filter((o) => o === "win").length / outs.length;
      const cs = css.map((x) => x.correctness[cond]).filter((v): v is number => v !== undefined);
      if (cs.length) meanCorrectness[cond] = mean(cs);
    }
    return { stratum, n: ids.size, winRate, meanCorrectness };
  });

  const tiers = [...new Set(answers.filter((a) => a.condition === "recall" && a.recallTier).map((a) => a.recallTier!))].sort();
  const recallByTier: RecallTierSummary[] = tiers.map((tier) => {
    const ids = answers.filter((a) => a.condition === "recall" && a.recallTier === tier).map((a) => a.caseId);
    const cs = caseSummaries.filter((x) => ids.includes(x.id)).map((x) => x.correctness.recall).filter((v): v is number => v !== undefined);
    const fs = ids.map((id) => fabOf(id, "recall")).filter((f): f is FabricationJudgment => !!f);
    return { tier, n: ids.length, meanCorrectness: mean(cs), unsupportedRate: fs.length ? mean(fs.map((f) => Number(hasUnsupported(f)))) : null };
  });

  return { conditions: summaries, recallByTier, cases: caseSummaries, perStratum, baseline, passes };
}

const pct = (x: number) => (x * 100).toFixed(1) + "%";
const f2 = (x: number) => x.toFixed(2);

export function renderScorecard(
  report: TaskEvalReport,
  meta: { vault: string; date: string; model?: string; judgeModel?: string; casesPath: string; seed: number; stamp: string }
): string {
  const lines: string[] = [];
  lines.push(`# Task eval scorecard: ${meta.date}`);
  lines.push("");
  lines.push(
    `vault: \`${meta.vault}\` · cases: ${report.cases.length} (${report.cases.filter((c) => !c.negative).length} pos / ${report.cases.filter((c) => c.negative).length} neg) · judge passes: ${report.passes} (answers shuffled per pass) · baseline: \`${report.baseline}\` · model: ${meta.model ?? "default"} · judge: ${meta.judgeModel ?? "default"} · seed: ${meta.seed} · ${meta.stamp}`
  );
  lines.push("");
  lines.push("A condition **wins** a case only when the judge ranks it above the baseline in every pass; **loses** only when below in every pass; anything else is a tie. Win rate is wins over judged cases, with a 95% bootstrap CI.");
  lines.push("");
  lines.push("## Conditions");
  const withFab = report.conditions.some((s) => s.unsupportedRate !== null);
  lines.push("| Condition | correctness (0-2) | grounding (0-2) | unsupported (vs sources) | contradicted | fabrication (vs gold) | fully correct | pos. abstain | neg. abstain | neg. clean abstain | win / tie / loss vs baseline | win rate | 95% CI | latency | errors |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const s of report.conditions) {
    const isBase = s.condition === report.baseline;
    lines.push(
      `| ${isBase ? s.condition : `**${s.condition}**`} | ${f2(s.meanCorrectness)} | ${f2(s.meanGrounding)} | ${s.unsupportedRate === null ? "—" : `**${pct(s.unsupportedRate)}**`} | ${s.contradictedRate === null ? "—" : pct(s.contradictedRate)} | ${pct(s.fabricationRate)} | ${pct(s.fullyCorrectRate)} | ${pct(s.positiveAbstainRate)} | ${s.negativeAbstainRate === null ? "—" : pct(s.negativeAbstainRate)} | ${s.negativeCleanAbstainRate === null ? "—" : pct(s.negativeCleanAbstainRate)} | ${isBase ? "—" : `${s.wins} / ${s.ties} / ${s.losses}`} | ${isBase ? "—" : pct(s.winRate)} | ${isBase ? "—" : `[${pct(s.winRateCI[0])}, ${pct(s.winRateCI[1])}]`} | ${s.meanLatencyMs === null ? "—" : `${(s.meanLatencyMs / 1000).toFixed(1)}s`} | ${s.errors} |`
    );
  }
  lines.push("");
  lines.push(withFab
    ? "\"unsupported (vs sources)\" comes from a second judge pass that sees the case's source notes; \"fabrication (vs gold)\" is the comparative judge, which sees only the reference answer and so also flags true vault facts the reference omits."
    : "The source-aware fabrication pass did not run (`--no-fabrication-pass`); \"fabrication (vs gold)\" also counts true vault facts the reference omits.");
  lines.push("");
  if (report.recallByTier.length > 0) {
    lines.push("## Recall condition by tier");
    lines.push("| Tier | n | correctness | unsupported |");
    lines.push("|---|---|---|---|");
    for (const t of report.recallByTier) lines.push(`| ${t.tier} | ${t.n} | ${f2(t.meanCorrectness)} | ${t.unsupportedRate === null ? "—" : pct(t.unsupportedRate)} |`);
    lines.push("");
  }
  lines.push("## Per stratum");
  const conds = report.conditions.map((c) => c.condition);
  lines.push(`| Stratum | n | ${conds.map((c) => `${c} correctness`).join(" | ")} | ${conds.filter((c) => c !== report.baseline).map((c) => `${c} win rate`).join(" | ")} |`);
  lines.push(`|---|---|${conds.map(() => "---").join("|")}|${conds.filter((c) => c !== report.baseline).map(() => "---").join("|")}|`);
  for (const st of report.perStratum) {
    lines.push(
      `| ${st.stratum} | ${st.n} | ${conds.map((c) => (st.meanCorrectness[c] === undefined ? "—" : f2(st.meanCorrectness[c]!))).join(" | ")} | ${conds
        .filter((c) => c !== report.baseline)
        .map((c) => (st.winRate[c] === undefined ? "—" : pct(st.winRate[c]!)))
        .join(" | ")} |`
    );
  }
  lines.push("");
  const losses = report.cases.filter((c) => Object.values(c.outcome).includes("loss"));
  lines.push(`## Cases where a condition lost to the baseline (${losses.length})`);
  if (losses.length === 0) lines.push("- none");
  for (const c of losses) {
    const lost = Object.entries(c.outcome).filter(([, o]) => o === "loss").map(([k]) => k);
    lines.push(`- \`${c.id}\` [${c.stratum}] lost with ${lost.join(", ")}: ${c.reasons[0] ?? ""}`);
  }
  lines.push("");
  const unsupportedCases = report.cases.filter((c) => Object.keys(c.unsupported).length > 0);
  if (withFab) {
    lines.push(`## Unsupported claims (${unsupportedCases.length} cases)`);
    if (unsupportedCases.length === 0) lines.push("- none");
    for (const c of unsupportedCases) {
      for (const [cond, claims] of Object.entries(c.unsupported)) {
        lines.push(`- \`${c.id}\` [${c.stratum}${c.negative ? ", neg" : ""}] ${cond}:`);
        for (const cl of claims!) lines.push(`  - ${cl}`);
      }
    }
    lines.push("");
  }
  lines.push("## Per case");
  lines.push(`| Case | stratum | ${conds.map((c) => `${c}`).join(" | ")} | outcome |`);
  lines.push(`|---|---|${conds.map(() => "---").join("|")}|---|`);
  for (const c of report.cases) {
    lines.push(
      `| \`${c.id}\` | ${c.stratum}${c.negative ? " (neg)" : ""} | ${conds.map((k) => (c.correctness[k] === undefined ? "—" : f2(c.correctness[k]!))).join(" | ")} | ${conds
        .filter((k) => k !== report.baseline)
        .map((k) => `${k}: ${c.outcome[k] ?? "—"}`)
        .join(", ")} |`
    );
  }
  lines.push("");
  return lines.join("\n");
}
