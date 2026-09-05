import { mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { clickAndType, skipOnboardingIfPresent, VAULT_PASSWORD } from "../live/actions.ts";

const SHOTS = join(homedir(), "gnom-hub-v1/docs/assets/suite");

async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

async function hoverTips(page: Page): Promise<void> {
  const tips = page.locator(".tip").locator("visible=true");
  const n = await tips.count();
  for (let i = 0; i < n; i++) {
    await tips.nth(i).hover();
    await page.waitForTimeout(250);
  }
}

async function openVault(page: Page): Promise<void> {
  await page.goto("/");
  await shot(page, "00-start");
  const create = page.getByTestId("vault-password");
  const auth = page.getByTestId("auth-submit");
  await expect(auth.or(create)).toBeVisible();

  if (await auth.isVisible()) {
    await hoverTips(page);
    await shot(page, "01-auth");
  }

  if (await create.isVisible()) {
    await hoverTips(page);
    await shot(page, "01-create");
    await clickAndType(page, page.getByTestId("vault-password"), VAULT_PASSWORD);
    await clickAndType(page, page.getByTestId("vault-password-repeat"), VAULT_PASSWORD);
    await page.getByTestId("vault-password").fill(VAULT_PASSWORD);
    await page.getByTestId("vault-password-repeat").fill(VAULT_PASSWORD);
    await expect(page.getByTestId("create-vault")).toBeEnabled();
    await page.getByTestId("create-vault").click();
    await expect(page.getByTestId("confirm-kit-stored")).toBeVisible({ timeout: 90_000 });
    await shot(page, "01-recovery-kit");
    await page.getByTestId("confirm-kit-stored").click();
    await page.getByTestId("dismiss-kit").click();
  }

  await expect(page.getByTestId("lock-state")).toHaveText("UNLOCKED");
  await skipOnboardingIfPresent(page);
  await expect(page.getByTestId("tab-entries")).toHaveClass(/active/);
}

test.describe.configure({ mode: "serial" });

test("user-watch: every surface, card, and button", async ({ page }) => {
  rmSync(SHOTS, { recursive: true, force: true });
  mkdirSync(SHOTS, { recursive: true });

  await test.step("V2 create vault", async () => {
    await openVault(page);
    await shot(page, "02-tresor-empty");
  });

  await test.step("V4 empty cards Login / API / Server", async () => {
    const empty = page.getByTestId("vault-detail-empty");
    if (await empty.isVisible().catch(() => false)) {
      const cards = empty.locator("button.empty-action");
      const n = await cards.count();
      for (let i = 0; i < n; i++) {
        await cards.nth(i).click();
        await hoverTips(page);
        await shot(page, `03-empty-${i}`);
        await page.getByRole("button", { name: /Abbrechen|Cancel/ }).click();
        await expect(empty).toBeVisible();
      }
    }
  });

  await test.step("V4 add login", async () => {
    await page.getByTestId("new-entry").click();
    await hoverTips(page);
    await shot(page, "04-new-login");
    await clickAndType(page, page.getByTestId("entry-title"), "sehr-langer-profilname-der-gekuerzt-werden-muss.example");
    await clickAndType(page, page.getByTestId("entry-username"), "ada");
    await clickAndType(page, page.getByTestId("entry-password"), "watch-dummy-not-real");
    await page.getByTestId("save-entry").click();
    await expect(page.locator("body")).not.toContainText("watch-dummy-not-real");
    await expect(page.getByRole("button", { name: /sehr-langer-profilname/ })).toBeVisible();
    await shot(page, "05-saved-list");
  });

  await test.step("V4 list ellipsis and filters", async () => {
    const row = page.getByRole("button", { name: /sehr-langer-profilname/ });
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute("title", /sehr-langer-profilname-der-gekuerzt-werden-muss/);
    for (const name of [/Alle|All/, /Logins/, /API/, /Server/, /Kurz|Short/]) {
      await page.getByRole("button", { name }).first().click();
    }
    await page.getByRole("button", { name: /Alle|All/ }).first().click();
    await shot(page, "06-filters");
  });

  await test.step("V5 browser", async () => {
    await page.getByTestId("tab-browser").click();
    await shot(page, "07-browser");
    await expect(page.locator("body")).not.toContainText("watch-dummy-not-real");
  });

  await test.step("V6 access copy is honest", async () => {
    await page.getByTestId("tab-access").click();
    await shot(page, "08-access");
    await expect(page.locator("body")).not.toContainText("bleibt im Tresor");
    await expect(page.locator("body")).not.toContainText("stays in the vault");
  });

  await test.step("V7 settings panes", async () => {
    await page.getByTestId("tab-settings").click();
    await shot(page, "09-settings-general");
    await expect(page.getByTestId("uninstall-hint")).toBeVisible();
    await page.getByTestId("tab-devices").click();
    await shot(page, "10-settings-devices");
    await page.getByTestId("tab-security").click();
    await shot(page, "11-settings-security");
  });

  await test.step("V0 lock then V3 unlock, first tab is Tresor", async () => {
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
