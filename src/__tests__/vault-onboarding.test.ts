import { describe, it, expect } from "vitest";
import {
  upsertVault,
  upsertProjectMap,
  SKELETON_DIRS,
  type VaultConfigEntry,
} from "../vault/vault-onboarding.js";

describe("upsertVault", () => {
  it("appends a new vault entry", () => {
    const out = upsertVault([], {
      id: "beta",
      path: "/abs/acme",
      displayName: "Acme",
    });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("beta");
  });

  it("replaces an existing entry by id (idempotent)", () => {
    const existing: VaultConfigEntry[] = [
      { id: "beta", path: "/old", displayName: "Old" },
    ];
    const out = upsertVault(existing, {
      id: "beta",
      path: "/new",
      displayName: "Acme",
    });
    expect(out).toHaveLength(1);
    expect(out[0].path).toBe("/new");
  });

  it("clears other defaults when the new entry is default", () => {
    const existing: VaultConfigEntry[] = [
      { id: "work", path: "/work", displayName: "Work", default: true },
    ];
    const out = upsertVault(existing, {
      id: "beta",
      path: "/acme",
      displayName: "Acme",
      default: true,
    });
    expect(out.find((v) => v.id === "work")!.default).toBeFalsy();
    expect(out.find((v) => v.id === "beta")!.default).toBe(true);
  });

  it("leaves other defaults untouched when the new entry is not default", () => {
    const existing: VaultConfigEntry[] = [
      { id: "work", path: "/work", displayName: "Work", default: true },
    ];
    const out = upsertVault(existing, {
      id: "beta",
      path: "/acme",
      displayName: "Acme",
    });
    expect(out.find((v) => v.id === "work")!.default).toBe(true);
  });
});

describe("upsertProjectMap", () => {
  it("maps each slug to the vault id without opting the user into catch-all capture", () => {
    const out = upsertProjectMap({}, ["acme-foo", "acme-bar"], "beta");
    expect(out["acme-foo"]).toBe("beta");
    expect(out["acme-bar"]).toBe("beta");
    // Onboarding one vault must not start recording every other project the
    // user opens. A null _default means the hook skips unmapped projects.
    expect(out._default).toBeNull();
  });

  it("preserves existing mappings and overrides only the given slugs", () => {
    const out = upsertProjectMap(
      { "atlas-web-app": "work", _default: "general" },
      ["acme-foo"],
      "beta"
    );
    expect(out["atlas-web-app"]).toBe("work");
    expect(out["acme-foo"]).toBe("beta");
    expect(out._default).toBe("general");
  });

  it("does not clobber an existing _default", () => {
    const out = upsertProjectMap({ _default: "work" }, ["x"], "beta");
    expect(out._default).toBe("work");
  });
});

describe("SKELETON_DIRS", () => {
  it("includes the lifecycle directories the server expects", () => {
    expect(SKELETON_DIRS).toContain("sessions/digests/_runs");
    expect(SKELETON_DIRS).toContain("proposals/brief-updates");
    expect(SKELETON_DIRS).toContain("MOCs");
    expect(SKELETON_DIRS).toContain(".mcp");
  });
});
