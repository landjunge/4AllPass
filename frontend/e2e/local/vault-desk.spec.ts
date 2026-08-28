import { expect, test } from "@playwright/test";
import { clickAndType, reachUnlockedLocalApp } from "../live/actions.ts";

const SECRET = "desk-secret-must-not-appear";

test("vault desk: empty CTA, add login, row has no password, star favorites", async ({ page }) => {
  await page.goto("/");
  await reachUnlockedLocalApp(page);

  const empty = page.getByTestId("vault-empty");
  if (await empty.isVisible().catch(() => false)) {
    await expect(empty).toBeVisible();
  }
  await page.getByTestId("new-entry").click();
  await clickAndType(page, page.getByTestId("entry-title"), "desk.example");
  await clickAndType(page, page.getByTestId("entry-username"), "ada");
  await clickAndType(page, page.getByTestId("entry-password"), SECRET);
  await page.getByTestId("save-entry").click();

  const row = page.getByRole("button", { name: /desk\.example/ });
  await expect(row).toBeVisible();
  await expect(page.locator("body")).not.toContainText(SECRET);

  const star = page.getByRole("button", { name: /Favorit|Favorite/ }).first();
  await star.click();
  await expect(star).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: /Favoriten|Favorites/ })).toBeVisible();
});
