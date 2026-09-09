import { expect, test } from "@playwright/test";
import { ensureLocalVault } from "../extension/vault.ts";

const ORIGIN = process.env.E2E_BASE_URL ?? "http://127.0.0.1:8790";

/**
 * One language per surface, not "Öffnen / Unlock" on every button.
 *
 * This covers the copy that already goes through `t({ de, en })`. Copy still
 * hardcoded as "DE / EN" in JSX is a separate, mechanical cleanup — see
 * docs/ui-map.md.
 */
test("copy renders in one language and follows the switch", async ({ page }) => {
  await ensureLocalVault(page, ORIGIN);
  await page.getByTestId("tab-settings").click();

  const hint = page.getByTestId("plain-language-hint");
  await expect(hint).toBeVisible();

  // German by default here, and crucially without the English half glued on.
  await expect(hint).toContainText("kurze Sätze");
  await expect(hint).not.toContainText("short sentences");

  await page.getByTestId("language-select").selectOption("en");
  await expect(hint).toContainText("short sentences");
  await expect(hint).not.toContainText("kurze Sätze");

  // The choice survives a reload — it is a setting, not a session toggle.
  // (Reloading locks the vault, so open it again first.)
  await page.reload();
  await ensureLocalVault(page, ORIGIN);
  await page.getByTestId("tab-settings").click();
  await expect(page.getByTestId("plain-language-hint")).toContainText("short sentences");

  await page.getByTestId("language-select").selectOption("de");
  await expect(page.getByTestId("plain-language-hint")).toContainText("kurze Sätze");
});
