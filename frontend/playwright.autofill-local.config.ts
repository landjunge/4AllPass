import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const uiDist = join(import.meta.dirname, "dist");
const python = join(import.meta.dirname, "../backend/.venv/bin/python");
const port = process.env.E2E_AUTOFILL_PORT ?? "8794";
const dataDir = process.env.FOURALLPASS_DATA_DIR
  ? `${process.env.FOURALLPASS_DATA_DIR}-autofill`
  : mkdtempSync(join(tmpdir(), "4ap-e2e-fill-"));

export default defineConfig({
  testDir: "./e2e/extension",
  testMatch: /autofill-local/,
  timeout: 180_000,
  expect: { timeout: 60_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    actionTimeout: 90_000,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `${python} -m app.local --port ${port} --data-dir "${dataDir}" --ui-dist "${uiDist}"`,
    cwd: join(import.meta.dirname, "../backend"),
    url: `http://127.0.0.1:${port}/health`,
    reuseExistingServer: false,
    timeout: 90_000,
    env: {
      FOURALLPASS_DATA_DIR: dataDir,
      FOURALLPASS_UI_DIST: uiDist,
    },
  },
});
