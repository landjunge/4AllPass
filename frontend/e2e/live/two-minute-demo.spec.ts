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
test("Access tab: machine access blocked without a protected executor", async () => {
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
    await expect(page.getByRole("status")).toContainText("Machine access is blocked");
    await expect(page.getByTestId("access-allow")).toHaveCount(0);
    await expect(page.getByTestId("access-security-status")).not.toContainText(DEMO_SECRET);

  } finally {
    await browser.close();
  }
});
