import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { VaultManager, isWritable } from "../engine/vault/vault-manager.js";
import { WriteNotAllowedError } from "../engine/utils/errors.js";
import { DEFAULT_WRITABLE_PATHS } from "../engine/config/vault-config.js";

describe("isWritable", () => {
  it("treats undefined as unrestricted", () => {
    expect(isWritable("01-Architecture/brief-x.md", undefined)).toBe(true);
  });

  it("matches directory prefixes and exact files", () => {
    const allow = ["sessions/", "proposals", "00-Index/log.md"];
    expect(isWritable("sessions/2026/09-07/a.md", allow)).toBe(true);
    expect(isWritable("proposals/brief-updates/x.md", allow)).toBe(true);
    expect(isWritable("00-Index/log.md", allow)).toBe(true);
    expect(isWritable("00-Index/index.md", allow)).toBe(false);
    expect(isWritable("proposals-old/x.md", allow)).toBe(false);
    expect(isWritable("01-Architecture/brief-x.md", allow)).toBe(false);
    expect(isWritable("./sessions/a.md", allow)).toBe(true);
  });

  it("default allowlist covers the engine's own outputs and nothing curated", () => {
    expect(isWritable("sessions/digests/2026-W36-x.md", DEFAULT_WRITABLE_PATHS)).toBe(true);
    expect(isWritable("00-Index/log.md", DEFAULT_WRITABLE_PATHS)).toBe(true);
    expect(isWritable("Knowledge/foo.md", DEFAULT_WRITABLE_PATHS)).toBe(false);
  });
});

describe("VaultManager allowlist", () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "accretion-allow-")));
    await fs.mkdir(path.join(root, "01-Architecture"), { recursive: true });
    await fs.writeFile(path.join(root, "01-Architecture/brief-x.md"), "# X\n\n## A\n\nbody\n");
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("rejects writes outside the allowlist with a named error", async () => {
    const vault = new VaultManager(root, { writablePaths: DEFAULT_WRITABLE_PATHS });
    await expect(vault.create("Knowledge/new.md", "hi")).rejects.toBeInstanceOf(WriteNotAllowedError);
    await expect(
      vault.update("01-Architecture/brief-x.md", { content: "changed" })
    ).rejects.toBeInstanceOf(WriteNotAllowedError);
    // untouched
    expect(await fs.readFile(path.join(root, "01-Architecture/brief-x.md"), "utf-8")).toContain("body");
  });

  it("allows writes inside the allowlist and explicit unrestricted writes", async () => {
    const vault = new VaultManager(root, { writablePaths: DEFAULT_WRITABLE_PATHS });
    const info = await vault.create("proposals/brief-updates/p.md", "proposal", { status: "proposed" });
    expect(info.path).toBe("proposals/brief-updates/p.md");
    const updated = await vault.update("01-Architecture/brief-x.md", {
      content: "changed",
      unrestricted: true,
    });
    expect(updated.content).toBe("changed");
  });
});
