import { expect, test, type Page } from "@playwright/test";
import { addVirtualAuthenticator } from "./virtual-authenticator.ts";

const MASTER_PASSWORD = "korrektes-pferd-batterie-heftklammer";
const ENTRY = { title: "GitHub", username: "ada@example.com", password: "s3cret-entry-value-42" };

function uniqueEmail(): string {
  return `e2e_${Date.now()}_${Math.floor(Math.random() * 10_000)}@example.com`;
}

async function signUp(page: Page): Promise<string> {
  const email = uniqueEmail();
  await page.goto("/");
  await page.getByRole("button", { name: "Need an account?" }).click();
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Account password").fill("account-password-1234");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByTestId("account-email")).toHaveText(email);
  return email;
}

async function createVault(page: Page): Promise<string> {
  await page.getByLabel("Vault password").fill(MASTER_PASSWORD);
  await page.getByLabel("Repeat").fill(MASTER_PASSWORD);
  await page.getByRole("button", { name: "Create vault" }).click();
  const recoveryKey = await page.getByTestId("recovery-key").textContent();
  // Crockford Base32 over the 32-byte key plus its 2-byte checksum.
  expect(recoveryKey?.replace(/-/g, "")).toHaveLength(55);
  await page.getByRole("checkbox").check();
  await page.getByTestId("dismiss-kit").click();
  await expect(page.getByTestId("lock-state")).toHaveText("UNLOCKED");
  return recoveryKey ?? "";
}

async function addEntry(page: Page): Promise<void> {
  await page.getByTestId("new-entry").click();
  await page.getByTestId("entry-title").fill(ENTRY.title);
  await page.getByTestId("entry-username").fill(ENTRY.username);
  await page.getByTestId("entry-password").fill(ENTRY.password);
  await page.getByTestId("save-entry").click();
  await expect(page.getByTestId("revision")).toContainText("revision 2");
  await expect(page.getByRole("button", { name: new RegExp(ENTRY.title) })).toBeVisible();
}

async function enableDeviceUnlock(page: Page): Promise<string> {
  await page.getByTestId("tab-devices").click();
  await page.getByTestId("enable-biometrics").click();
  const enabled = page.getByTestId("enabled-mechanism");
  const conflict = page.getByTestId("error-banner").filter({ hasText: "revision conflict" });
  await expect(enabled.or(conflict)).toBeVisible();
  if (await conflict.isVisible()) {
    // Enrol is a snapshot CAS. A profile that unlocked just before another
    // device committed must reload, then retry once.
    await conflict.getByRole("button", { name: "Dismiss" }).click();
    await page.getByTestId("lock").click();
    await page.getByTestId("master-password").fill(MASTER_PASSWORD);
    await page.getByTestId("unlock-submit").click();
    await expect(page.getByTestId("lock-state")).toHaveText("UNLOCKED");
    await page.getByTestId("tab-devices").click();
    await page.getByTestId("enable-biometrics").click();
  }
  await expect(enabled).toBeVisible();
  return (await enabled.textContent()) ?? "";
}

