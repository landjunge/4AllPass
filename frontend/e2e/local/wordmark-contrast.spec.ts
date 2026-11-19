import { expect, test, type Page } from "@playwright/test";

/**
 * AP-WORDMARK-CONTRAST-v1.
 *
 * The app chrome is always dark (tokens.css: --bg / --bg-panel are dark greys;
 * brand/README.md: "App … hat eine feste dunkle Oberfläche und verwendet Dark").
 * The header therefore has to serve the dark-surface wordmark no matter what the
 * OS colour scheme says. This spec proves that in both schemes and checks the
 * WCAG contrast of the wordmark glyphs against the real computed header
 * background — a static asset check alone would not catch the regression.
 */

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function parseRgb(value: string): [number, number, number] {
  const match = value.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (!match) throw new Error(`unexpected colour: ${value}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

async function readWordmark(page: Page) {
  const img = page.locator('.brand img[alt="4AllPass"]').first();
  await expect(img).toBeVisible();
  const info = await img.evaluate((el) => {
    const image = el as HTMLImageElement;
    const rect = image.getBoundingClientRect();
    return {
      srcAttr: image.getAttribute("src"),
      currentSrc: image.currentSrc.replace(location.origin, ""),
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      renderedHeight: Math.round(rect.height),
      complete: image.complete,
    };
  });
  const headerBackground = await page.evaluate(() => {
    const header = document.querySelector("header");
    if (!header) throw new Error("header missing");
    return getComputedStyle(header).backgroundColor;
  });
  const svg = await (await fetch(new URL("/wordmark-dark.svg", page.url()).toString())).text();
  const fills = [...svg.matchAll(/fill="#([0-9a-fA-F]{6})"/g)].map((m) => `#${m[1]}`);
  return { info, headerBackground, fills };
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`OS colour scheme: ${scheme}`, () => {
    test.use({ colorScheme: scheme });

    test(`header wordmark keeps the dark-surface asset and readable contrast (${scheme})`, async ({ page }) => {
      const lightWordmarkRequests: string[] = [];
      page.on("request", (request) => {
        if (request.url().includes("/wordmark-light.svg")) lightWordmarkRequests.push(request.url());
      });

      await page.goto("/");
      const { info, headerBackground, fills } = await readWordmark(page);

      // 1) The fixed dark-surface asset is used, not the OS-dependent variant.
      expect(info.srcAttr).toBe("/wordmark-dark.svg");
      expect(info.currentSrc).toBe("/wordmark-dark.svg");
      expect(info.complete).toBe(true);
      expect(info.naturalWidth).toBeGreaterThan(0);
      expect(info.renderedHeight).toBeGreaterThan(0);
      expect(lightWordmarkRequests).toEqual([]);
      await expect(page.locator(".brand source")).toHaveCount(0);

      // 2) The real header background is dark …
      const background = parseRgb(headerBackground);
      expect(relativeLuminance(background)).toBeLessThan(0.2);

      // 3) … and every wordmark glyph colour meets WCAG AA on it.
      expect(fills.length).toBeGreaterThanOrEqual(2);
      expect(fills).toContain("#ffffff");
      for (const fill of fills) {
        const ratio = contrastRatio(hexToRgb(fill), background);
        expect(ratio, `${fill} on ${headerBackground}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  });
}
