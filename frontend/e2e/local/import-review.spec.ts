import { expect, test } from "@playwright/test";
import { reachUnlockedLocalApp } from "../live/actions.ts";

const SECRET = "hunter2-must-not-appear-in-review";

test("import review lists host and username, never the password", async ({ page }) => {
  await page.goto("/");
  await reachUnlockedLocalApp(page);

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
