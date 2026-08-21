import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests run against the real backend, so PostgreSQL, Redis, and
 * `uvicorn app.main:app` have to be up. The WebAuthn ceremonies use Chrome's
 * virtual authenticator over CDP, which needs the installed Chrome channel.
 */
export default defineConfig({
  testDir: "./e2e",
  testIgnore: ["live/**", "extension/**", "local/**"],
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5173",
    channel: "chrome",
    // Argon2id in JavaScript is deliberately slow; give ceremonies room.
    actionTimeout: 60_000,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1",
    url: process.env.E2E_BASE_URL ?? "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 60_000,
    env: {
      API_ORIGIN: process.env.API_ORIGIN ?? "http://127.0.0.1:8010",
    },
  },
});
