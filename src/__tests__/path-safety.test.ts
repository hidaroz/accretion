import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { resolveSafePath, PathSafetyError } from "../utils/path-safety.js";

let tmpDir: string;
let realTmpDir: string;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vault-test-"));
  // Resolve symlinks (macOS /tmp -> /private/tmp)
  realTmpDir = await fs.realpath(tmpDir);
  // Create a test file
  await fs.writeFile(path.join(tmpDir, "note.md"), "test content");
  // Create a subdirectory with a file
  await fs.mkdir(path.join(tmpDir, "subdir"));
  await fs.writeFile(path.join(tmpDir, "subdir", "nested.md"), "nested");
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("resolveSafePath", () => {
  it("resolves a valid relative path", async () => {
    const result = await resolveSafePath(realTmpDir, "note.md");
    expect(result).toBe(path.join(realTmpDir, "note.md"));
  });

  it("resolves a nested relative path", async () => {
    const result = await resolveSafePath(realTmpDir, "subdir/nested.md");
    expect(result).toBe(path.join(realTmpDir, "subdir", "nested.md"));
  });

  it("allows paths to files that don't exist yet (for create)", async () => {
    const result = await resolveSafePath(realTmpDir, "new-file.md");
    expect(result).toBe(path.join(realTmpDir, "new-file.md"));
  });

  it("rejects absolute paths", async () => {
    await expect(
      resolveSafePath(realTmpDir, "/etc/passwd")
    ).rejects.toThrow(PathSafetyError);
  });

  it("rejects path traversal with ../", async () => {
    await expect(
      resolveSafePath(realTmpDir, "../escape.md")
    ).rejects.toThrow(PathSafetyError);
  });

  it("rejects path traversal in the middle of path", async () => {
    await expect(
      resolveSafePath(realTmpDir, "subdir/../../escape.md")
    ).rejects.toThrow(PathSafetyError);
  });

  it("rejects paths that resolve outside vault root", async () => {
    await expect(
      resolveSafePath(realTmpDir, "subdir/../../../etc/passwd")
    ).rejects.toThrow(PathSafetyError);
  });
});
