import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  clickAndType,
  reachUnlockedLocalApp,
  skipOnboardingIfPresent,
  VAULT_PASSWORD,
} from "../live/actions.ts";

const SHOTS = join(process.env.HOME ?? "/Users/landjunge", "gnom-hub-v1/docs/assets/suite");

async function look(page: Page, name: string, ms = 2800): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
  await page.waitForTimeout(ms);
}

async function hoverTips(page: Page, n = 5): Promise<number> {
  const tips = page.locator(".tip").locator("visible=true");
  const count = await tips.count();
  for (let i = 0; i < Math.min(count, n); i++) {
    await tips.nth(i).hover();
    await page.waitForTimeout(600);
  }
  return count;
}

test("observer: V0–V8 Dummy-Tresor, Maus und Tastatur", async ({ page }) => {
  await page.goto("/");
  await look(page, "00-start", 2000);

  const auth = page.getByTestId("auth-submit");
  const createPassword = page.getByTestId("vault-password");
  await expect(auth.or(createPassword)).toBeVisible({ timeout: 60_000 });
  if (await auth.isVisible()) {
    await hoverTips(page);
    await look(page, "01-auth");
  }

  if (await createPassword.isVisible()) {
    await hoverTips(page);
    await look(page, "01b-create");
    await clickAndType(page, page.getByTestId("vault-password"), VAULT_PASSWORD);
    await clickAndType(page, page.getByTestId("vault-password-repeat"), VAULT_PASSWORD);
    await page.getByTestId("vault-password").fill(VAULT_PASSWORD);
    await page.getByTestId("vault-password-repeat").fill(VAULT_PASSWORD);
    await expect(page.getByTestId("create-vault")).toBeEnabled();
    await page.getByTestId("create-vault").click();
    await expect(page.getByTestId("confirm-kit-stored")).toBeVisible({ timeout: 90_000 });
    await page.getByTestId("confirm-kit-stored").click();
    await page.getByTestId("dismiss-kit").click();
    await expect(page.getByTestId("lock-state")).toHaveText("UNLOCKED");
    await skipOnboardingIfPresent(page);
  } else {
    await reachUnlockedLocalApp(page);
  }
  await look(page, "02-tresor");

  await expect(page.getByTestId("tab-entries")).toHaveClass(/active/);
  await expect(page.getByTestId("new-entry")).toBeVisible();
  await hoverTips(page);

  await page.getByTestId("new-entry").click();
  await hoverTips(page, 6);
  await look(page, "03-entry-form", 2000);
  await clickAndType(
    page,
    page.getByTestId("entry-title"),
    "sehr-langer-profilname-der-gekuerzt-werden-muss.example",
  );
  await clickAndType(page, page.getByTestId("entry-username"), "ada");
  await clickAndType(page, page.getByTestId("entry-password"), "watch-dummy-not-real");
  await page.getByTestId("save-entry").click();
  const longRow = page.getByRole("button", { name: /sehr-langer-profilname/ });
  await expect(longRow).toBeVisible();
  await expect(page.locator("body")).not.toContainText("watch-dummy-not-real");
  await look(page, "04-list");

  await page.getByTestId("tab-browser").click();
  await look(page, "05-browser");
  await expect(page.locator("body")).not.toContainText("watch-dummy-not-real");

  await page.getByTestId("tab-access").click();
  await look(page, "06-access");
  const why = page.locator("body");
  await expect(why).not.toContainText("bleibt im Tresor");
  await expect(why).not.toContainText("stays in the vault");

  await page.getByTestId("tab-settings").click();
  await look(page, "07-settings");
  await expect(page.getByTestId("uninstall-hint")).toBeVisible();
  const sleepHint = page.getByTestId("sleep-lock-hint");
  if (await sleepHint.isVisible().catch(() => false)) {
    await expect(sleepHint).toContainText(/Sperren|Lock|FileVault/i);
  }

  const security = page.getByTestId("tab-security");
  if (await security.isVisible().catch(() => false)) {
    await security.click();
    await look(page, "08-security", 2000);
  }

  await page.getByTestId("tab-entries").click();
  await expect(longRow).toBeVisible();
  await look(page, "09-tresor-again", 1800);

  await page.getByTestId("lock").click();
  await expect(page.getByTestId("master-password")).toBeVisible();
  await hoverTips(page);
  await look(page, "10-unlock");
  await clickAndType(page, page.getByTestId("master-password"), VAULT_PASSWORD);
  await page.getByTestId("unlock-submit").click();
  await expect(page.getByTestId("lock-state")).toHaveText("UNLOCKED");
  await expect(page.getByTestId("tab-entries")).toHaveClass(/active/);
  await look(page, "11-done", 6000);
});
