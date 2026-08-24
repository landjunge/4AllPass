import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, chromium } from "@playwright/test";
import { VAULT_PASSWORD, addEntryWithMouse } from "../live/actions.ts";
import { ensureLocalVault } from "./vault.ts";

const DIST = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../extension/dist/chromium",
);
const ORIGIN = process.env.E2E_BASE_URL ?? "http://127.0.0.1:8794";
const live = process.env.LIVE_GITHUB === "1";

test.skip(!live, "set LIVE_GITHUB=1 to hit github.com/login (not CI)");

function extensionWithGithubHost(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "4ap-ext-gh-"));
  cpSync(DIST, dir, { recursive: true });
  const manifestPath = path.join(dir, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    host_permissions?: string[];
  };
  manifest.host_permissions = [...(manifest.host_permissions ?? []), "https://github.com/*"];
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return dir;
}

test("fills github.com/login in one click and does not submit", async () => {
  const unpacked = extensionWithGithubHost();
  const context = await chromium.launchPersistentContext("", {
    headless: false,
    args: [
      `--disable-extensions-except=${unpacked}`,
      `--load-extension=${unpacked}`,
      "--enable-unsafe-extension-debugging",
    ],
  });
  try {
    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent("serviceworker");
    const extensionId = new URL(worker.url()).host;

    const page = await context.newPage();
    await ensureLocalVault(page, ORIGIN);
    await addEntryWithMouse(page, {
      title: "GitHub",
      username: "ada@example.com",
      password: "s3cret-github-42",
      url: "https://github.com",
    });

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.locator("#api").fill(ORIGIN);
    await popup.locator("#vault").fill(VAULT_PASSWORD);
    await popup.locator("#unlock-btn").click();
    await expect(popup.locator("#status")).toContainText("Unlocked", { timeout: 60_000 });

    const login = await context.newPage();
    await login.goto("https://github.com/login");
    await expect(login.locator("#login_field")).toBeVisible({ timeout: 60_000 });
    await expect(login.locator("#password")).toBeVisible();

    await login.bringToFront();
    await popup.bringToFront();
    await popup.locator("#fill").click();
    await expect(login.locator("#login_field")).toHaveValue("ada@example.com");
    await expect(login.locator("#password")).toHaveValue("s3cret-github-42");
    await expect(login).toHaveURL(/github\.com\/login/);
  } finally {
    await context.close();
  }
});
