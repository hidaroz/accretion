import { describe, it, expect } from "vitest";
import path from "node:path";
import { resolveSemantic, selectVault, resolveVaultsConfigPath } from "../engine/config/vault-config.js";

describe("resolveSemantic", () => {
  it("auto turns on at the threshold, explicit values win, env disables", () => {
    expect(resolveSemantic({}, 10, false)).toBe(false);
    expect(resolveSemantic({}, 300, false)).toBe(true);
    expect(resolveSemantic({ semanticThreshold: 5 }, 5, false)).toBe(true);
    expect(resolveSemantic({ semantic: true }, 0, false)).toBe(true);
    expect(resolveSemantic({ semantic: false }, 10000, false)).toBe(false);
    expect(resolveSemantic({ semantic: true }, 10000, true)).toBe(false);
  });
});

describe("selectVault", () => {
  const vaults = [
    { id: "a", path: "/a", displayName: "A" },
    { id: "b", path: "/b", displayName: "B", default: true },
  ];
  it("picks by id, then default, then first", () => {
    expect(selectVault(vaults, "a").id).toBe("a");
    expect(selectVault(vaults).id).toBe("b");
    expect(selectVault([vaults[0]]).id).toBe("a");
    expect(() => selectVault(vaults, "zzz")).toThrow(/Unknown vault: "zzz"/);
  });
});

describe("resolveVaultsConfigPath", () => {
  it("honours VAULTS_CONFIG with ~ expansion", () => {
    const p = resolveVaultsConfigPath({ VAULTS_CONFIG: "~/x/vaults.json" });
    expect(p).not.toBeNull();
    expect(path.isAbsolute(p!)).toBe(true);
    expect(p!.endsWith(path.join("x", "vaults.json"))).toBe(true);
    expect(p!.includes("~")).toBe(false);
  });
});
