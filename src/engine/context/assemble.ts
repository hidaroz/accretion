// Multi-brief context assembly: route each topic to a brief, then fair-share a
// character budget across the briefs that resolved. Lifted out of the MCP tool
// so the CLI, the MCP adapter and the recall hook assemble context identically.

import { routeBrief, type BriefSearcher } from "../retrieval/brief-routing.js";
import type { VaultManager } from "../vault/vault-manager.js";
import { validityLine } from "./validity.js";

/**
 * Cut `text` to at most `limit` characters, preferring a markdown section
 * boundary so a brief ends on a whole idea rather than mid-sentence.
 *
 * Falls back to a paragraph break, then to a hard cut. A brief with no headings
 * at all should still be trimmed rather than blowing the budget.
 */
export function truncateAtSection(text: string, limit: number): string {
  if (limit <= 0) return "";
  if (text.length <= limit) return text;

  const window = text.slice(0, limit);
  // Only accept a boundary in the back half, or a brief whose first heading is
  // late would collapse to almost nothing.
  const floor = Math.floor(limit / 2);

  const heading = window.lastIndexOf("\n## ");
  if (heading > floor) return text.slice(0, heading).trimEnd();

  const para = window.lastIndexOf("\n\n");
  if (para > floor) return text.slice(0, para).trimEnd();

  return window.trimEnd();
}

export interface AssembleOptions {
  /** Approximate output ceiling in tokens (default 8000). One token ≈ 4 chars. */
  maxTokens?: number;
}

export interface AssembledContext {
  /** Concatenated briefs plus a footer naming topics that did not resolve. Empty if nothing resolved. */
  text: string;
  resolved: Array<{ topic: string; path: string }>;
  notFound: string[];
  totalChars: number;
}

export const DEFAULT_CONTEXT_TOKENS = 8000;
export const MAX_CONTEXT_TOKENS = 20000;

/**
 * Resolve every topic before reading anything: the budget is divided across the
 * briefs that actually resolved, and that count is unknown until routing has run
 * for all of them. Each brief then gets an equal share of what is left, and
 * whatever it does not use rolls forward, so small briefs subsidise large ones
 * rather than argument order deciding who gets nothing.
 */
export async function assembleContext(
  vault: VaultManager,
  briefMap: Record<string, string>,
  searchIndex: BriefSearcher,
  topics: string[],
  options: AssembleOptions = {}
): Promise<AssembledContext> {
  const maxTokens = Math.min(
    MAX_CONTEXT_TOKENS,
    Math.max(1, options.maxTokens ?? DEFAULT_CONTEXT_TOKENS)
  );
  const maxChars = maxTokens * 4;
  const sections: string[] = [];
  const resolved: Array<{ topic: string; path: string }> = [];
  const notFound: string[] = [];
  const seenPaths = new Set<string>();
  let totalChars = 0;

  const routed: Array<{ topic: string; briefPath: string }> = [];
  for (const topic of topics) {
    const normalized = topic.toLowerCase().trim();
    const briefPath = routeBrief(briefMap, searchIndex, normalized).path;
    if (!briefPath) {
      notFound.push(topic);
      continue;
    }
    if (seenPaths.has(briefPath)) continue;
    seenPaths.add(briefPath);
    routed.push({ topic, briefPath });
  }

  for (let i = 0; i < routed.length; i++) {
    const { topic, briefPath } = routed[i];
    const allowance = Math.floor((maxChars - totalChars) / (routed.length - i));
    try {
      const note = await vault.read(briefPath);
      const validity = validityLine(note.frontmatter);
      const header = `---\n# ${note.title}\n\n${validity ? `_${validity}_\n\n` : ""}`;
      let body = note.content;
      if (header.length + body.length + 1 > allowance) {
        const notice = `\n\n*[Truncated to fit the context budget. Read \`${briefPath}\` for the rest.]*`;
        body =
          truncateAtSection(
            body,
            Math.max(0, allowance - header.length - notice.length - 1)
          ) + notice;
      }
      sections.push(`${header}${body}\n`);
      resolved.push({ topic, path: briefPath });
      totalChars += header.length + body.length + 1;
    } catch {
      notFound.push(topic);
    }
  }

  let text = sections.join("\n");
  if (text.length > 0 && notFound.length > 0) {
    text += `\n\n---\n*No briefs found for: ${notFound.join(", ")}. Try a search for these topics.*`;
  }

  return { text, resolved, notFound, totalChars };
}
