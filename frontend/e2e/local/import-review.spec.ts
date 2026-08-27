import { expect, test } from "@playwright/test";
import { clickAndType, VAULT_PASSWORD } from "../live/actions.ts";

const SECRET = "hunter2-must-not-appear-in-review";

test("import review lists host and username, never the password", async ({ page }) => {
  await page.goto("/");
  await clickAndType(page, page.getByTestId("vault-password"), VAULT_PASSWORD);
  await clickAndType(page, page.getByTestId("vault-password-repeat"), VAULT_PASSWORD);
  await page.getByTestId("create-vault").click();
  await page.getByTestId("confirm-kit-stored").click();
  await page.getByTestId("dismiss-kit").click();
  await expect(page.getByTestId("lock-state")).toHaveText("UNLOCKED");
  const skip = page.getByTestId("onboarding-skip");
  if (await skip.isVisible().catch(() => false)) await skip.click();

  const csv = `title,username,password,url\nmail.example,ada,${SECRET},https://mail.example/\n`;
  await page.getByTestId("import-file").setInputFiles({
    name: "logins.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv, "utf8"),
  });

  const review = page.getByTestId("import-review");
  await expect(review).toBeVisible();
  await expect(review).toContainText("ada");
  await expect(review).toContainText("mail.example");
  await expect(review).not.toContainText(SECRET);

  await page.getByTestId("confirm-import").click();
  await expect(page.getByRole("button", { name: /mail\.example/ })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(SECRET);
});
