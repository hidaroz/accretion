import { z } from "zod";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineCommand, vaultFlag } from "../spec.js";
import { loadVaultsConfig, selectVault } from "../../engine/config/vault-config.js";
import {
  ALL_CONDITIONS,
  aggregate,
  renderScorecard,
  shuffleWithSeed,
  FABRICATION_RUBRIC_VERSION,
  type AgentAnswer,
  type Condition,
  type FabricationJudgment,
  type Judgment,
  type TaskCase,
} from "../../engine/eval/task-eval.js";
import { createHash } from "node:crypto";
import { ClaudeHeadlessRunner } from "../task-eval-runner.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

async function readCases(file: string): Promise<TaskCase[]> {
  const raw = await fs.readFile(file, "utf-8");
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as TaskCase);
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf-8")) as T;
  } catch {
    return null;
  }
}

async function pool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

export const taskEval = defineCommand({
  name: "task-eval",
  group: "lifecycle",
  summary: "Does the vault make answers better? Answers cases under bare/recall/plugin, judged blind, with win rates.",
  description:
    "Task-level eval through `claude -p`. Each case (question, gold answer, sources) is answered under the chosen conditions: bare (no vault, no tools), recall (the passive-recall block in front of the question), plugin (the real plugin: skill, hooks, accretion on PATH). A blind judge scores every answer twice with the order shuffled; a condition wins a case only when it beats the baseline in both passes. Answers and judgments are cached under the output directory, so re-runs only spend on what is new. Results for the demo vault go to evals/results/; for any other vault they stay inside the vault under .mcp/task-eval/.",
  input: z.object({
    vault: vaultFlag,
    cases: z.string().optional().describe("Cases file (JSONL). Default: evals/tasks.jsonl for demo, else <vault>/.mcp/task-cases.jsonl."),
    conditions: z.array(z.enum(["bare", "recall", "plugin"])).optional().describe("Conditions to run (default all three)."),
    model: z.string().optional().describe("Model for answering (claude --model)."),
    "judge-model": z.string().optional().describe("Model for judging (default: same default as claude)."),
    passes: z.coerce.number().int().min(1).max(4).default(2).describe("Judge passes per case, answers shuffled each pass."),
    concurrency: z.coerce.number().int().min(1).max(6).default(2).describe("Parallel claude calls."),
    seed: z.coerce.number().int().default(42).describe("Shuffle and bootstrap seed."),
    limit: z.coerce.number().int().min(1).optional().describe("Only the first N cases."),
    only: z.array(z.string()).optional().describe("Only these case ids."),
    "include-drafts": z.boolean().optional().describe("Include cases marked draft: true."),
    rejudge: z.boolean().optional().describe("Discard cached judgments and judge again (answers stay cached)."),
    fresh: z.boolean().optional().describe("Discard cached answers and judgments."),
    "fresh-conditions": z.array(z.enum(["bare", "recall", "plugin"])).optional().describe("Discard cached answers for these conditions only (judgments keyed on answer text refresh by themselves)."),
    label: z.string().optional().describe("Suffix for the scorecard filename, so two runs on one day coexist (e.g. a0, c)."),
    "fabrication-pass": z.boolean().default(true).describe("Run the source-aware fabrication judge on every answer (--no-fabrication-pass to skip)."),
    out: z.string().optional().describe("Output directory (default per vault, see description)."),
    "dry-run": z.boolean().optional().describe("List the cases and calls that would run; spend nothing."),
  }),
  async run(args, ctx) {
    const vaults = await loadVaultsConfig();
    const cfg = selectVault(vaults, args.vault);
    const isDemo = cfg.id === "demo";
    const casesPath = path.resolve(args.cases ?? (isDemo ? path.join(REPO, "evals", "tasks.jsonl") : path.join(cfg.path, ".mcp", "task-cases.jsonl")));
    const outDir = path.resolve(args.out ?? (isDemo ? path.join(REPO, "evals", "results") : path.join(cfg.path, ".mcp", "task-eval")));
    const cacheDir = path.join(outDir, "task-cache", cfg.id);
    const conditions: Condition[] = args.conditions ?? ALL_CONDITIONS;
    const baseline: Condition = conditions.includes("bare") ? "bare" : conditions[0];

    let cases = await readCases(casesPath);
    if (!args["include-drafts"]) cases = cases.filter((c) => !c.draft);
    if (args.only) cases = cases.filter((c) => args.only!.includes(c.id));
    if (args.limit) cases = cases.slice(0, args.limit);
    if (cases.length === 0) throw new Error(`no cases to run from ${casesPath}`);

    const pluginInstalled = existsSync(path.join(process.env.HOME ?? "", ".claude", "skills", "accretion", ".claude-plugin", "plugin.json"));
    const plan = {
      vault: cfg.id,
      cases: cases.length,
      conditions,
      passes: args.passes,
      answerCalls: cases.length * conditions.length,
      judgeCalls: cases.length * args.passes,
      casesPath,
      outDir,
      pluginDir: pluginInstalled ? null : path.join(REPO, "plugin"),
    };
    if (args["dry-run"]) return { dryRun: true, ...plan, ids: cases.map((c) => c.id) };

    await fs.mkdir(cacheDir, { recursive: true });
    if (args.fresh) await fs.rm(cacheDir, { recursive: true, force: true }).then(() => fs.mkdir(cacheDir, { recursive: true }));
    const modelKey = (args.model ?? "default").replace(/[^a-z0-9.-]/gi, "_");
    const freshConditions = new Set<Condition>(args["fresh-conditions"] ?? []);
    const runner = new ClaudeHeadlessRunner({
      vaultId: cfg.id,
      model: args.model,
      judgeModel: args["judge-model"],
      pluginDir: plan.pluginDir,
    });

    const answers: AgentAnswer[] = [];
    const jobs = cases.flatMap((c) => conditions.map((cond) => ({ c, cond })));
    let done = 0;
    await pool(jobs, args.concurrency, async ({ c, cond }) => {
      const file = path.join(cacheDir, `${c.id}.${cond}.${modelKey}.json`);
      let a = freshConditions.has(cond) ? null : await readJson<AgentAnswer>(file);
      if (!a || a.error) {
        a = await runner.answer(c, cond);
        if (!a.error) await fs.writeFile(file, JSON.stringify(a, null, 2));
      }
      answers.push(a);
      done++;
      ctx.stderr(`[answers ${done}/${jobs.length}] ${c.id} ${cond}${a.error ? ` ERROR ${a.error.slice(0, 80)}` : ` ${(a.latencyMs ?? 0) / 1000 | 0}s`}`);
    });

    const judgments: Judgment[] = [];
    const judgeKey = (args["judge-model"] ?? "default").replace(/[^a-z0-9.-]/gi, "_");
    const judgeJobs = cases.flatMap((c) => Array.from({ length: args.passes }, (_, pass) => ({ c, pass })));
    done = 0;
    await pool(judgeJobs, args.concurrency, async ({ c, pass }) => {
      const caseAnswers = answers.filter((a) => a.caseId === c.id);
      // Keyed on the answer texts: refreshing one condition's answers invalidates its judgments.
      const file = path.join(cacheDir, `${c.id}.judge.${pass}.${modelKey}.${judgeKey}.${conditions.join("-")}.${answersHash(caseAnswers)}.json`);
      let j = args.rejudge ? null : await readJson<Judgment>(file);
      if (!j) {
        const order = shuffleWithSeed(conditions, args.seed * 7919 + pass * 104729 + hash(c.id));
        try {
          j = await runner.judge(c, caseAnswers, order, pass);
          await fs.writeFile(file, JSON.stringify(j, null, 2));
        } catch (e) {
          ctx.stderr(`[judge] ${c.id} pass ${pass} failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (j) judgments.push(j);
      done++;
      ctx.stderr(`[judge ${done}/${judgeJobs.length}] ${c.id} pass ${pass}`);
    });
    const fabrications: FabricationJudgment[] = [];
    if (args["fabrication-pass"]) {
      const fabJobs = answers.filter((a) => !a.error).map((a) => ({ a, c: cases.find((x) => x.id === a.caseId)! }));
      done = 0;
      await pool(fabJobs, args.concurrency, async ({ a, c }) => {
        const file = path.join(cacheDir, `${c.id}.fab${FABRICATION_RUBRIC_VERSION}.${a.condition}.${modelKey}.${judgeKey}.${answersHash([a])}.json`);
        let f = args.rejudge ? null : await readJson<FabricationJudgment>(file);
        if (!f) {
          try {
            f = await runner.judgeFabrication(c, a);
            await fs.writeFile(file, JSON.stringify(f, null, 2));
          } catch (e) {
            ctx.stderr(`[fabrication] ${c.id} ${a.condition} failed: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        if (f) fabrications.push(f);
        done++;
        ctx.stderr(`[fabrication ${done}/${fabJobs.length}] ${c.id} ${a.condition}`);
      });
    }
    await runner.cleanup();

    const report = aggregate(cases, answers, judgments, { baseline, conditions, seed: args.seed, fabrications });
    const stamp = new Date().toISOString();
    const date = stamp.slice(0, 10);
    const md = renderScorecard(report, {
      vault: cfg.id,
      date,
      model: args.model,
      judgeModel: args["judge-model"],
      casesPath,
      seed: args.seed,
      stamp,
    });
    await fs.mkdir(outDir, { recursive: true });
    const base = path.join(outDir, `${date}-task-${cfg.id}${args.label ? `-${args.label.replace(/[^a-z0-9._-]/gi, "_")}` : ""}`);
    await fs.writeFile(`${base}.md`, md);
    // Paths in the committed artifact are relative: the JSON is public for the demo vault.
    const rel = (p: string) => path.relative(REPO, p);
    await fs.writeFile(`${base}.json`, JSON.stringify({ stamp, vault: cfg.id, label: args.label ?? null, casesPath: rel(casesPath), conditions, baseline, passes: args.passes, seed: args.seed, report, answers, judgments, fabrications }, null, 2));
    ctx.stderr(`scorecard written to ${base}.md`);
    return { scorecard: `${base}.md`, json: `${base}.json`, conditions: report.conditions, cases: report.cases.length };
  },
  format(result) {
    const r = result as { dryRun?: boolean; scorecard?: string; conditions?: Array<{ condition: string; winRate: number; meanCorrectness: number; wins: number; ties: number; losses: number }>; cases?: number } & Record<string, unknown>;
    if (r.dryRun) return `Dry run: ${JSON.stringify(r, null, 2)}`;
    const lines = [`Scorecard: ${r.scorecard}`, ""];
    for (const c of r.conditions ?? []) {
      const u = (c as { unsupportedRate?: number | null }).unsupportedRate;
      lines.push(`${c.condition.padEnd(8)} correctness ${c.meanCorrectness.toFixed(2)}  unsupported ${u === null || u === undefined ? "—" : (u * 100).toFixed(1) + "%"}  win/tie/loss ${c.wins}/${c.ties}/${c.losses}  win rate ${(c.winRate * 100).toFixed(1)}%`);
    }
    return lines.join("\n");
  },
});

function answersHash(answers: AgentAnswer[]): string {
  const h = createHash("sha1");
  for (const a of [...answers].sort((x, y) => x.condition.localeCompare(y.condition))) h.update(`${a.condition}\u0000${a.text}\u0000`);
  return h.digest("hex").slice(0, 10);
}

function hash(s: string): number {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}
