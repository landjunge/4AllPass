import { defineConfig, devices } from "@playwright/test";
import { isolatedWatchServer, visibleWatchUse } from "./e2e/watch/config.ts";

const port = process.env.E2E_DESKTOP_WATCH_PORT ?? "8796";

/**
 * Chromium desktop-logic path (Auth first) with stubbed Tauri APIs.
 * This is not an installed Tauri/WebView app test. The vault is isolated:
 * never ~/Library/Application Support/4AllPass and never port 8788.
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
    ...devices["Desktop Safari"],
    ...visibleWatchUse(port),
  },
  webServer: isolatedWatchServer({ port, dataPrefix: "4ap-desktop-watch-" }),
});
