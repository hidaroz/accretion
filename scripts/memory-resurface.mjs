#!/usr/bin/env node
// Deprecated shim: use `accretion resurface`. Kept for one release so an
// installed weekly loop keeps working while its command file is updated.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli", "main.js");
console.error("[accretion] scripts/memory-resurface.mjs is deprecated; use `accretion resurface`");
const child = spawn(process.execPath, [cli, "resurface", ...process.argv.slice(2)], { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
