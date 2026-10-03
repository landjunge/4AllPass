import { defineConfig } from "@playwright/test";
import local from "./playwright.local.config.ts";

// Uses disposable SQLite vaults and the production browser build.
export default defineConfig({
  ...local,
  use: {
    ...local.use,
    viewport: { width: 1440, height: 900 },
    launchOptions: { executablePath: process.env.FOURALLPASS_CHROMIUM },
  },
  projects: [{
    name: "desktop-design",
    testMatch: /import-review|vault-desk|shared-desktop/,
    use: { baseURL: `http://127.0.0.1:${process.env.E2E_LOCAL_PORT ?? "8790"}` },
  }],
});