test.describe("device unlock over the WebAuthn fallback hierarchy", () => {
  for (const scenario of [
    { name: "PRF", hasPrf: true, hasLargeBlob: true, expected: "WebAuthn PRF (rank 1)" },
    {
      name: "largeBlob fallback",
      hasPrf: false,
      hasLargeBlob: true,
      expected: "WebAuthn largeBlob (rank 2)",
    },
    {
      name: "UV-gated local store fallback",
      hasPrf: false,
      hasLargeBlob: false,
      expected: "UV-gated local store (rank 3)",
    },
  ]) {
    test(`provisions and unlocks with ${scenario.name}`, async ({ page, context }) => {
      await page.goto("/");
      await addVirtualAuthenticator(context, page, {
        hasPrf: scenario.hasPrf,
        hasLargeBlob: scenario.hasLargeBlob,
      });

      await signUp(page);
      await createVault(page);
      await addEntry(page);

      expect(await enableDeviceUnlock(page)).toContain(scenario.expected);
      await expect(page.getByTestId("device-unlock-state")).toBeVisible();
      if (scenario.hasPrf) {
        await expect(page.getByTestId("rank3-warning")).toHaveCount(0);
      } else if (!scenario.hasLargeBlob) {
        await expect(page.getByTestId("rank3-warning")).toBeVisible();
      }
      await expect(page.getByTestId("revision")).toContainText("revision 3");

      // Lock: the Vault Key is zeroized and nothing is decrypted any more.
      await page.getByTestId("lock").click();
      await expect(page.getByTestId("lock-state")).toHaveText("LOCKED");
      await expect(page.getByRole("button", { name: new RegExp(ENTRY.title) })).toHaveCount(0);

      // Unlock without the master password: assertion → DWK → DK → VK.
      await page.getByTestId("unlock-biometrics").click();
      await expect(page.getByTestId("lock-state")).toHaveText("UNLOCKED");
      await expect(page.getByRole("button", { name: new RegExp(ENTRY.title) })).toBeVisible();

      // The master password still works afterwards.
      await page.getByTestId("lock").click();
      await page.getByTestId("master-password").fill(MASTER_PASSWORD);
      await page.getByTestId("unlock-submit").click();
      await expect(page.getByTestId("lock-state")).toHaveText("UNLOCKED");
      await expect(page.getByRole("button", { name: new RegExp(ENTRY.title) })).toBeVisible();
    });
  }

  test("the server never receives entry plaintext", async ({ page, context }) => {
    await page.goto("/");
    await addVirtualAuthenticator(context, page, { hasPrf: true, hasLargeBlob: true });
    await signUp(page);
    await createVault(page);
    await addEntry(page);
    await enableDeviceUnlock(page);

    const snapshot = await page.evaluate(async () => {
      const token = sessionStorage.getItem("4allpass.session");
      const deviceId = localStorage.getItem("4allpass.deviceId") ?? "";
      const authorized = { headers: { Authorization: `Bearer ${token}`, "X-Device-Id": deviceId } };
      const vaults = (await (await fetch("/api/v1/vaults", authorized)).json()) as Array<{
        vaultId: string;
      }>;
      const response = await fetch(`/api/v1/vaults/${vaults[0]?.vaultId}/snapshot`, authorized);
      return await response.text();
    });

    expect(snapshot).not.toContain(ENTRY.password);
    expect(snapshot).not.toContain(ENTRY.username);
    expect(snapshot).not.toContain(ENTRY.title);
    expect(snapshot).not.toContain(MASTER_PASSWORD);
    // What it does contain: one master, one recovery, and one device envelope.
    expect(snapshot).toContain('"type":"master"');
    expect(snapshot).toContain('"type":"recovery"');
    expect(snapshot).toContain('"type":"device"');
  });

  test("a device revoked elsewhere cannot unlock, even with its local record intact", async ({
    browser,
  }) => {
    // Two browser profiles of one account. The first keeps its WebAuthn
    // credential and its local unlock record; the second revokes it.
    const first = await browser.newContext();
    const firstPage = await first.newPage();
    await firstPage.goto("/");
    await addVirtualAuthenticator(first, firstPage, { hasPrf: true, hasLargeBlob: true });
    const email = await signUp(firstPage);
    await createVault(firstPage);
    await addEntry(firstPage);
    await firstPage.getByTestId("lock").click();
    await firstPage.getByTestId("master-password").fill(MASTER_PASSWORD);
    await firstPage.getByTestId("unlock-submit").click();
    await expect(firstPage.getByTestId("lock-state")).toHaveText("UNLOCKED");
    await enableDeviceUnlock(firstPage);

    const second = await browser.newContext();
    const secondPage = await second.newPage();
    await secondPage.goto("/");
    await secondPage.getByLabel("E-mail").fill(email);
    await secondPage.getByLabel("Account password").fill("account-password-1234");
    await secondPage.getByRole("button", { name: "Sign in", exact: true }).click();
    await secondPage.getByTestId("master-password").fill(MASTER_PASSWORD);
    await secondPage.getByTestId("unlock-submit").click();
    await expect(secondPage.getByTestId("lock-state")).toHaveText("UNLOCKED");
    await secondPage.getByTestId("tab-devices").click();
    await secondPage.getByRole("button", { name: "Remove from sync" }).click();
    await expect(secondPage.getByTestId("notice-banner")).toBeVisible();

    // DELETE also drops sessions bound to that device id. Sign in again, then
    // device unlock must fail: the envelope is gone. Master still works.
    await firstPage.getByRole("button", { name: "Sign out" }).click();
    await firstPage.getByLabel("E-mail").fill(email);
    await firstPage.getByLabel("Account password").fill("account-password-1234");
    await firstPage.getByRole("button", { name: "Sign in", exact: true }).click();
    await firstPage.getByTestId("unlock-biometrics").click();
    await expect(firstPage.getByTestId("error-banner")).toBeVisible();
    await expect(firstPage.getByTestId("lock-state")).toHaveText("LOCKED");

    await firstPage.getByTestId("master-password").fill(MASTER_PASSWORD);
    await firstPage.getByTestId("unlock-submit").click();
    await expect(firstPage.getByTestId("lock-state")).toHaveText("UNLOCKED");

    await first.close();
    await second.close();
  });

  test("hard revoke rotates the vault key: victim device unlock fails, master still works", async ({
    browser,
  }) => {
    const attacker = await browser.newContext();
    const attackerPage = await attacker.newPage();
    await attackerPage.goto("/");
    await addVirtualAuthenticator(attacker, attackerPage, { hasPrf: true, hasLargeBlob: true });
    const email = await signUp(attackerPage);
    const recoveryKey = await createVault(attackerPage);
    await addEntry(attackerPage);
    await enableDeviceUnlock(attackerPage);

    const victim = await browser.newContext();
    const victimPage = await victim.newPage();
    await victimPage.goto("/");
    await addVirtualAuthenticator(victim, victimPage, { hasPrf: true, hasLargeBlob: true });
    await victimPage.getByLabel("E-mail").fill(email);
    await victimPage.getByLabel("Account password").fill("account-password-1234");
    await victimPage.getByRole("button", { name: "Sign in", exact: true }).click();
    await victimPage.getByTestId("master-password").fill(MASTER_PASSWORD);
    await victimPage.getByTestId("unlock-submit").click();
    await expect(victimPage.getByTestId("lock-state")).toHaveText("UNLOCKED");
    await expect(victimPage.getByRole("button", { name: new RegExp(ENTRY.title) })).toBeVisible();
    // Enrol writes a snapshot. Reload so expectedRevision matches the
    // attacker's device envelope (CAS 409 otherwise).
    await victimPage.getByTestId("lock").click();
    await victimPage.getByTestId("master-password").fill(MASTER_PASSWORD);
    await victimPage.getByTestId("unlock-submit").click();
    await expect(victimPage.getByTestId("lock-state")).toHaveText("UNLOCKED");
    expect(await enableDeviceUnlock(victimPage)).toContain("WebAuthn");
    const victimId = await victimPage.evaluate(() => localStorage.getItem("4allpass.deviceId"));
    expect(victimId).toBeTruthy();

    // Victim's enrol committed N+1. Attacker must load that snapshot or CAS 409s.
    await attackerPage.getByTestId("lock").click();
    await attackerPage.getByTestId("master-password").fill(MASTER_PASSWORD);
    await attackerPage.getByTestId("unlock-submit").click();
    await expect(attackerPage.getByTestId("lock-state")).toHaveText("UNLOCKED");

    await attackerPage.getByTestId("tab-devices").click();
    await expect(attackerPage.getByText(victimId!)).toBeVisible();
    await attackerPage.getByTestId(`rotate-key-${victimId}`).click();
    await attackerPage.getByTestId("rotate-vault-password").fill(MASTER_PASSWORD);
    await attackerPage.getByTestId("rotate-recovery-key").fill(recoveryKey);
    await attackerPage.getByTestId("confirm-rotate").click();
    await expect(attackerPage.getByTestId("lock-state")).toHaveText("UNLOCKED");
    await expect(attackerPage.getByTestId("revision")).toContainText("vault key v2");
    await attackerPage.getByTestId("tab-entries").click();
    await expect(attackerPage.getByRole("button", { name: new RegExp(ENTRY.title) })).toBeVisible();

    // Rotation DELETEs the victim device and drops its sessions. Re-auth, then
    // device unlock must fail; the vault password unwraps VK₂.
    await victimPage.getByRole("button", { name: "Sign out" }).click();
    await victimPage.getByLabel("E-mail").fill(email);
    await victimPage.getByLabel("Account password").fill("account-password-1234");
    await victimPage.getByRole("button", { name: "Sign in", exact: true }).click();
    await victimPage.getByTestId("unlock-biometrics").click();
    await expect(victimPage.getByTestId("error-banner")).toBeVisible();
    await expect(victimPage.getByTestId("lock-state")).toHaveText("LOCKED");

    await victimPage.getByTestId("master-password").fill(MASTER_PASSWORD);
    await victimPage.getByTestId("unlock-submit").click();
    await expect(victimPage.getByTestId("lock-state")).toHaveText("UNLOCKED");
    await expect(victimPage.getByTestId("revision")).toContainText("vault key v2");
    await expect(victimPage.getByRole("button", { name: new RegExp(ENTRY.title) })).toBeVisible();

    await attacker.close();
    await victim.close();
  });

  test("a wrong master password does not unlock", async ({ page, context }) => {
    await page.goto("/");
    await addVirtualAuthenticator(context, page, { hasPrf: true, hasLargeBlob: false });
    await signUp(page);
    await createVault(page);
    await page.getByTestId("lock").click();
    await page.getByTestId("master-password").fill("definitely-not-the-master-password");
    await page.getByTestId("unlock-submit").click();
    await expect(page.getByTestId("error-banner")).toBeVisible();
    await expect(page.getByTestId("lock-state")).toHaveText("LOCKED");
  });
});
