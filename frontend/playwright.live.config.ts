import { defineConfig } from "@playwright/test";

/**
 * Headed live suite: real Chrome / Firefox / Brave / Opera / Edge / WebKit
 * windows on this Mac. Not run in CI. Existing Chrome CDP tests stay on
 * playwright.config.ts.
 */
export default defineConfig({
  testDir: "./e2e/live",
  timeout: 8 * 60_000,
  expect: { timeout: 45_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173",
    actionTimeout: 60_000,
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1",
    url: process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
