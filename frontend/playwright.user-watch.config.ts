import { defineConfig } from "@playwright/test";
import { isolatedWatchServer, visibleWatchUse } from "./e2e/watch/config.ts";

const port = process.env.E2E_USER_WATCH_PORT ?? "8794";

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
  use: visibleWatchUse(port),
  webServer: isolatedWatchServer({ port, dataPrefix: "4ap-user-watch-" }),
});
