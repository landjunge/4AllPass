import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, chromium } from "@playwright/test";
import {
  ACCOUNT_PASSWORD,
  VAULT_PASSWORD,
  addEntryWithMouse,
  createVaultWithMouse,
  signUpWithMouse,
} from "../live/actions.ts";

const DIST = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../extension/dist/chromium",
);
const API = process.env.API_ORIGIN ?? "http://127.0.0.1:8010";

test("fills the demo login in two clicks after unlock", async () => {
  const context = await chromium.launchPersistentContext("", {
    headless: false,
    args: [
      `--disable-extensions-except=${DIST}`,
      `--load-extension=${DIST}`,
      "--enable-unsafe-extension-debugging",
    ],
  });
  try {
    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent("serviceworker");
    const extensionId = new URL(worker.url()).host;

    const page = await context.newPage();
    await page.goto("/");
    await signUpWithMouse(page);
    await createVaultWithMouse(page);
    await addEntryWithMouse(page, {
      title: "Demo login",
      username: "ada@example.com",
      password: "s3cret-autofill",
      url: "http://127.0.0.1:5173/test-login.html",
    });

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.locator("#api").fill(API);
    await popup.locator("#email").fill((await page.getByTestId("account-email").textContent()) ?? "");
    await popup.locator("#account").fill(ACCOUNT_PASSWORD);
    await popup.locator("#vault").fill(VAULT_PASSWORD);
    await popup.locator("#unlock-btn").click();
    await expect(popup.locator("#status")).toContainText("Unlocked", { timeout: 60_000 });

    const login = await context.newPage();
    await login.goto("/test-login.html");
    await popup.bringToFront();
    await popup.locator("#fill").click();
    await expect(login.locator("#username")).toHaveValue("ada@example.com");
    await expect(login.locator("#password")).toHaveValue("s3cret-autofill");
  } finally {
    await context.close();
  }
});
