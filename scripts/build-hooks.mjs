// Bundle the hooks into single files under dist/hooks/*.mjs so they run from a
// plugin directory or a copied location without a module graph next to them.
// The embedding library stays external and is imported lazily by the engine,
// so keyword-only hooks never load it.
import { build } from "esbuild";
import { chmodSync } from "node:fs";

const entries = ["src/hooks/session-journal.ts", "src/hooks/prompt-recall.ts"];
await build({
  entryPoints: entries,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outdir: "dist/hooks",
  outExtension: { ".js": ".mjs" },
  external: ["@xenova/transformers", "@huggingface/transformers"],
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  logLevel: "warning",
});
for (const e of entries) {
  chmodSync(`dist/hooks/${e.split("/").pop().replace(/\.ts$/, ".mjs")}`, 0o755);
}
console.log(`bundled ${entries.length} hook(s) → dist/hooks/`);
