import { expect, test } from "@playwright/test";
import { clickAndType } from "../live/actions.ts";

const VAULT_PASSWORD = "korrektes-pferd-batterie-heftklammer";
const NEW_PASSWORD = "neues-pferd-batterie-heftklammer";
const NEXT_PASSWORD = "zweites-meisterwort-hafenbank";

async function openWithKit(page: import("@playwright/test").Page, kit: string): Promise<void> {
  await page.getByRole("button", { name: /Recovery-Schlüssel|recovery key/i }).click();
  const recoveryInput = page.locator("textarea");
  await recoveryInput.click();
  await recoveryInput.pressSequentially(kit.trim(), { delay: 3 });
  await page.getByTestId("unlock-submit").click();
  await expect(page.getByTestId("recovery-master-dialog")).toBeVisible({ timeout: 60_000 });
}

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

  await openWithKit(page, kit);
  await clickAndType(page, page.getByTestId("recovery-master-password"), NEW_PASSWORD);
  await clickAndType(page, page.getByTestId("recovery-master-confirm"), NEW_PASSWORD);
  await page.getByTestId("recovery-master-submit").click();

  await expect(page.getByTestId("lock-state")).toHaveText("UNLOCKED");
  await expect(page.getByTestId("recovery-master-dialog")).toHaveCount(0);

  // Device enrolment is a separate, optional click right after the master
  // commit — it must not start by itself, and it ends with the lock.
  await expect(page.getByTestId("recovery-device-offer")).toBeVisible();
  await page.getByTestId("recovery-device-later").click();
  await expect(page.getByTestId("recovery-device-offer")).toHaveCount(0);

  await page.getByTestId("lock").click();
  await clickAndType(page, page.getByTestId("master-password"), NEW_PASSWORD);
  await page.getByTestId("unlock-submit").click();
  await expect(page.getByTestId("lock-state")).toHaveText("UNLOCKED");

  // Lock during the commit: the request is delayed, the user locks, and the
  // committed master password (not an adopted vault) is what reopens later.
  await page.getByTestId("lock").click();
  await openWithKit(page, kit);
  await clickAndType(page, page.getByTestId("recovery-master-password"), NEXT_PASSWORD);
  await clickAndType(page, page.getByTestId("recovery-master-confirm"), NEXT_PASSWORD);
  await page.route("**/api/v1/vaults/*/snapshots", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await route.continue();
  });
  const commit = page.waitForResponse(
    (response) => response.url().includes("/snapshots") && response.request().method() === "POST",
  );
  await page.getByTestId("recovery-master-submit").click();
  await page.waitForTimeout(200);
  await page.getByTestId("lock").click();
  await expect(page.getByTestId("lock-state")).toHaveText("LOCKED");
  await commit;
  await page.unroute("**/api/v1/vaults/*/snapshots");
  await expect(page.getByTestId("master-password")).toBeVisible();
  await clickAndType(page, page.getByTestId("master-password"), NEXT_PASSWORD);
  await page.getByTestId("unlock-submit").click();
  await expect(page.getByTestId("lock-state")).toHaveText("UNLOCKED");

  // Skip drops the typed input; a new recovery does not show it again.
  await page.getByTestId("lock").click();
  await openWithKit(page, kit);
  await clickAndType(page, page.getByTestId("recovery-master-password"), "elf-zeichen");
  await page.getByTestId("recovery-master-skip").click();
  await expect(page.getByTestId("recovery-master-dialog")).toHaveCount(0);
  await page.getByTestId("lock").click();
  await openWithKit(page, kit);
  await expect(page.getByTestId("recovery-master-password")).toHaveValue("");
  await expect(page.getByTestId("recovery-master-confirm")).toHaveValue("");
});
