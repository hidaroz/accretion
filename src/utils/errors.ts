import { logger } from "./logger.js";

export class NoteNotFoundError extends Error {
  constructor(path: string) {
    super(`Note not found: ${path}`);
    this.name = "NoteNotFoundError";
  }
}

export class NoteAlreadyExistsError extends Error {
  constructor(path: string) {
    super(`Note already exists: ${path}`);
    this.name = "NoteAlreadyExistsError";
  }
}

export class VaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultError";
  }
}

export class PatchStringNotFoundError extends Error {
  constructor(path: string, editIndex: number, oldString: string) {
    const preview =
      oldString.length > 60 ? oldString.slice(0, 60) + "…" : oldString;
    super(
      `Patch edit #${editIndex} in ${path}: old_string not found: "${preview}"`
    );
    this.name = "PatchStringNotFoundError";
  }
}

export class PatchStringAmbiguousError extends Error {
  constructor(path: string, editIndex: number, count: number) {
    super(
      `Patch edit #${editIndex} in ${path}: old_string matches ${count} locations. ` +
        `Provide more surrounding context to make it unique, or set replace_all: true.`
    );
    this.name = "PatchStringAmbiguousError";
  }
}

/**
 * Shared error handler for MCP tool responses.
 * User errors (not found, already exists, path safety) return the message directly.
 * System errors are logged and return a generic message.
 */
export function handleToolError(err: unknown, action: string) {
  const isUserError =
    err instanceof NoteNotFoundError ||
    err instanceof NoteAlreadyExistsError ||
    err instanceof PatchStringNotFoundError ||
    err instanceof PatchStringAmbiguousError ||
    (err instanceof Error && err.name === "PathSafetyError");

  const message = err instanceof Error ? err.message : String(err);

  if (!isUserError) {
    logger.error(`Tool error during ${action}`, { error: message });
  }

  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true,
  };
}
