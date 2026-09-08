// Runs task-eval conditions and the judge through `claude -p`, so the eval
// spends the user's Claude Code subscription and, for the plugin condition,
// exercises the real product surface (skill, hooks, CLI). `--bare` is not
// usable here (it skips credentials), so isolation comes from tool denial,
// an unmapped working directory, and ACCRETION_CAPTURE=off.

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  ANSWER_SYSTEM_PROMPT,
  JUDGE_SCHEMA,
  buildJudgePrompt,
  buildRecallPrompt,
  parseJudgeOutput,
  type AgentAnswer,
  type AgentRunner,
  type Condition,
  type Judge,
  type Judgment,
  type RawJudgeOutput,
  type TaskCase,
} from "../engine/eval/task-eval.js";
import { openVault, type VaultHandle } from "../engine/index.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const NO_TOOLS = "Bash,Read,Write,Edit,MultiEdit,NotebookEdit,Glob,Grep,LS,WebSearch,WebFetch,Agent,Task,TodoWrite,Skill";
const JUDGE_SYSTEM_PROMPT =
  "You are a careful, impartial grader. Follow the rubric exactly and return only the structured result.";

interface ClaudeResult {
  result: string;
  structured_output?: unknown;
  is_error?: boolean;
  num_turns?: number;
  duration_ms?: number;
  total_cost_usd?: number;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number };
  modelUsage?: Record<string, unknown>;
}

interface ClaudeCall {
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

/** Pure: the argv for one condition. Exported so tests can pin it without spawning. */
export function buildAnswerArgs(
  condition: Condition,
  prompt: string,
  opts: { model?: string; pluginDir?: string | null }
): string[] {
  const common = ["-p", prompt, "--output-format", "json", "--no-session-persistence"];
  if (opts.model) common.push("--model", opts.model);
  if (condition === "plugin") {
    return [
      ...common,
      "--append-system-prompt",
      ANSWER_SYSTEM_PROMPT + " The `accretion` CLI is on PATH; use it to consult the vault before answering.",
      "--permission-mode",
      "acceptEdits",
      "--permission-prompts",
      "none",
      "--allowedTools",
      "Bash(accretion *)",
      "Read",
      "--disallowedTools",
      "Write,Edit,MultiEdit,NotebookEdit,WebSearch,WebFetch,Agent,Task",
      ...(opts.pluginDir ? ["--plugin-dir", opts.pluginDir] : []),
    ];
  }
  return [
    ...common,
    "--system-prompt",
    ANSWER_SYSTEM_PROMPT,
    "--strict-mcp-config",
    "--mcp-config",
    '{"mcpServers":{}}',
    "--disallowedTools",
    `${NO_TOOLS},mcp__accretion`,
  ];
}

export function buildJudgeArgs(prompt: string, opts: { model?: string }): string[] {
  const args = [
    "-p",
    prompt,
    "--output-format",
    "json",
    "--no-session-persistence",
    "--json-schema",
    JSON.stringify(JUDGE_SCHEMA),
    "--system-prompt",
    JUDGE_SYSTEM_PROMPT,
    "--strict-mcp-config",
    "--mcp-config",
    '{"mcpServers":{}}',
    "--disallowedTools",
    `${NO_TOOLS},mcp__accretion`,
  ];
  if (opts.model) args.push("--model", opts.model);
  return args;
}

async function runClaude(call: ClaudeCall, timeoutMs = 240_000): Promise<ClaudeResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", call.args, { cwd: call.cwd, env: call.env, stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`claude timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    child.stdout.on("data", (d) => out.push(d));
    child.stderr.on("data", (d) => err.push(d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const text = Buffer.concat(out).toString("utf8").trim();
      try {
        const parsed = JSON.parse(text) as ClaudeResult;
        if (parsed.is_error) reject(new Error(`claude error: ${parsed.result}`));
        else resolve(parsed);
      } catch {
        reject(new Error(`claude exited ${code} with non-JSON output: ${(text || Buffer.concat(err).toString("utf8")).slice(0, 300)}`));
      }
    });
  });
}

function modelOf(r: ClaudeResult): string | undefined {
  const keys = Object.keys(r.modelUsage ?? {});
  return keys[0];
}

interface RunnerOptions {
  vaultId: string;
  model?: string;
  judgeModel?: string;
  /** Load the plugin from this directory for the plugin condition (null when installed persistently). */
  pluginDir?: string | null;
  timeoutMs?: number;
  /** Retries per call on transport errors. */
  retries?: number;
}

/**
 * One temp workspace per runner: an unmapped directory for bare/recall (hooks
 * stay silent), a mapped one for plugin (recall fires, capture is disabled by
 * env), and a project map that only knows the mapped slug.
 */
