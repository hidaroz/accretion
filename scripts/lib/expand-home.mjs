import path from "node:path";
import os from "node:os";

/**
 * Expand a leading `~` to the user's home directory.
 *
 * Shells expand `~` before a process sees it, so a path typed at a prompt
 * arrives already absolute — but one read from a config file or an env var
 * does not. `path.resolve("~/.config/x")` yields `<cwd>/~/.config/x`, which
 * fails with an ENOENT naming a directory the user never wrote.
 *
 * Only a leading `~/` (or a bare `~`) is expanded. `~user` syntax is not
 * supported: resolving it needs the password database, and treating it as the
 * current user's home would silently point somewhere wrong.
 *
 * Mirrors expandHome() in src/utils/path-safety.ts. The .mjs scripts cannot
 * import from the TypeScript build, which only exists after `npm run build`.
 */
export function expandHome(p) {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}
