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
  await expect(page.getByTestId("recovery-master-offer")).toBeVisible({ timeout: 60_000 });
}

/**
 * P05 journey: create → kit → lose master password → recovery unlock →
 * deliberate new master + fresh kit confirmation → separate device step →
 * lock → reopen with the new password. Own fresh backend, synthetic data only.
 */
test("kit recovery sets a new master and the vault reopens", async ({ page }) => {
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
  await openWithKit(page, kit);

  // The offer needs a fresh kit confirmation; no old master password.
  await clickAndType(page, page.getByTestId("recovery-new-password"), NEW_PASSWORD);
  await clickAndType(page, page.getByTestId("recovery-new-password-repeat"), NEW_PASSWORD);
  await clickAndType(page, page.getByTestId("recovery-master-kit"), kit);
  await page.getByTestId("confirm-recovery-master").click();

  await expect(page.getByTestId("recovery-master-offer")).toContainText(/gespeichert|saved/i);
  await expect(page.getByTestId("lock-state")).toHaveText("UNLOCKED");

  // Device enrolment is a separate step after the master commit; it only opens
  // the existing devices UI (no automatic ceremony here).
  await page.getByTestId("recovery-open-devices").click();
  await expect(page.getByTestId("recovery-master-offer")).toHaveCount(0);
  await expect(page.getByTestId("tab-devices")).toHaveClass(/active/);

  await page.getByTestId("lock").click();
  await clickAndType(page, page.getByTestId("master-password"), NEW_PASSWORD);
  await page.getByTestId("unlock-submit").click();
  await expect(page.getByTestId("lock-state")).toHaveText("UNLOCKED");

  // Lock during an in-flight commit: the delayed response must not re-adopt,
  // and the committed new password reopens later.
  await page.getByTestId("lock").click();
  await openWithKit(page, kit);
  await clickAndType(page, page.getByTestId("recovery-new-password"), NEXT_PASSWORD);
  await clickAndType(page, page.getByTestId("recovery-new-password-repeat"), NEXT_PASSWORD);
  await clickAndType(page, page.getByTestId("recovery-master-kit"), kit);
  await page.route("**/api/v1/vaults/*/snapshots", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await route.continue();
  });
  const commit = page.waitForResponse(
    (response) => response.url().includes("/snapshots") && response.request().method() === "POST",
  );
  await page.getByTestId("confirm-recovery-master").click();
  await page.waitForTimeout(200);
  // The modal overlay covers the header; invoke the real lock handler directly
  // to simulate a lock/sign-out that lands while the commit is in flight.
  await page.getByTestId("lock").evaluate((element) => (element as HTMLElement).click());
  await expect(page.getByTestId("lock-state")).toHaveText("LOCKED");
  await commit;
  await page.unroute("**/api/v1/vaults/*/snapshots");
  await expect(page.getByTestId("master-password")).toBeVisible();
  await clickAndType(page, page.getByTestId("master-password"), NEXT_PASSWORD);
  await page.getByTestId("unlock-submit").click();
  await expect(page.getByTestId("lock-state")).toHaveText("UNLOCKED");

  // Skip drops the typed inputs; a new recovery does not show them again.
  await page.getByTestId("lock").click();
  await openWithKit(page, kit);
  await clickAndType(page, page.getByTestId("recovery-new-password"), "elf-zeichen");
  await page.getByTestId("dismiss-recovery-master").click();
  await expect(page.getByTestId("recovery-master-offer")).toHaveCount(0);
  await page.getByTestId("lock").click();
  await openWithKit(page, kit);
  await expect(page.getByTestId("recovery-new-password")).toHaveValue("");
  await expect(page.getByTestId("recovery-master-kit")).toHaveValue("");
});
