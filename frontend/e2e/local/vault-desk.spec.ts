import { expect, test } from "@playwright/test";
import { clickAndType, VAULT_PASSWORD } from "../live/actions.ts";

const SECRET = "desk-secret-must-not-appear";

test("vault desk: empty CTA, add login, row has no password, star favorites", async ({ page }) => {
  await page.goto("/");
  await clickAndType(page, page.getByTestId("vault-password"), VAULT_PASSWORD);
  await clickAndType(page, page.getByTestId("vault-password-repeat"), VAULT_PASSWORD);
  await page.getByTestId("create-vault").click();
  await page.getByTestId("confirm-kit-stored").click();
  await page.getByTestId("dismiss-kit").click();
  await expect(page.getByTestId("lock-state")).toHaveText("UNLOCKED");
  const skip = page.getByTestId("onboarding-skip");
  if (await skip.isVisible().catch(() => false)) await skip.click();

  await expect(page.getByTestId("vault-empty")).toBeVisible();
  await page.getByTestId("new-entry").click();
  await clickAndType(page, page.getByTestId("entry-title"), "mail.example");
  await clickAndType(page, page.getByTestId("entry-username"), "ada");
  await clickAndType(page, page.getByTestId("entry-password"), SECRET);
  await page.getByTestId("save-entry").click();

  const row = page.getByRole("button", { name: /mail\.example/ });
  await expect(row).toBeVisible();
  await expect(page.locator("body")).not.toContainText(SECRET);

  const star = page.getByRole("button", { name: /Favorit|Favorite/ }).first();
  await star.click();
  await expect(star).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: /Favoriten|Favorites/ })).toBeVisible();
});
