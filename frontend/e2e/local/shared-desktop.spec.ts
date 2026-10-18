import { expect, test } from "@playwright/test";
import { reachUnlockedLocalApp } from "../live/actions.ts";

/** Disposable local runtime only (existing local Playwright configuration). */
test("shared roles preserve AP4, narrow human vault and blocked machine access", async ({ page }) => {
  await page.goto("/");
  await reachUnlockedLocalApp(page);
  await expect(page.locator(".brand img")).toHaveAttribute("src", "/logo.png");
  await expect(page.locator(".app")).toHaveClass(/np-ui/);
  expect(await page.locator(".app").evaluate(el => getComputedStyle(el).fontSize)).toBe("14px");
  await page.getByTestId("language-en").click();
  await page.getByTestId("tab-access").click();
  await expect(page.getByRole("status")).toContainText("Machine access is blocked");
  await expect(page.getByTestId("access-allow")).toHaveCount(0);
  await page.getByTestId("language-de").click();
  await expect(page.getByRole("status")).toContainText("Maschinenzugriff ist gesperrt");
  await page.setViewportSize({ width: 640, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(644);
  await page.getByTestId("tab-entries").click();
  expect((await page.locator(".vault-desk").evaluate(el => getComputedStyle(el).gridTemplateColumns)).split(" ")).toHaveLength(1);
  await page.setViewportSize({ width: 1440, height: 900 });
  const create = page.getByTestId("new-entry");
  await create.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  expect(await create.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe("none");
  expect(await create.evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(40);
});
