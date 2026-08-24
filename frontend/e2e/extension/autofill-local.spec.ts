import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, chromium } from "@playwright/test";
import { VAULT_PASSWORD, addEntryWithMouse, clickAndType } from "../live/actions.ts";

const DIST = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../extension/dist/chromium",
);
const ORIGIN = process.env.E2E_BASE_URL ?? "http://127.0.0.1:8794";

test("local vault password unlocks the extension and fills the demo login", async () => {
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
    await page.goto(ORIGIN + "/");
    await expect(page.getByTestId("welcome-create")).toBeVisible();
    await page.getByTestId("welcome-create").click();
    await clickAndType(page, page.getByTestId("vault-password"), VAULT_PASSWORD);
    await clickAndType(page, page.getByTestId("vault-password-repeat"), VAULT_PASSWORD);
    await page.getByTestId("create-vault").click();
    await page.getByRole("checkbox").click();
    await page.getByTestId("dismiss-kit").click();
    await expect(page.getByTestId("lock-state")).toHaveText("UNLOCKED");

    await addEntryWithMouse(page, {
      title: "Demo login",
      username: "ada@example.com",
      password: "s3cret-autofill",
      url: `${ORIGIN}/test-login.html`,
    });

    const login = await context.newPage();
    await login.goto(`${ORIGIN}/test-login.html`);
    await expect(login.locator("#username")).toBeVisible();

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.locator("#api").fill(ORIGIN);
    await popup.locator("#vault").fill(VAULT_PASSWORD);
    await popup.locator("#unlock-btn").click();
    await expect(popup.locator("#status")).toContainText("Unlocked", { timeout: 60_000 });

    await login.bringToFront();
    await popup.bringToFront();
    await popup.locator("#fill").click();
    await expect(login.locator("#username")).toHaveValue("ada@example.com");
    await expect(login.locator("#password")).toHaveValue("s3cret-autofill");
  } finally {
    await context.close();
  }
});
