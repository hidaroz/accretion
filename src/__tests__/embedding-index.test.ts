import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  chunkNote,
  cosine,
  EmbeddingIndex,
  type Embedder,
} from "../vault/embedding-index.js";

// --- Deterministic fake embedder: bag-of-words over a fixed vocab. ---
const VOCAB = ["auth", "login", "token", "grind", "roasting", "schedule"];
function makeEmbedder(): Embedder & { calls: number } {
  const fn = (async (texts: string[]) => {
    fn.calls += texts.length;
    return texts.map((t) => {
      const lower = t.toLowerCase();
      return VOCAB.map((w) => (lower.match(new RegExp(w, "g")) || []).length);
    });
  }) as Embedder & { calls: number };
  fn.calls = 0;
  return fn;
}

describe("chunkNote", () => {
  it("splits by H2, prepends the title, and captures the preamble", () => {
    const chunks = chunkNote(
      "a/note.md",
      "Auth Brief",
      "# Auth Brief\n\nIntro line.\n\n## Login Flow\nUser logs in.\n\n## Tokens\nJWT tokens.\n"
    );
    const headings = chunks.map((c) => c.heading);
    expect(headings).toContain("Login Flow");
    expect(headings).toContain("Tokens");
    // every chunk carries the title for context
    expect(chunks.every((c) => c.text.includes("Auth Brief"))).toBe(true);
    const login = chunks.find((c) => c.heading === "Login Flow")!;
    expect(login.text).toContain("User logs in.");
    expect(login.path).toBe("a/note.md");
  });

  it("produces a single chunk for a note with no H2 headings", () => {
    const chunks = chunkNote("a/x.md", "X", "# X\n\nJust body text.\n");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toContain("Just body text.");
  });
});

describe("cosine", () => {
  it("is 1 for identical, 0 for orthogonal", () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
  });
});

let cacheDir: string;
const NOTES = [
  {
    path: "03/auth.md",
    title: "Auth Brief",
    content:
      "# Auth Brief\n\n## Login Flow\nUser login with auth token and password.\n\n## Misc\nUnrelated.\n",
  },
  {
    path: "05/roasting.md",
    title: "Roasting Brief",
    content: "# Roasting Brief\n\n## Beans\nPayment and roasting beans.\n",
  },
];

beforeEach(async () => {
  cacheDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "emb-test-")));
});
afterEach(async () => {
  await fs.rm(cacheDir, { recursive: true, force: true });
});

describe("EmbeddingIndex", () => {
  it("ranks the most relevant chunk first", async () => {
    const embed = makeEmbedder();
    const idx = new EmbeddingIndex(embed);
    await idx.buildFromVault(NOTES);

    const results = await idx.search("login authentication token", 3);
    expect(results[0].path).toBe("03/auth.md");
    expect(results[0].heading).toBe("Login Flow");
    expect(results[0].score).toBeGreaterThan(0);
  });

  it("reuses cached vectors by content hash (no re-embed on rebuild)", async () => {
    const cachePath = path.join(cacheDir, "embeddings.json");
    const embed1 = makeEmbedder();
    const idx1 = new EmbeddingIndex(embed1, { cachePath });
    await idx1.buildFromVault(NOTES);
    await idx1.saveCache();
    expect(embed1.calls).toBeGreaterThan(0);

    const embed2 = makeEmbedder();
    const idx2 = new EmbeddingIndex(embed2, { cachePath });
    await idx2.loadCache();
    await idx2.buildFromVault(NOTES);
    expect(embed2.calls).toBe(0); // all chunks served from cache
  });

  it("re-embeds only changed chunks on addOrUpdate", async () => {
    const embed = makeEmbedder();
    const idx = new EmbeddingIndex(embed);
    await idx.buildFromVault(NOTES);
    const baseline = embed.calls;

    // change one section of auth.md; the other chunk is unchanged
    await idx.addOrUpdate({
      path: "03/auth.md",
      title: "Auth Brief",
      content:
        "# Auth Brief\n\n## Login Flow\nNow with biometric login and auth token.\n\n## Misc\nUnrelated.\n",
    });
    expect(embed.calls - baseline).toBe(1); // only the changed chunk re-embedded
  });

  it("drops a note's chunks on remove", async () => {
    const embed = makeEmbedder();
    const idx = new EmbeddingIndex(embed);
    await idx.buildFromVault(NOTES);
    idx.remove("05/roasting.md");
    const results = await idx.search("grind roasting beans", 5);
    expect(results.every((r) => r.path !== "05/roasting.md")).toBe(true);
  });
});
