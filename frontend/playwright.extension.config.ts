import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/extension",
  timeout: 180_000,
  expect: { timeout: 60_000 },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173",
    actionTimeout: 60_000,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1",
    url: process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173",
    reuseExistingServer: true,
    timeout: 60_000,
    env: {
      API_ORIGIN: process.env.API_ORIGIN ?? "http://127.0.0.1:8010",
    },
  },
});