export class ClaudeHeadlessRunner implements AgentRunner, Judge {
  private root: string | null = null;
  private workspacePromise: Promise<{ bare: string; plugin: string; env: NodeJS.ProcessEnv }> | null = null;
  private handle: Promise<VaultHandle> | null = null;

  constructor(private opts: RunnerOptions) {}

  private workspace(): Promise<{ bare: string; plugin: string; env: NodeJS.ProcessEnv }> {
    // Memoised: concurrent answer() calls must share one workspace, not race to create it.
    if (!this.workspacePromise) this.workspacePromise = this.createWorkspace();
    return this.workspacePromise;
  }

  private async createWorkspace(): Promise<{ bare: string; plugin: string; env: NodeJS.ProcessEnv }> {
    if (!this.root) {
      this.root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "accretion-task-eval-")));
      await fs.mkdir(path.join(this.root, "unmapped"));
      await fs.mkdir(path.join(this.root, "accretion-eval-project"));
      await fs.writeFile(
        path.join(this.root, "map.json"),
        JSON.stringify({ "accretion-eval-project": this.opts.vaultId, _default: null })
      );
    }
    return {
      bare: path.join(this.root, "unmapped"),
      plugin: path.join(this.root, "accretion-eval-project"),
      env: {
        ...process.env,
        // Child sessions run in a temp cwd; a relative registry path must not move with them.
        ...(process.env.VAULTS_CONFIG ? { VAULTS_CONFIG: path.resolve(process.env.VAULTS_CONFIG) } : {}),
        PROJECT_VAULT_MAP: path.join(this.root, "map.json"),
        ACCRETION_CAPTURE: "off",
        LOG_LEVEL: "error",
        PATH: `${path.join(REPO, "plugin", "bin")}${path.delimiter}${process.env.PATH ?? ""}`,
      },
    };
  }

  async cleanup(): Promise<void> {
    if (this.root) await fs.rm(this.root, { recursive: true, force: true });
    this.root = null;
    this.workspacePromise = null;
  }

  private vault(): Promise<VaultHandle> {
    if (!this.handle) this.handle = openVault({ vaultId: this.opts.vaultId, semantic: false });
    return this.handle;
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    const retries = this.opts.retries ?? 1;
    let last: unknown;
    for (let i = 0; i <= retries; i++) {
      try {
        return await fn();
      } catch (e) {
        last = e;
      }
    }
    throw last;
  }

  async answer(c: TaskCase, condition: Condition): Promise<AgentAnswer> {
    const ws = await this.workspace();
    const t0 = Date.now();
    let prompt = c.question;
    let injected: string[] | undefined;
    if (condition === "recall") {
      const v = await this.vault();
      const r = await v.recall(c.question, v.config.recall);
      prompt = buildRecallPrompt(r.text, c.question);
      injected = r.injectedPaths;
    }
    const args = buildAnswerArgs(condition, prompt, { model: this.opts.model, pluginDir: this.opts.pluginDir ?? null });
    const cwd = condition === "plugin" ? ws.plugin : ws.bare;
    try {
      const r = await this.withRetry(() => runClaude({ args, cwd, env: ws.env }, this.opts.timeoutMs));
      return {
        caseId: c.id,
        condition,
        text: r.result ?? "",
        model: modelOf(r),
        latencyMs: Date.now() - t0,
        inputTokens: r.usage?.input_tokens,
        outputTokens: r.usage?.output_tokens,
        costUsd: r.total_cost_usd,
        turns: r.num_turns,
        injected,
      };
    } catch (e) {
      return { caseId: c.id, condition, text: "", latencyMs: Date.now() - t0, injected, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async judge(c: TaskCase, answers: AgentAnswer[], order: Condition[], pass: number): Promise<Judgment> {
    const ws = await this.workspace();
    const prompt = buildJudgePrompt(c, answers, order);
    const args = buildJudgeArgs(prompt, { model: this.opts.judgeModel });
    const r = await this.withRetry(() => runClaude({ args, cwd: ws.bare, env: ws.env }, this.opts.timeoutMs));
    let raw: RawJudgeOutput | null = null;
    if (r.structured_output && typeof r.structured_output === "object") raw = r.structured_output as RawJudgeOutput;
    else {
      try {
        raw = JSON.parse(r.result) as RawJudgeOutput;
      } catch {
        throw new Error(`judge returned no structured output: ${String(r.result).slice(0, 200)}`);
      }
    }
    return { caseId: c.id, pass, order, ...parseJudgeOutput(raw, order) };
  }
}
