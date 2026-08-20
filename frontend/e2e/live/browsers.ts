import { existsSync } from "node:fs";
import { chromium, firefox, webkit, type Browser } from "@playwright/test";

const SLOWMO = Number(process.env.LIVE_SLOWMO ?? 280);

const APPS: Array<{
  name: string;
  kind: "chromium" | "firefox" | "webkit";
  path?: string;
  channel?: string;
}> = [
  {
    name: "Google Chrome",
    kind: "chromium",
    path: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  },
  {
    name: "Brave",
    kind: "chromium",
    path: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  },
  {
    name: "Opera",
    kind: "chromium",
    path: "/Applications/Opera.app/Contents/MacOS/Opera",
  },
  {
    name: "Microsoft Edge",
    kind: "chromium",
    path: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  },
  {
    name: "Firefox",
    kind: "firefox",
    path: "/Applications/Firefox.app/Contents/MacOS/firefox",
  },
];

export interface LiveBrowser {
  name: string;
  browser: Browser;
}

/**
 * Launch every desktop browser this Mac actually has.
 * Safari.app is not scriptable via Playwright; WebKit is the same engine.
 */
export async function launchInstalledBrowsers(): Promise<LiveBrowser[]> {
  const launched: LiveBrowser[] = [];
  for (const app of APPS) {
    if (app.path && !existsSync(app.path)) continue;
    try {
      const browser =
        app.kind === "firefox"
          ? await firefox.launch({
              headless: false,
              slowMo: SLOWMO,
              executablePath: app.path,
            })
          : await chromium.launch({
              headless: false,
              slowMo: SLOWMO,
              executablePath: app.path,
            });
      launched.push({ name: app.name, browser });
    } catch (error) {
      console.warn(`skip ${app.name}:`, error instanceof Error ? error.message : error);
    }
  }
  try {
    launched.push({
      name: "Safari (WebKit)",
      browser: await webkit.launch({ headless: false, slowMo: SLOWMO }),
    });
  } catch (error) {
    console.warn("skip Safari/WebKit:", error instanceof Error ? error.message : error);
  }
  return launched;
}

export async function closeAll(browsers: LiveBrowser[]): Promise<void> {
  await Promise.all(browsers.map((item) => item.browser.close().catch(() => undefined)));
}
