import { defineConfig, devices } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const uiDist = join(import.meta.dirname, "dist");
const python = join(import.meta.dirname, "../backend/.venv/bin/python");
const port = process.env.E2E_DESKTOP_WATCH_PORT ?? "8796";
const dataDir = mkdtempSync(join(tmpdir(), "4ap-desktop-watch-"));

/**
 * Desktop-shell path (Auth first). Isolated tmp vault — never
 * ~/Library/Application Support/4AllPass and never port 8788.
 */
export default defineConfig({
  testDir: "./e2e/desktop",
  timeout: 480_000,
  expect: { timeout: 90_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    ...devices["Desktop Safari"],
    headless: true,
    actionTimeout: 90_000,
    video: "retain-on-failure",
    trace: "retain-on-failure",
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
