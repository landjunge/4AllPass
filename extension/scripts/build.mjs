import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const staging = join(root, "dist", "_bundle");
rmSync(join(root, "dist"), { recursive: true, force: true });
mkdirSync(staging, { recursive: true });

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
  outdir: staging,
});

await esbuild.build({
  ...common,
  entryPoints: ["src/content.ts"],
  format: "iife",
  outfile: join(staging, "content.js"),
});

cpSync(join(root, "src/popup.html"), join(staging, "popup.html"));
cpSync(join(root, "src/popup.css"), join(staging, "popup.css"));
if (existsSync(join(root, "icons"))) {
  cpSync(join(root, "icons"), join(staging, "icons"), { recursive: true });
}

const base = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const hosts = new Set(base.host_permissions ?? []);
for (const extra of [
  "http://127.0.0.1:8788/*",
  "http://127.0.0.1:*/*",
  "http://localhost:8788/*",
]) {
  hosts.add(extra);
}
base.host_permissions = [...hosts];

const chromiumManifest = {
  ...base,
  name: "4AllPass",
  description:
    "Fill logins from your 4AllPass vault in Chrome, Brave, Edge, Arc, Vivaldi, Opera, Chromium. Decryption stays on this device.",
};

const firefoxManifest = {
  ...base,
  name: "4AllPass",
  description:
    "Fill logins from your 4AllPass vault in Firefox. Decryption stays on this device.",
  background: { scripts: ["background.js"] },
  browser_specific_settings: {
    gecko: {
      id: "addon@4allpass.local",
      strict_min_version: "128.0",
    },
  },
};

function writeFlavor(name, manifest) {
  const out = join(root, "dist", name);
  mkdirSync(out, { recursive: true });
  for (const file of readdirSync(staging)) {
    cpSync(join(staging, file), join(out, file), { recursive: true });
  }
  writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return out;
}

const chromiumOut = writeFlavor("chromium", chromiumManifest);
writeFlavor("firefox", firefoxManifest);

const safariRes = join(root, "safari/FourAllPass/FourAllPass Extension/Resources");
if (existsSync(dirname(safariRes))) {
  mkdirSync(safariRes, { recursive: true });
  for (const name of readdirSync(safariRes)) {
    rmSync(join(safariRes, name), { recursive: true, force: true });
  }
  for (const name of readdirSync(chromiumOut)) {
    cpSync(join(chromiumOut, name), join(safariRes, name), { recursive: true });
  }
}

rmSync(staging, { recursive: true, force: true });

const outdir = process.env.FOURALLPASS_OUTDIR;
if (outdir) {
  mkdirSync(outdir, { recursive: true });
  for (const name of readdirSync(chromiumOut)) {
    cpSync(join(chromiumOut, name), join(outdir, name), { recursive: true });
  }
  console.log(`extension → dist/chromium + dist/firefox + ${outdir}`);
} else {
  console.log("extension → dist/chromium + dist/firefox + safari Resources");
}
