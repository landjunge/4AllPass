import { expect, test } from "@playwright/test";
import {
  ACCOUNT_PASSWORD,
  VAULT_PASSWORD,
  addEntryWithMouse,
  clickAndType,
  skipOnboardingIfPresent,
} from "../live/actions.ts";
import { stubDesktopShell } from "./shell.ts";
import { expectUsableControls, JourneyObserver } from "./journey-observer.ts";

test.describe.configure({ mode: "serial" });

test("fresh desktop user: register, create, sign in, use, lock", async ({ page }, testInfo) => {
  const observer = new JourneyObserver(page, testInfo);
  const origin = `http://127.0.0.1:${process.env.E2E_DESKTOP_WATCH_PORT ?? "8796"}`;
  const email = `fresh_${Date.now()}@example.com`;
  await stubDesktopShell(page, origin);

  await observer.step("01-first-launch", async () => {
    await page.goto("/");
    await expect(page.getByTestId("auth-submit")).toBeVisible({ timeout: 60_000 });
    await expectUsableControls(page);
  });

  await observer.step("02-register", async () => {
    await clickAndType(page, page.getByLabel("E-mail"), email);
    await clickAndType(page, page.getByLabel("Account password"), ACCOUNT_PASSWORD);
    await page.getByTestId("auth-submit").click();
    await expect(page.getByTestId("vault-password")).toBeVisible({ timeout: 60_000 });
  });

  await observer.step("03-create-vault", async () => {
    await clickAndType(page, page.getByTestId("vault-password"), VAULT_PASSWORD);
    await clickAndType(page, page.getByTestId("vault-password-repeat"), VAULT_PASSWORD);
    await expect(page.getByTestId("create-vault")).toBeEnabled();
    await page.getByTestId("create-vault").click();
    await expect(page.getByTestId("confirm-kit-stored")).toBeVisible({ timeout: 90_000 });
    await page.getByTestId("confirm-kit-stored").click();
    await page.getByTestId("dismiss-kit").click();
    await expect(page.getByTestId("lock-state")).toHaveText("UNLOCKED");
    await skipOnboardingIfPresent(page);
  });

  await observer.step("04-sign-out", async () => {
    await page.getByRole("button", { name: /Abmelden|Sign out/ }).first().click();
    await expect(page.getByTestId("auth-submit")).toBeVisible({ timeout: 60_000 });
  });

  await observer.step("05-sign-in", async () => {
    const alreadySignIn = await page
      .getByRole("button", { name: /Anmelden|Sign in/ })
      .isVisible()
      .catch(() => false);
    if (!alreadySignIn) await page.getByTestId("auth-switch").click();
    await clickAndType(page, page.getByLabel("E-mail"), email);
    await clickAndType(page, page.getByLabel("Account password"), ACCOUNT_PASSWORD);
    await page.getByTestId("auth-submit").click();
    await expect(page.getByTestId("master-password")).toBeVisible({ timeout: 60_000 });
  });

  await observer.step("06-wrong-vault-password", async () => {
    await clickAndType(page, page.getByTestId("master-password"), "wrong-password-for-test");
    await page.getByTestId("unlock-submit").click();
    await expect(page.getByTestId("error-banner")).toBeVisible();
    await expect(page.getByTestId("master-password")).toBeVisible();
  });

  await observer.step("07-unlock", async () => {
    await clickAndType(page, page.getByTestId("master-password"), VAULT_PASSWORD);
    await page.getByTestId("unlock-submit").click();
    await expect(page.getByTestId("lock-state")).toHaveText("UNLOCKED");
    await skipOnboardingIfPresent(page);
    await expect(page.getByTestId("tab-entries")).toHaveClass(/active/);
  });

  await observer.step("08-create-entry", async () => {
    await addEntryWithMouse(page, {
      title: "Fresh User Login",
      username: "normal-user@example.com",
      password: "synthetic-test-secret-42",
      url: "https://example.com",
    });
    await expect(page.locator("body")).not.toContainText("synthetic-test-secret-42");
    await expectUsableControls(page);
  });

  await observer.step("09-browser", async () => {
    await page.getByTestId("tab-browser").click();
    await expectUsableControls(page);
  });

  await observer.step("10-agent-access", async () => {
    await page.getByTestId("tab-access").click();
    await expect(page.locator("body")).not.toContainText("synthetic-test-secret-42");
    await expectUsableControls(page);
  });

  await observer.step("11-settings", async () => {
    await page.getByTestId("tab-settings").click();
    await expect(page.getByTestId("uninstall-hint")).toBeVisible();
    await expectUsableControls(page);
    await page.getByTestId("tab-devices").click();
    await expectUsableControls(page);
    await page.getByTestId("tab-security").click();
    await expectUsableControls(page);
  });

  await observer.step("12-lock-and-unlock", async () => {
    await page.getByTestId("lock").click();
    await expect(page.getByTestId("master-password")).toBeVisible();
    await clickAndType(page, page.getByTestId("master-password"), VAULT_PASSWORD);
    await page.getByTestId("unlock-submit").click();
    await expect(page.getByTestId("lock-state")).toHaveText("UNLOCKED");
  });
});
