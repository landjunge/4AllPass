import { expect, test, type Page } from "@playwright/test";
import { clickAndType, reachUnlockedLocalApp, VAULT_PASSWORD } from "../live/actions.ts";

/** Let a human observer see the screen. */
async function look(page: Page, ms = 2200): Promise<void> {
  await page.waitForTimeout(ms);
}

async function hoverTips(page: Page, n = 4): Promise<number> {
  const tips = page.locator(".tip, [title]");
  const count = await tips.count();
  for (let i = 0; i < Math.min(count, n); i++) {
    await tips.nth(i).hover();
    await page.waitForTimeout(450);
  }
  return count;
}

test("observer: V0–V8 Dummy-Tresor, Maus und Tastatur", async ({ page }) => {
  await page.goto("/");
  await look(page, 1800);

  await reachUnlockedLocalApp(page);
  await look(page);

  await expect(page.getByTestId("tab-entries")).toBeVisible();
  await expect(page.getByTestId("tab-entries")).toHaveClass(/active/);
  await expect(page.getByTestId("lock-state")).toHaveText("UNLOCKED");
  await expect(page.getByTestId("new-entry")).toBeVisible();
  await hoverTips(page);

  const empty = page.getByTestId("vault-empty");
  if (await empty.isVisible().catch(() => false)) {
    await expect(empty).toBeVisible();
    await look(page);
  }

  await page.getByTestId("new-entry").click();
  await look(page, 1600);
  await hoverTips(page, 6);
  await clickAndType(page, page.getByTestId("entry-title"), "watch.example");
  await clickAndType(page, page.getByTestId("entry-username"), "ada");
  await clickAndType(page, page.getByTestId("entry-password"), "watch-dummy-not-real");
  await page.getByTestId("save-entry").click();
  await expect(page.getByRole("button", { name: /watch\.example/ })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("watch-dummy-not-real");
  await look(page);

  await page.getByTestId("tab-browser").click();
  await look(page, 2500);
  await expect(page.locator("body")).not.toContainText("watch-dummy-not-real");

  await page.getByTestId("tab-access").click();
  await look(page, 2500);
  const accessBody = page.getByTestId("n8n-http-body");
  if (await accessBody.isVisible().catch(() => false)) {
    await expect(accessBody).not.toContainText("watch-dummy-not-real");
  }

  await page.getByTestId("tab-settings").click();
  await look(page, 2200);
  await expect(page.getByTestId("uninstall-hint")).toBeVisible();
  const sleepHint = page.getByTestId("sleep-lock-hint");
  if (await sleepHint.isVisible().catch(() => false)) {
    await expect(sleepHint).toBeVisible();
  }

  const security = page.getByTestId("tab-security");
  if (await security.isVisible().catch(() => false)) {
    await security.click();
    await look(page, 1800);
  }

  await page.getByTestId("tab-entries").click();
  await expect(page.getByRole("button", { name: /watch\.example/ })).toBeVisible();
  await look(page);

  await page.getByTestId("lock").click();
  await expect(page.getByTestId("master-password")).toBeVisible();
  await look(page, 1800);
  await clickAndType(page, page.getByTestId("master-password"), VAULT_PASSWORD);
  await page.getByTestId("unlock-submit").click();
  await expect(page.getByTestId("lock-state")).toHaveText("UNLOCKED");
  await expect(page.getByTestId("tab-entries")).toHaveClass(/active/);
  await look(page, 5000);
});
