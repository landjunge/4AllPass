import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = process.env.FOURALLPASS_OUTDIR || join(root, "dist");
mkdirSync(dist, { recursive: true });

const common = {
  absWorkingDir: root,
  bundle: true,
  platform: "browser",
  target: "chrome120",
  sourcemap: false,
  legalComments: "none",
  charset: "utf8",
};

await esbuild.build({
  ...common,
  entryPoints: {
    background: "src/background.ts",
    popup: "src/popup.ts",
  },
  format: "esm",
  outdir: dist,
});

await esbuild.build({
  ...common,
  entryPoints: ["src/content.ts"],
  format: "iife",
  outfile: join(dist, "content.js"),
});

cpSync(join(root, "manifest.json"), join(dist, "manifest.json"));
cpSync(join(root, "src/popup.html"), join(dist, "popup.html"));
cpSync(join(root, "src/popup.css"), join(dist, "popup.css"));

console.log("extension → dist/");
