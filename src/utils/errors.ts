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

/**
 * Shared error handler for MCP tool responses.
 * User errors (not found, already exists, path safety) return the message directly.
 * System errors are logged and return a generic message.
 */
export function handleToolError(err: unknown, action: string) {
  const isUserError =
    err instanceof NoteNotFoundError ||
    err instanceof NoteAlreadyExistsError ||
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
