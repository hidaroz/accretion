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
