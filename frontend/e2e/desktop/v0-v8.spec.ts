import { mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { clickAndType, skipOnboardingIfPresent, ACCOUNT_PASSWORD, VAULT_PASSWORD } from "../live/actions.ts";
import { stubDesktopShell } from "./shell.ts";

const SHOTS = join(homedir(), "gnom-hub-v1/docs/assets/suite-desktop");

async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

async function hoverTips(page: Page): Promise<void> {
  const tips = page.locator(".tip").locator("visible=true");
  const n = await tips.count();
  for (let i = 0; i < n; i++) {
    await tips.nth(i).hover();
    await page.waitForTimeout(200);
  }
}

test.describe.configure({ mode: "serial" });

test("desktop shell: every surface, card, and button", async ({ page }) => {
  rmSync(SHOTS, { recursive: true, force: true });
  mkdirSync(SHOTS, { recursive: true });
  const origin = `http://127.0.0.1:${process.env.E2E_DESKTOP_WATCH_PORT ?? "8796"}`;
  await stubDesktopShell(page, origin);

  await test.step("V1 auth (desktop skips silent local login)", async () => {
    await page.goto("/");
    await expect(page.getByTestId("auth-submit")).toBeVisible({ timeout: 60_000 });
    await hoverTips(page);
    await shot(page, "01-auth");
    const email = `desk_${Date.now()}@example.com`;
    await clickAndType(page, page.getByLabel("E-mail"), email);
    await clickAndType(page, page.getByLabel("Account password"), ACCOUNT_PASSWORD);
    await page.getByTestId("auth-submit").click();
    await expect(page.getByTestId("vault-password")).toBeVisible({ timeout: 60_000 });
  });

  await test.step("V2 create vault + recovery kit", async () => {
    await hoverTips(page);
    await shot(page, "02-create");
    await clickAndType(page, page.getByTestId("vault-password"), VAULT_PASSWORD);
    await clickAndType(page, page.getByTestId("vault-password-repeat"), VAULT_PASSWORD);
    await page.getByTestId("vault-password").fill(VAULT_PASSWORD);
    await page.getByTestId("vault-password-repeat").fill(VAULT_PASSWORD);
    await expect(page.getByTestId("create-vault")).toBeEnabled();
    await page.getByTestId("create-vault").click();
    await expect(page.getByTestId("confirm-kit-stored")).toBeVisible({ timeout: 90_000 });
    await shot(page, "03-recovery-kit");
    await page.getByTestId("confirm-kit-stored").click();
    await page.getByTestId("dismiss-kit").click();
    await expect(page.getByTestId("lock-state")).toHaveText("UNLOCKED");
    await skipOnboardingIfPresent(page);
    await expect(page.getByTestId("tab-entries")).toHaveClass(/active/);
    await shot(page, "04-tresor");
  });

  await test.step("V4 empty cards then one login", async () => {
    const empty = page.getByTestId("vault-detail-empty");
    if (await empty.isVisible().catch(() => false)) {
      const cards = empty.locator("button.empty-action");
      const n = await cards.count();
      for (let i = 0; i < n; i++) {
        await cards.nth(i).click();
        await hoverTips(page);
        await shot(page, `05-empty-${i}`);
        await page.getByRole("button", { name: /Abbrechen|Cancel/ }).click();
        await expect(empty).toBeVisible();
      }
    }
    await page.getByTestId("new-entry").click();
    await hoverTips(page);
    await clickAndType(page, page.getByTestId("entry-title"), "desk.example");
    await clickAndType(page, page.getByTestId("entry-username"), "ada");
    await clickAndType(page, page.getByTestId("entry-password"), "desk-dummy-not-real");
    await page.getByTestId("save-entry").click();
    await expect(page.locator("body")).not.toContainText("desk-dummy-not-real");
    await expect(page.getByRole("button", { name: /desk\.example/ })).toBeVisible();
    await shot(page, "06-saved");
  });

  await test.step("V5 browser V6 access V7 settings", async () => {
    await page.getByTestId("tab-browser").click();
    await shot(page, "07-browser");
    await expect(page.locator("body")).not.toContainText("desk-dummy-not-real");
    await page.getByTestId("tab-access").click();
    await shot(page, "08-access");
    await expect(page.locator("body")).not.toContainText("bleibt im Tresor");
    await page.getByTestId("tab-settings").click();
    await shot(page, "09-settings");
    await expect(page.getByTestId("uninstall-hint")).toBeVisible();
    await page.getByTestId("tab-devices").click();
    await shot(page, "10-devices");
    await page.getByTestId("tab-security").click();
    await shot(page, "11-security");
  });

  await test.step("V0 lock V3 unlock, first tab Tresor", async () => {
    await page.getByTestId("lock").click();
    await expect(page.getByTestId("master-password")).toBeVisible();
    await hoverTips(page);
    await shot(page, "12-locked");
    await clickAndType(page, page.getByTestId("master-password"), VAULT_PASSWORD);
    await page.getByTestId("unlock-submit").click();
    await expect(page.getByTestId("lock-state")).toHaveText("UNLOCKED");
    await expect(page.getByTestId("tab-entries")).toHaveClass(/active/);
    await shot(page, "13-unlocked");
  });
});
