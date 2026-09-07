// Command spec: one definition renders as a CLI subcommand and, when flagged,
// as an MCP tool. The zod schema is the single description of the inputs, so
// the flag parser never keeps its own list of value-taking options (the
// private vault-search CLI did, and every new flag silently corrupted the
// query string until that list was edited).

import { z } from "zod";

export interface RunContext {
  /** The caller asked for JSON. Data commands ignore this and always emit JSON. */
  json: boolean;
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdin: () => Promise<string>;
  stderr: (line: string) => void;
}

export interface Positional {
  /** Schema key the positional(s) map to. */
  key: string;
  label: string;
  /** Collect every remaining positional into this key (joined with spaces unless `list`). */
  rest?: boolean;
  /** With `rest`, keep an array instead of joining. */
  list?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyShape = z.ZodRawShape;

export interface CommandSpec<S extends AnyShape = AnyShape> {
  name: string;
  /** One line for `accretion --help`. */
  summary: string;
  /** Longer text for `accretion <cmd> --help` and the MCP tool description. */
  description?: string;
  group: "retrieval" | "lifecycle" | "ops";
  input: z.ZodObject<S>;
  positional?: Positional;
  /** Expose as an MCP tool. */
  mcp?: boolean;
  /** Always print JSON (machine-facing data commands). */
  jsonOnly?: boolean;
  /** JSON.stringify indent (the brief contract is a single line). */
  jsonIndent?: number;
  /** Hand the raw argv to the command untouched (wrappers around scripts). */
  passthrough?: boolean;
  run(args: z.infer<z.ZodObject<S>>, ctx: RunContext, rawArgv: string[]): Promise<unknown>;
  format?(result: unknown, args: z.infer<z.ZodObject<S>>): string;
}

export function defineCommand<S extends AnyShape>(spec: CommandSpec<S>): CommandSpec<S> {
  return spec;
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

function unwrap(t: z.ZodTypeAny): z.ZodTypeAny {
  let cur: z.ZodTypeAny = t;
  for (;;) {
    if (cur instanceof z.ZodOptional || cur instanceof z.ZodDefault || cur instanceof z.ZodNullable) {
      cur = (cur as z.ZodOptional<z.ZodTypeAny>)._def.innerType;
    } else if (cur instanceof z.ZodEffects) {
      cur = (cur as z.ZodEffects<z.ZodTypeAny>)._def.schema;
    } else {
      return cur;
    }
  }
}

export function isBooleanFlag(t: z.ZodTypeAny): boolean {
  return unwrap(t) instanceof z.ZodBoolean;
}

export function isArrayFlag(t: z.ZodTypeAny): boolean {
  return unwrap(t) instanceof z.ZodArray;
}

/**
 * Parse `--flag value`, `--flag=value`, `--bool`, `--no-bool`, repeated array
 * flags, and positionals, driven entirely by the schema.
 */
export function parseArgv<S extends AnyShape>(
  spec: CommandSpec<S>,
  argv: string[]
): z.infer<z.ZodObject<S>> {
  const shape = spec.input.shape;
  const raw: Record<string, unknown> = {};
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (!a.startsWith("--")) {
      positionals.push(a);
      continue;
    }
    let key = a.slice(2);
    let inlineValue: string | undefined;
    const eq = key.indexOf("=");
    if (eq >= 0) {
      inlineValue = key.slice(eq + 1);
      key = key.slice(0, eq);
    }
    let negated = false;
    if (!(key in shape) && key.startsWith("no-") && key.slice(3) in shape) {
      negated = true;
      key = key.slice(3);
    }
    const field = shape[key];
    if (!field) throw new UsageError(`unknown flag --${key}`);

    if (isBooleanFlag(field)) {
      raw[key] = !negated;
      continue;
    }
    let value = inlineValue;
    if (value === undefined) {
      const next = argv[i + 1];
      if (next === undefined || (next.startsWith("--") && next !== "--")) {
        throw new UsageError(`--${key} needs a value`);
      }
      value = next;
      i++;
    }
    if (isArrayFlag(field)) {
      const arr = (raw[key] as string[] | undefined) ?? [];
      arr.push(...value.split(",").map((s) => s.trim()).filter(Boolean));
      raw[key] = arr;
    } else {
      raw[key] = value;
    }
  }

  if (spec.positional) {
    const p = spec.positional;
    if (p.rest) {
      if (positionals.length > 0) raw[p.key] = p.list ? positionals : positionals.join(" ");
    } else if (positionals.length > 1) {
      throw new UsageError(`expected one ${p.label}, got ${positionals.length}`);
    } else if (positionals.length === 1) {
      raw[p.key] = positionals[0];
    }
  } else if (positionals.length > 0) {
    throw new UsageError(`unexpected argument: ${positionals[0]}`);
  }

  const parsed = spec.input.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || spec.positional?.label || "input"}: ${i.message}`)
      .join("; ");
    throw new UsageError(issues);
  }
  return parsed.data;
}

/** `--help` text for one command, derived from the schema. */
export function helpFor(spec: CommandSpec): string {
  const lines: string[] = [];
  const pos = spec.positional ? ` <${spec.positional.label}${spec.positional.rest ? "..." : ""}>` : "";
  lines.push(`accretion ${spec.name}${pos} [flags]`);
  lines.push("");
  lines.push(spec.description ?? spec.summary);
  lines.push("");
  lines.push("Flags:");
  for (const [key, field] of Object.entries(spec.input.shape)) {
    if (spec.positional && key === spec.positional.key) continue;
    const f = field as z.ZodTypeAny;
    const desc = f.description ?? "";
    const kind = isBooleanFlag(f) ? "" : isArrayFlag(f) ? " <a,b,...>" : " <value>";
    let def = "";
    if (f instanceof z.ZodDefault) {
      const d = (f as z.ZodDefault<z.ZodTypeAny>)._def.defaultValue();
      if (d !== undefined && d !== false) def = ` (default ${JSON.stringify(d)})`;
    }
    lines.push(`  --${key}${kind}`.padEnd(28) + `${desc}${def}`);
  }
  if (!spec.jsonOnly) lines.push(`  --json`.padEnd(28) + "print JSON instead of text");
  return lines.join("\n");
}

export const vaultFlag = z.string().optional().describe("Vault id. Omit for the default vault.");
export const semanticFlags = {
  "keyword-only": z.boolean().optional().describe("Skip embeddings for this call (fast path)."),
  semantic: z.boolean().optional().describe("Force embeddings on for this call."),
};
export function semanticFrom(args: { "keyword-only"?: boolean; semantic?: boolean }): "auto" | boolean | undefined {
  if (args["keyword-only"]) return false;
  if (args.semantic) return true;
  return undefined;
}
