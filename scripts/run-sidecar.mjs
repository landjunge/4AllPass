#!/usr/bin/env node
/** Dispatch PyInstaller sidecar packager with the venv Python when present. */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = resolve(root, "scripts/package-sidecar.py");
const win = process.platform === "win32";
const venv = win
  ? resolve(root, "backend/.venv/Scripts/python.exe")
  : resolve(root, "backend/.venv/bin/python");

function has(cmd) {
  return spawnSync(cmd, ["--version"], { encoding: "utf8", stdio: "ignore" }).status === 0;
}

const python = existsSync(venv) ? venv : win ? (has("python") ? "python" : "py") : has("python3") ? "python3" : "python";
const result = spawnSync(python, [script, ...process.argv.slice(2)], {
  cwd: root,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
