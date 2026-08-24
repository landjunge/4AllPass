/**
 * One-command local app: one Python process on :8788 (UI + API + access relay).
 * Not FastAPI token minting. Sidecar for Tauri uses the same entry without --open.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distIndex = resolve(root, "frontend/dist/index.html");
const extManifest = resolve(root, "extension/dist/chromium/manifest.json");
const venvPython = resolve(root, "backend/.venv/bin/python");
const openWindow = process.argv.includes("--open");

function run(command, args, opts = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: "inherit", cwd: root, ...opts });
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} ${args.join(" ")} exited ${code}`));
    });
    child.on("error", reject);
  });
}

function pythonBin() {
  if (existsSync(venvPython)) return venvPython;
  return process.platform === "win32" ? "python" : "python3";
}

async function main() {
  if (!existsSync(distIndex)) {
    console.log("Building frontend (frontend/dist missing)…");
    await run("npm", ["run", "build"]);
  }
  if (!existsSync(extManifest)) {
    console.log("Building extension (extension/dist/chromium missing)…");
    await run("npm", ["run", "build:extension"]);
  }
  const args = ["-m", "app.local"];
  if (openWindow) args.push("--open");
  const child = spawn(pythonBin(), args, {
    stdio: "inherit",
    cwd: resolve(root, "backend"),
  });
  const stop = () => {
    if (child.pid) child.kill("SIGTERM");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  child.on("exit", (code) => process.exit(code ?? 1));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
