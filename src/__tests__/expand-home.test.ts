import { describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import { expandHome } from "../engine/utils/path-safety.js";
// @ts-expect-error — plain ESM helper, kept build-free for fresh-machine bootstrap.
import { expandHome as expandHomeMjs } from "../../scripts/lib/expand-home.mjs";
import { resolveVault } from "../hooks/session-journal.js";
import fs from "node:fs";

/**
 * .env.example ships `VAULTS_CONFIG=~/.config/accretion/vaults.json`, and the
 * README tells users to copy it verbatim. Without expansion, path.resolve()
 * turns that into `<cwd>/~/.config/...` and the server dies at startup on an
 * ENOENT naming a directory nobody wrote. Worth a test: the failure is total,
 * and it only reproduces on a machine that followed the documentation.
 */
describe("expandHome", () => {
  const home = os.homedir();

  it("expands a leading ~/", () => {
    expect(expandHome("~/.config/accretion/vaults.json")).toBe(
      path.join(home, ".config/accretion/vaults.json")
    );
  });

  it("expands a bare ~", () => {
    expect(expandHome("~")).toBe(home);
  });

  it("leaves absolute and relative paths alone", () => {
    expect(expandHome("/abs/path")).toBe("/abs/path");
    expect(expandHome("./rel")).toBe("./rel");
    expect(expandHome("vaults.json")).toBe("vaults.json");
  });

  it("does not touch ~user syntax, which it cannot resolve correctly", () => {
    // Expanding this to the *current* user's home would silently point at the
    // wrong account, which is worse than leaving it to fail loudly.
    expect(expandHome("~someone/notes")).toBe("~someone/notes");
    expect(expandHome("/tmp/~/x")).toBe("/tmp/~/x");
  });

  it("behaves identically in the .mjs copy", () => {
    // Two implementations exist because the scripts cannot import from dist/.
    // If they ever disagree, the server and its CLI tools resolve different
    // config files and the mismatch is near-impossible to diagnose.
    for (const p of ["~", "~/a/b", "/abs", "./rel", "~user/x"]) {
      expect(expandHomeMjs(p)).toBe(expandHome(p));
    }
  });
});

/**
 * The capture hook is installed globally and fires in every project. Routing is
 * therefore opt-in: an unmapped project with no `_default` must record nothing.
 * A regression here silently starts writing a user's prompts and shell commands
 * into a vault they never pointed at that directory.
 */
describe("capture routing is opt-in", () => {
  const writeMap = (obj: unknown) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "accretion-map-"));
    const p = path.join(dir, "project-vault-map.json");
    fs.writeFileSync(p, JSON.stringify(obj));
    return p;
  };

  it("routes a mapped project to its vault", () => {
    const map = writeMap({ "my-project": "work", _default: null });
    expect(resolveVault("my-project", map)).toBe("work");
  });

  it("returns null for an unmapped project when _default is null", () => {
    const map = writeMap({ "my-project": "work", _default: null });
    expect(resolveVault("something-else", map)).toBeNull();
  });

  it("honours an explicit _default when the user opts into catch-all capture", () => {
    const map = writeMap({ _default: "general" });
    expect(resolveVault("anything", map)).toBe("general");
  });

  it("returns null when the map is missing or unparseable", () => {
    // Failing closed matters more than failing open: the cost of not recording
    // a session is one lost note, the cost of recording the wrong one is a
    // user's shell history in a vault they never nominated.
    expect(resolveVault("x", "/nonexistent/project-vault-map.json")).toBeNull();
    const bad = writeMap("not json" as unknown);
    fs.writeFileSync(bad, "{ broken");
    expect(resolveVault("x", bad)).toBeNull();
  });
});
