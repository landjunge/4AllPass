import { existsSync } from "node:fs";
import { chromium, expect, test } from "@playwright/test";
import { createVaultWithMouse, signUpWithMouse } from "./actions.ts";

const SLOWMO = Number(process.env.LIVE_SLOWMO ?? 400);
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEMO_SECRET = "ghp_demo-not-a-real-key";

test.describe.configure({ timeout: 4 * 60_000 });

/**
 * Headed Chrome, real mouse. Week-7 walkthrough from docs/two-minute-demo.md.
 * FastAPI is only the blob store — grants stay in the unlocked page.
 */
test("Access tab: Allow read → works → delete DENY → expire → unknown DENY", async () => {
  test.skip(!existsSync(CHROME), "Google Chrome.app is not installed");

  const browser = await chromium.launch({
    headless: false,
    slowMo: SLOWMO,
    executablePath: CHROME,
  });
  const page = await browser.newPage();
  try {
    await signUpWithMouse(page);
    await createVaultWithMouse(page);
    await expect(page.getByTestId("lock-state")).toHaveText("UNLOCKED");

    await page.getByTestId("tab-access").click();
    await expect(page.getByTestId("demo-scene")).toContainText("Need a GitHub credential");

    await page.getByTestId("demo-seed").click();
    await expect(page.getByTestId("demo-scene")).toContainText("n8n asks GitHub repository.read", {
      timeout: 30_000,
    });

    await page.getByTestId("demo-n8n-read").click();
    await page.getByTestId("access-allow").click();
    await expect(page.getByTestId("access-flash")).toHaveText("ACCESS GRANTED");
    await expect(page.getByTestId("demo-grant-status")).toContainText("n8n");
    await expect(page.getByTestId("demo-grant-status")).toContainText("s left");
    await expect(page.getByTestId("demo-grant-status")).not.toContainText("ghp_");
    await expect(page.getByTestId("demo-grant-status")).not.toContainText(DEMO_SECRET);

    await page.getByTestId("demo-next").click();
    await expect(page.getByTestId("demo-scene")).toContainText("n8n asks repository.delete");
    await page.getByTestId("demo-n8n-delete").click();
    await expect(page.getByTestId("access-flash")).toContainText("DENIED");
    await expect(page.getByTestId("access-flash")).toContainText("scope not permitted");

    await page.getByTestId("demo-next").click();
    await expect(page.getByTestId("demo-scene")).toContainText("TTL expires");
    await page.getByTestId("demo-expire-now").click();
    await expect(page.getByTestId("access-flash")).toHaveText("Credential expired.");
    await expect(page.getByTestId("demo-expired")).toBeVisible();

    await page.getByTestId("demo-next").click();
    await expect(page.getByTestId("demo-scene")).toContainText("Unknown app asks GitHub");
    await page.getByTestId("demo-unknown-app").click();
    await expect(page.getByTestId("access-flash")).toContainText("DENIED");
    await expect(page.getByTestId("access-flash")).toContainText("application not allowed");

    const audit = page.getByTestId("access-audit");
    await expect(audit).toContainText("APPROVED");
    await expect(audit).toContainText("EXPIRED");
    await expect(audit).toContainText("repository.delete");
    await expect(audit).toContainText("malicious-agent");
    await expect(audit).not.toContainText(DEMO_SECRET);

    await page.getByTestId("demo-next").click();
    await expect(page.getByTestId("demo-scene")).toContainText("Two minutes");
    // Hold the Done screen so a person can read the audit before the window closes.
    await page.waitForTimeout(8_000);
  } finally {
    await browser.close();
  }
});
