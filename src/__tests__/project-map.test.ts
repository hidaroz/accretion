import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  loadProjectMap,
  resolveVaultForSlug,
  resolveProjectMapPath,
  slugForCwd,
} from "../engine/config/project-map.js";

describe("project map", () => {
  it("resolves mapped slugs, honours _default, fails closed", () => {
    expect(resolveVaultForSlug("atlas-web-app", { "atlas-web-app": "work", _default: null })).toBe("work");
    expect(resolveVaultForSlug("other", { "atlas-web-app": "work", _default: null })).toBeNull();
    expect(resolveVaultForSlug("other", { _default: "general" })).toBe("general");
    expect(resolveVaultForSlug("x", null)).toBeNull();
  });

  it("loads a map file and returns null for garbage", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "accretion-pm-"));
    const good = path.join(dir, "map.json");
    fs.writeFileSync(good, JSON.stringify({ a: "v", _default: null }));
    expect(loadProjectMap(good)).toEqual({ a: "v", _default: null });
    const bad = path.join(dir, "bad.json");
    fs.writeFileSync(bad, "{ nope");
    expect(loadProjectMap(bad)).toBeNull();
    expect(loadProjectMap(path.join(dir, "missing.json"))).toBeNull();
  });

  it("PROJECT_VAULT_MAP overrides discovery and expands ~", () => {
    const p = resolveProjectMapPath({ PROJECT_VAULT_MAP: "~/maps/x.json" });
    expect(p).toBe(path.join(os.homedir(), "maps", "x.json"));
  });

  it("slug is the directory basename", () => {
    expect(slugForCwd("/Users/x/devprojects/atlas-web-app")).toBe("atlas-web-app");
    expect(slugForCwd(undefined)).toBe("unknown");
  });
});
