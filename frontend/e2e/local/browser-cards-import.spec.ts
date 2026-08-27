import { expect, test, type Page } from "@playwright/test";
import { clickAndType, VAULT_PASSWORD } from "../live/actions.ts";

const SECRET = "hunter2-browser-import-must-not-appear";

async function stubDesktopShell(page: Page): Promise<void> {
  await page.addInitScript((secret: string) => {
    const cards = [
      {
        id: "chrome",
        name: "Google Chrome",
        kind: "chromium",
        installed: true,
        profiles: [
          { id: "Default", name: "Person 1", dirName: "Default" },
          { id: "Profile 1", name: "Arbeit", dirName: "Profile 1" },
        ],
      },
      {
        id: "firefox",
        name: "Firefox",
        kind: "firefox",
        installed: true,
        profiles: [{ id: "default-release", name: "default-release", dirName: "Profiles/abcd" }],
      },
    ];
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {
        invoke: async (cmd: string, args?: { browserId?: string; profileId?: string }) => {
          if (cmd === "list_browser_profiles") return cards;
          if (cmd === "import_browser_logins") {
            const browserId = args?.browserId ?? "";
            const profileId = args?.profileId ?? "";
            if (browserId === "safari") throw new Error("Safari import is not this slice");
            const host = browserId === "firefox" ? "addons.mozilla.org" : "mail.example";
            return [
              {
                url: `https://${host}/`,
                username: profileId === "Profile 1" ? "arbeit" : "ada",
                password: secret,
                title: host,
                source: `${browserId}:${profileId}`,
              },
            ];
          }
          throw new Error(`unmocked ${cmd}`);
        },
        transformCallback: () => 0,
        unregisterCallback: () => undefined,
        convertFileSrc: (url: string) => url,
      },
    });
    // Desktop shell talks to 127.0.0.1:8788. This e2e sidecar is the Playwright
    // origin, not a pre-bound 8788. Keep the Tauri stub for cards; send API
    // calls to the running local app.
    const origFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const raw =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (raw.startsWith("http://127.0.0.1:8788")) {
        const next = raw.replace("http://127.0.0.1:8788", location.origin);
        if (typeof input === "string" || input instanceof URL) return origFetch(next, init);
        return origFetch(new Request(next, input), init);
      }
      return origFetch(input, init);
    };
  }, SECRET);
}

test("browser-card import review lists host and username, never the password", async ({ page }) => {
  await stubDesktopShell(page);
  await page.goto("/");
  await clickAndType(page, page.getByTestId("vault-password"), VAULT_PASSWORD);
  await clickAndType(page, page.getByTestId("vault-password-repeat"), VAULT_PASSWORD);
  await page.getByTestId("create-vault").click();
  await page.getByTestId("confirm-kit-stored").click();
  await page.getByTestId("dismiss-kit").click();
  await expect(page.getByTestId("lock-state")).toHaveText("UNLOCKED");

  const cards = page.getByTestId("browser-cards");
  await expect(cards).toBeVisible();
  await expect(cards).toContainText("Welche Browser sollen mit 4AllPass arbeiten?");
  await expect(page.getByTestId("browser-sync-explainer")).not.toContainText("Grün = an");
  await expect(page.getByTestId("fetch-browser-passwords")).toContainText("Passwörter importieren");
  await expect(page.getByTestId("browser-card-chrome")).toBeVisible();
  await expect(page.getByTestId("browser-card-firefox")).toBeVisible();

  await page.getByTestId("browser-card-chrome").locator(".browser-card-hit").click();
  await page.getByTestId("browser-profile-chrome:Default").check();
  await page.getByTestId("browser-profile-chrome:Profile 1").check();
  await page.getByTestId("fetch-browser-passwords").click();

  const review = page.getByTestId("import-review");
  await expect(review).toBeVisible();
  await expect(review).toContainText("ada");
  await expect(review).toContainText("arbeit");
  await expect(review).toContainText("mail.example");
  await expect(review).not.toContainText(SECRET);

  await page.getByTestId("confirm-import").click();
  await expect(page.getByRole("button", { name: /mail\.example/ })).toHaveCount(2);
  await expect(page.locator("body")).not.toContainText(SECRET);
});
