import { expect, test } from "@playwright/test";
import { reachUnlockedLocalApp, VAULT_PASSWORD } from "../live/actions.ts";

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

test("CSV errors never yield a partial preview; quoted records survive import and unlock", async ({ page }) => {
  await page.goto("/");
  await reachUnlockedLocalApp(page);
  let writes = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/snapshots")) writes++;
  });
  const marker = "synthetic-csv-secret-not-for-preview";
  for (const language of ["de", "en"] as const) {
    await page.getByTestId(`language-${language}`).click();
    for (const [index, invalid] of [
      `Mail,ada,https://mail.example/,"${marker}`,
      marker,
    ].entries()) {
      const dialogHandled = page.waitForEvent("dialog").then(async (dialog) => {
        const message = dialog.message();
        await dialog.dismiss();
        expect(message).toMatch(language === "de" ? /Es wurde nichts übernommen/ : /Nothing was imported/);
        expect(message).not.toContain(marker);
      });
      await page.getByTestId("import-file").setInputFiles({
        name: `invalid-${language}-${index}.csv`, mimeType: "text/csv",
        buffer: Buffer.from(`title,username,url,password\nValid,ada,https://mail.example/,synthetic\n${invalid}\n`),
      });
      await dialogHandled;
      await expect(page.getByTestId("import-review")).toHaveCount(0);
      expect(writes).toBe(0);
    }
  }
  const csv = `title,username,url,password\r\nCSV multiline synthetic,ada,https://csv.example/,"first""quote\r\n${marker}"\r\nCSV trailing synthetic,bob,https://csv.example/,  synthetic tail  \r\n`;
  await page.getByTestId("import-file").setInputFiles({
    name: "quoted-records.csv", mimeType: "text/csv", buffer: Buffer.from(csv),
  });
  const review = page.getByTestId("import-review");
  await expect(review).toBeVisible();
  await expect(review.locator("li")).toHaveCount(2);
  await expect(review).not.toContainText(marker);
  await page.getByTestId("confirm-import").click();
  await expect(review).toHaveCount(0);
  expect(writes).toBe(1);
  await page.getByTestId("lock").click();
  await page.getByTestId("master-password").fill(VAULT_PASSWORD);
  await page.getByTestId("unlock-submit").click();
  await expect(page.getByTestId("lock-state")).toHaveText("UNLOCKED");
  await expect(page.getByRole("button", { name: /CSV multiline synthetic/ })).toBeVisible();
  await page.getByRole("button", { name: /CSV trailing synthetic/ }).click();
  await expect(page.getByTestId("entry-password")).toHaveValue("  synthetic tail  ");
  await expect(page.locator("body")).not.toContainText(marker);
});
