import fs from "node:fs/promises";
import path from "node:path";

export interface SearchLogEntry {
  timestamp: string;
  tool: string;
  query: string;
  vault: string;
  resultCount: number;
  topPaths: string[];
  resolution?: string;

  // --- richer telemetry, currently emitted by hybrid_search (all optional so
  //     search_notes / get_brief entries stay backward-compatible) ---
  /** Requested result cap. */
  limit?: number;
  /** Whether the semantic index was available for this query. */
  semanticAvailable?: boolean;
  /** The brief routing decision used as the fusion pin source. */
  route?: {
    method: string;
    path: string | null;
    score?: number;
    marginRatio?: number;
  };
  /** True if the routed brief was retrieved (kw∪sem) and so actually pinned by RRF. */
  pinApplied?: boolean;
  /** Top keyword-only result paths (pre-fusion), for reconstructing the decision. */
  keywordTopPaths?: string[];
  /** Top semantic-only result paths (pre-fusion). */
  semanticTopPaths?: string[];
  /** Wall-clock latency of the retrieval, ms. */
  latencyMs?: number;
}

export class SearchAnalytics {
  private logPath: string;

  constructor(vaultRoot: string) {
    this.logPath = path.join(vaultRoot, ".mcp", "search-log.jsonl");
  }

  async log(entry: SearchLogEntry): Promise<void> {
    const line = JSON.stringify(entry) + "\n";
    await fs.appendFile(this.logPath, line, "utf-8").catch((err) => {
      // Log to stderr for debugging — should not happen in normal operation
      process.stderr.write(`SearchAnalytics write failed: ${err}\n`);
    });
  }
}
