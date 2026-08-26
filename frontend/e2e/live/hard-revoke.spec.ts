import { expect, test } from "@playwright/test";
import {
  ACCOUNT_PASSWORD,
  ENTRIES,
  VAULT_PASSWORD,
  addEntryWithMouse,
  createVaultWithMouse,
  expectLocked,
  signInWithMouse,
  signUpWithMouse,
  unlockWithVaultPassword,
} from "./actions.ts";
import { closeAll, launchInstalledBrowsers } from "./browsers.ts";

test.describe.configure({ mode: "serial", timeout: 8 * 60_000 });

/**
 * Hard revoke is VK++. A holder of VK₁ cannot open snapshot N+1.
 * The account master password still unwraps the new master envelope (VK₂).
 * This is not “the other browser is locked out forever.”
 */
test("hard revoke: other browser cannot use the old vault key", async () => {
  const browsers = await launchInstalledBrowsers();
  test.skip(browsers.length < 2, "need two local browsers");

  const a = await browsers[0]!.browser.newContext();
  const b = await browsers[1]!.browser.newContext();
  const pageA = await a.newPage();
  const pageB = await b.newPage();
  try {
    const email = await signUpWithMouse(pageA);
    const recoveryKey = await createVaultWithMouse(pageA);
    await addEntryWithMouse(pageA, ENTRIES[0]);
    await expect(pageA.getByRole("button", { name: /GitHub/ })).toBeVisible();

    await signInWithMouse(pageB, email);
    await expectLocked(pageB);
    await unlockWithVaultPassword(pageB);
    await expect(pageB.getByRole("button", { name: /GitHub/ })).toBeVisible();

    const victimId = await pageB.evaluate(() => localStorage.getItem("4allpass.deviceId"));
    expect(victimId).toBeTruthy();
    const registered = await pageB.evaluate(async () => {
      const token = sessionStorage.getItem("4allpass.session");
      const deviceId = localStorage.getItem("4allpass.deviceId") ?? "";
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        "X-Device-Id": deviceId,
        "Content-Type": "application/json",
      };
      const vaults = (await (await fetch("/api/v1/vaults", { headers })).json()) as Array<{
        vaultId: string;
      }>;
      const response = await fetch(`/api/v1/vaults/${vaults[0]?.vaultId}/devices`, {
        method: "POST",
        headers,
        body: JSON.stringify({ deviceId, label: "live-victim", platform: "test" }),
      });
      return response.ok;
    });
    expect(registered).toBe(true);

    await pageA.getByTestId("tab-entries").click();
    await pageA.getByTestId("tab-settings").click();
    await pageA.getByTestId("tab-devices").click();
    await expect(pageA.getByText(victimId!)).toBeVisible();
    await pageA.getByTestId(`rotate-key-${victimId}`).click();
    await pageA.getByTestId("rotate-vault-password").fill(VAULT_PASSWORD);
    await pageA.getByTestId("rotate-recovery-key").fill(recoveryKey);
    await pageA.getByTestId("confirm-rotate").click();
    await expect(pageA.getByTestId("revision")).toContainText("vault key v2");
    await pageA.getByTestId("tab-entries").click();
    await expect(pageA.getByRole("button", { name: /GitHub/ })).toBeVisible();

    // Rotation DELETEs the victim device and drops its sessions. Re-auth,
    // then the vault password unwraps VK₂ (this is not a permanent lockout).
    await pageB.getByRole("button", { name: "Sign out" }).click();
    await signInWithMouse(pageB, email);
    await unlockWithVaultPassword(pageB);
    await expect(pageB.getByTestId("lock-state")).toHaveText("UNLOCKED");
    await expect(pageB.getByTestId("revision")).toContainText("vault key v2");
    await expect(pageB.getByRole("button", { name: /GitHub/ })).toBeVisible();

    const snapshot = await pageA.evaluate(async () => {
      const token = sessionStorage.getItem("4allpass.session");
      const deviceId = localStorage.getItem("4allpass.deviceId") ?? "";
      const headers = { Authorization: `Bearer ${token}`, "X-Device-Id": deviceId };
      const vaults = (await (await fetch("/api/v1/vaults", { headers })).json()) as Array<{
        vaultId: string;
      }>;
      return await (await fetch(`/api/v1/vaults/${vaults[0]?.vaultId}/snapshot`, { headers })).text();
    });
    expect(snapshot).not.toContain(ENTRIES[0].password);
    expect(snapshot).not.toContain(ACCOUNT_PASSWORD);
    expect(snapshot).not.toContain(VAULT_PASSWORD);
  } finally {
    await a.close();
    await b.close();
    await closeAll(browsers);
  }
});
