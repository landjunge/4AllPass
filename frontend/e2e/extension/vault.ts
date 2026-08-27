import { expect, type Page } from "@playwright/test";
import { VAULT_PASSWORD, clickAndType } from "../live/actions.ts";

export async function ensureLocalVault(page: Page, origin: string): Promise<void> {
  await page.goto(origin + "/");
  const create = page.getByTestId("create-vault");
  const master = page.getByTestId("master-password");
  await expect(create.or(master)).toBeVisible({ timeout: 60_000 });
  if (await create.isVisible()) {
    await clickAndType(page, page.getByTestId("vault-password"), VAULT_PASSWORD);
    await clickAndType(page, page.getByTestId("vault-password-repeat"), VAULT_PASSWORD);
    await page.getByTestId("create-vault").click();
    await page.getByRole("checkbox").click();
    await page.getByTestId("dismiss-kit").click();
  } else {
    await clickAndType(page, master, VAULT_PASSWORD);
    await page.getByTestId("unlock-submit").click();
  }
  await expect(page.getByTestId("lock-state")).toHaveText("UNLOCKED");
}
