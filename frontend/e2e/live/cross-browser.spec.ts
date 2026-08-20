import { expect, test } from "@playwright/test";
import {
  ACCOUNT_PASSWORD,
  ENTRIES,
  VAULT_PASSWORD,
  addEntryWithMouse,
  clickAndType,
  createVaultWithMouse,
  expectEntriesVisible,
  expectLocked,
  signInWithMouse,
  signUpWithMouse,
  unlockWithVaultPassword,
} from "./actions.ts";
import { closeAll, launchInstalledBrowsers, type LiveBrowser } from "./browsers.ts";

/**
 * Live, headed, real-browser suite. Watch the windows: this is how 4AllPass
 * "syncs" — the server stores ciphertext; each browser decrypts only after
 * the vault password (or recovery key) is typed there.
 *
 * Existing Chrome+virtual-authenticator tests stay in ../device-unlock.spec.ts.
 */
test.describe.configure({ mode: "serial", timeout: 8 * 60_000 });

test("passwords show in other browsers only after vault unlock", async () => {
  const browsers = await launchInstalledBrowsers();
  test.skip(browsers.length < 2, "need at least two local browsers (Chrome, Firefox, Brave, WebKit…)");

  const pages: Array<{ name: string; page: Awaited<ReturnType<LiveBrowser["browser"]["newPage"]>> }> =
    [];
  try {
    const home = await browsers[0]!.browser.newContext();
    const homePage = await home.newPage();
    pages.push({ name: browsers[0]!.name, page: homePage });

    const email = await signUpWithMouse(homePage);
    const recoveryKey = await createVaultWithMouse(homePage);
    for (const entry of ENTRIES) {
      await addEntryWithMouse(homePage, entry);
    }
    await expectEntriesVisible(homePage);

    const snapshot = await homePage.evaluate(async () => {
      const token = sessionStorage.getItem("4allpass.session");
      const deviceId = localStorage.getItem("4allpass.deviceId") ?? "";
      const headers = { Authorization: `Bearer ${token}`, "X-Device-Id": deviceId };
      const vaults = (await (await fetch("/api/v1/vaults", { headers })).json()) as Array<{
        vaultId: string;
      }>;
      return await (await fetch(`/api/v1/vaults/${vaults[0]?.vaultId}/snapshot`, { headers })).text();
    });
    for (const entry of ENTRIES) {
      expect(snapshot).not.toContain(entry.password);
      expect(snapshot).not.toContain(entry.username);
      expect(snapshot).not.toContain(entry.title);
    }
    expect(snapshot).not.toContain(VAULT_PASSWORD);
    expect(snapshot).not.toContain(ACCOUNT_PASSWORD);

    for (const extra of browsers.slice(1)) {
      const context = await extra.browser.newContext();
      const page = await context.newPage();
      pages.push({ name: extra.name, page });

      await signInWithMouse(page, email);
      await expectLocked(page);

      await page.getByTestId("master-password").fill("wrong-password-not-the-vault");
      await page.getByTestId("unlock-submit").click();
      await expect(page.getByTestId("error-banner")).toBeVisible();
      await expectLocked(page);

      await unlockWithVaultPassword(page);
      await expectEntriesVisible(page);
    }

    await homePage.getByTestId("new-entry").click();
    await clickAndType(homePage, homePage.getByTestId("entry-title"), "Forum");
    await clickAndType(homePage, homePage.getByTestId("entry-username"), "ada");
    await clickAndType(homePage, homePage.getByTestId("entry-password"), "s3cret-forum");
    await homePage.getByTestId("save-entry").click();
    await expect(homePage.getByRole("button", { name: /Forum/ })).toBeVisible();

    const other = pages[1]?.page;
    if (other) {
      await other.getByTestId("lock").click();
      await unlockWithVaultPassword(other);
      await expect(other.getByRole("button", { name: /Forum/ })).toBeVisible();
    }

    const last = pages.at(-1)?.page;
    if (last && recoveryKey) {
      await last.getByTestId("lock").click();
      await last.getByRole("button", { name: "Use the recovery key" }).click();
      await clickAndType(last, last.getByLabel("Recovery key"), recoveryKey);
      await last.getByTestId("unlock-submit").click();
      await expect(last.getByTestId("lock-state")).toHaveText("UNLOCKED");
      await expect(last.getByRole("button", { name: /GitHub/ })).toBeVisible();
    }
  } finally {
    await closeAll(browsers);
  }
});

test("keyboard-only create-account and vault setup in Chrome", async () => {
  const { chromium } = await import("@playwright/test");
  const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const browser = await chromium.launch({
    headless: false,
    slowMo: Number(process.env.LIVE_SLOWMO ?? 220),
    executablePath: chromePath,
  });
  const page = await browser.newPage();
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "Need an account?" }).click();
    await page.getByLabel("E-mail").click();
    await page.keyboard.type(`kb_${Date.now()}@example.com`, { delay: 30 });
    await page.keyboard.press("Tab");
    await page.keyboard.type(ACCOUNT_PASSWORD, { delay: 30 });
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("account-email")).toBeVisible();
    await page.getByLabel("Vault password").click();
    await page.keyboard.type(VAULT_PASSWORD, { delay: 25 });
    await page.keyboard.press("Tab");
    await page.keyboard.type(VAULT_PASSWORD, { delay: 25 });
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("recovery-key")).toBeVisible();
    await page.getByRole("checkbox").click();
    await page.getByTestId("dismiss-kit").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("lock-state")).toHaveText("UNLOCKED");
  } finally {
    await browser.close();
  }
});
