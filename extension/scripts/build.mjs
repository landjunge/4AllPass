import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
mkdirSync(dist, { recursive: true });

await esbuild.build({
  absWorkingDir: root,
  entryPoints: {
    background: "src/background.ts",
    popup: "src/popup.ts",
  },
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "chrome120",
  outdir: dist,
  sourcemap: false,
});

await esbuild.build({
  absWorkingDir: root,
  entryPoints: ["src/content.ts"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome120",
  outfile: join(dist, "content.js"),
  sourcemap: false,
});

cpSync(join(root, "manifest.json"), join(dist, "manifest.json"));
cpSync(join(root, "src/popup.html"), join(dist, "popup.html"));
cpSync(join(root, "src/popup.css"), join(dist, "popup.css"));

console.log("extension → dist/");
