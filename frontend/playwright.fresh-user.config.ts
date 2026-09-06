import { defineConfig, devices } from "@playwright/test";
import { isolatedWatchServer, visibleWatchUse } from "./e2e/watch/config.ts";

const port = process.env.E2E_DESKTOP_WATCH_PORT ?? "8796";
const watch = visibleWatchUse(port);

export default defineConfig({
  testDir: "./e2e/desktop",
  testMatch: "fresh-user-journey.spec.ts",
  timeout: 480_000,
  expect: { timeout: 90_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Safari"],
    ...watch,
    headless: process.env.E2E_HEADLESS === "1" ? true : watch.headless,
    launchOptions: process.env.E2E_HEADLESS === "1" ? {} : watch.launchOptions,
  },
  webServer: isolatedWatchServer({ port, dataPrefix: "4ap-fresh-user-" }),
});
