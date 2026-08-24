import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const uiDist = join(import.meta.dirname, "dist");
const python = join(import.meta.dirname, "../backend/.venv/bin/python");

function localServer(port: string, dataPrefix: string) {
  const dataDir = process.env.FOURALLPASS_DATA_DIR
    ? `${process.env.FOURALLPASS_DATA_DIR}-${port}`
    : mkdtempSync(join(tmpdir(), dataPrefix));
  return {
    command: `${python} -m app.local --port ${port} --data-dir "${dataDir}" --ui-dist "${uiDist}"`,
    cwd: join(import.meta.dirname, "../backend"),
    url: `http://127.0.0.1:${port}/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      FOURALLPASS_DATA_DIR: dataDir,
      FOURALLPASS_UI_DIST: uiDist,
    },
  };
}

const firstPort = process.env.E2E_LOCAL_PORT ?? "8790";
const restorePort = process.env.E2E_RESTORE_PORT ?? "8792";

/**
 * First-run against the local one-process app (SQLite, no Vite, no Postgres).
 * Argon2id is slow on purpose. Restore needs its own empty data dir.
 */
export default defineConfig({
  testDir: "./e2e/local",
  timeout: 180_000,
  expect: { timeout: 60_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    actionTimeout: 90_000,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "first-run",
      testMatch: /first-run-access|import-review|browser-cards-import/,
      use: { baseURL: `http://127.0.0.1:${firstPort}` },
    },
    {
      name: "restore",
      testMatch: /restore-share/,
      use: { baseURL: `http://127.0.0.1:${restorePort}` },
    },
  ],
  webServer: [
    localServer(firstPort, "4ap-e2e-"),
    localServer(restorePort, "4ap-e2e-restore-"),
  ],
});
