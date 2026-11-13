import { expect, test } from "@playwright/test";
import { clickAndType } from "../live/actions.ts";

const VAULT_PASSWORD = "korrektes-pferd-batterie-heftklammer";
const NEW_PASSWORD = "neues-pferd-batterie-heftklammer";

/**
 * P05 journey: create → kit → lose master password → recovery unlock →
 * deliberate new master password → lock → reopen with the new password.
 * Own fresh backend (see the `recovery-journey` project), synthetic data only.
 */
test("recovery unlock sets a new master password and the vault reopens", async ({ page }) => {
  await page.goto("/");

  const auth = page.getByTestId("auth-submit");
  if (await auth.isVisible().catch(() => false)) {
    await clickAndType(page, page.getByLabel("E-mail"), `recovery_journey_${Date.now()}@example.com`);
    await clickAndType(page, page.getByLabel("Account password"), "account-password-1234");
    await auth.click();
  }

  await expect(page.getByTestId("vault-password")).toBeVisible({ timeout: 60_000 });
  await clickAndType(page, page.getByTestId("vault-password"), VAULT_PASSWORD);
  await clickAndType(page, page.getByTestId("vault-password-repeat"), VAULT_PASSWORD);
  await page.getByTestId("create-vault").click();

  const kit = (await page.getByTestId("recovery-key").textContent()) ?? "";
  expect(kit.replace(/-/g, "")).toHaveLength(55);
  await page.getByTestId("confirm-kit-stored").click();
  await page.getByTestId("dismiss-kit").click();
  await expect(page.getByTestId("lock-state")).toHaveText("UNLOCKED");

  const skip = page.getByTestId("onboarding-skip");
  if (await skip.isVisible().catch(() => false)) await skip.click();

  await page.getByTestId("lock").click();
  await expect(page.getByTestId("master-password")).toBeVisible();

  await page.getByRole("button", { name: /Recovery-Schlüssel|recovery key/i }).click();
  const recoveryInput = page.locator("textarea");
  await recoveryInput.click();
  await recoveryInput.pressSequentially(kit.trim(), { delay: 3 });
  await page.getByTestId("unlock-submit").click();

  await expect(page.getByTestId("recovery-master-dialog")).toBeVisible({ timeout: 60_000 });
  await clickAndType(page, page.getByTestId("recovery-master-password"), NEW_PASSWORD);
  await clickAndType(page, page.getByTestId("recovery-master-confirm"), NEW_PASSWORD);
  await page.getByTestId("recovery-master-submit").click();

  await expect(page.getByTestId("lock-state")).toHaveText("UNLOCKED");
  await expect(page.getByTestId("recovery-master-dialog")).toHaveCount(0);

  await page.getByTestId("lock").click();
  await clickAndType(page, page.getByTestId("master-password"), NEW_PASSWORD);
  await page.getByTestId("unlock-submit").click();
  await expect(page.getByTestId("lock-state")).toHaveText("UNLOCKED");
});
