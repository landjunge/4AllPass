import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const uiDist = join(import.meta.dirname, "dist");
const python = join(import.meta.dirname, "../backend/.venv/bin/python");
const port = process.env.E2E_USER_WATCH_PORT ?? "8794";
const dataDir = mkdtempSync(join(tmpdir(), "4ap-user-watch-"));

/**
 * Headed, slow, mouse+keyboard. Isolated tmp vault — never Daniel's Desk data.
 * Watch the Chromium window; do not use :8788 or the real 400-entry vault.
 */
export default defineConfig({
  testDir: "./e2e/user-watch",
  timeout: 480_000,
  expect: { timeout: 90_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    headless: false,
    launchOptions: { slowMo: 500 },
    actionTimeout: 90_000,
    video: "on",
    trace: "on",
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: `${python} -m app.local --port ${port} --data-dir "${dataDir}" --ui-dist "${uiDist}"`,
    cwd: join(import.meta.dirname, "../backend"),
    url: `http://127.0.0.1:${port}/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      FOURALLPASS_DATA_DIR: dataDir,
      FOURALLPASS_UI_DIST: uiDist,
    },
  },
});
