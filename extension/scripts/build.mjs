import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
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
  format: "iife",
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
if (existsSync(join(root, "icons"))) {
  cpSync(join(root, "icons"), join(dist, "icons"), { recursive: true });
}

const safariRes = join(root, "safari/FourAllPass/FourAllPass Extension/Resources");
if (existsSync(dirname(safariRes))) {
  mkdirSync(safariRes, { recursive: true });
  for (const name of readdirSync(safariRes)) {
    rmSync(join(safariRes, name), { recursive: true, force: true });
  }
  for (const name of readdirSync(dist)) {
    cpSync(join(dist, name), join(safariRes, name), { recursive: true });
  }
  console.log("extension → dist/ + safari Resources");
} else {
  console.log("extension → dist/");
}
