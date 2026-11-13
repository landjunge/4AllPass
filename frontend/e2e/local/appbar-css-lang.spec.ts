import { expect, test } from "@playwright/test";
import { reachUnlockedLocalApp } from "../live/actions.ts";

/**
 * Targeted DOM acceptance for FAM-CORR-AP-CSS-LANG-v1 on the existing local
 * Playwright runtime (synthetic disposable vault, no product vault, no new deps).
 *
 * Proves what the fs/helper unit test cannot: the canonical appbar CSS is really
 * applied (computed + actual 44x44 targets), the sr helper text exists, keyboard
 * focus is visible, <html lang> follows DE/EN and survives reload with the stored
 * choice, and the nested VaultHeader is fully visible (right edge in viewport) at
 * 940/1360 after the vault is unlocked again.
 */
test("appbar CSS is applied and <html lang> follows DE/EN without vault clipping", async ({ page }) => {
  await page.goto("/");
  await reachUnlockedLocalApp(page);

  // 1) Canonical appbar CSS is really applied: actual 44x44 target size (not just css).
  const button = page.locator(".np-appbar-button").first();
  await expect(button).toBeVisible();
  await expect
    .poll(async () => button.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return `${Math.round(rect.width)}x${Math.round(rect.height)}`;
    }))
    .toBe("44x44");
  expect(await button.evaluate((el) => getComputedStyle(el).width)).toBe("44px");

  // 2) The sr helper text is the screen-reader carrier (visually hidden, in DOM).
  //    The version line may be display:none as the module intends — that is NOT an
  //    SR claim; the accessibility text lives in .np-appbar-sr.
  const sr = page.locator(".np-appbar-sr").first();
  await expect(sr).toHaveCount(1);
  expect(await sr.evaluate((el) => getComputedStyle(el).clipPath)).toContain("inset");
  expect(((await sr.textContent()) ?? "").length).toBeGreaterThan(0);
  const version = page.locator(".np-appbar-version").first();
  if (await version.count()) {
    // Module-intended non-visual version line; not advertised as SR-accessible.
    expect(await version.evaluate((el) => getComputedStyle(el).display)).toBe("none");
  }

  // 3) Keyboard focus is visible (targeted, not a full a11y suite).
  await button.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  const outline = await button.evaluate((el) => {
    const style = getComputedStyle(el);
    return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
  });
  expect(outline.style).not.toBe("none");
  expect(outline.width).toBeGreaterThanOrEqual(2);

  // 4) The DE/EN choice updates <html lang>.
  await page.getByTestId("language-en").click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.getByTestId("language-de").click();
  await expect(page.locator("html")).toHaveAttribute("lang", "de");

  // 5) Stored EN choice survives a reload: <html lang>=en after mount.
  await page.getByTestId("language-en").click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  // 6) After reload the vault may be locked — unlock the synthetic vault again,
  //    then require the nested VaultHeader explicitly visible (no if-count skip).
  await reachUnlockedLocalApp(page);
  const hero = page.locator(".vault-hero").first();
  await expect(hero).toBeVisible();

  for (const width of [940, 1360]) {
    await page.setViewportSize({ width, height: 780 });
    await expect(hero).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
    const box = await hero.boundingBox();
    expect(box, `vault-hero box at ${width}`).not.toBeNull();
    // Right edge stays inside the viewport; no clipping to zero height.
    expect(box!.x).toBeGreaterThanOrEqual(-1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
    expect(box!.height).toBeGreaterThan(0);
  }

  await page.setViewportSize({ width: 1360, height: 780 });
  await page.screenshot({ path: test.info().outputPath("appbar-1360.png") });
});
