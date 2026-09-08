import type { CommandSpec } from "../spec.js";
import * as retrieval from "./retrieval.js";
import * as lifecycle from "./lifecycle.js";
import * as ops from "./ops.js";
import { taskEval } from "./task-eval.js";

export const commands: CommandSpec[] = [
  retrieval.search,
  retrieval.brief,
  retrieval.context,
  retrieval.recall,
  retrieval.read,
  retrieval.list,
  retrieval.tags,
  retrieval.listVaults,
  lifecycle.digestCandidates,
  lifecycle.staleBriefs,
  lifecycle.archive,
  lifecycle.applyProposals,
  lifecycle.resurface,
  lifecycle.garden,
  lifecycle.log,
  lifecycle.index,
  lifecycle.propose,
  taskEval,
  ops.commit,
  ops.evalCmd,
  ops.doctor,
  ops.setupVault,
  ops.bootstrap,
] as CommandSpec[];

export const mcpCommands = (): CommandSpec[] => commands.filter((c) => c.mcp);
