import { expect, test } from "@playwright/test";
import {
  ACCOUNT_PASSWORD,
  ENTRIES,
  VAULT_PASSWORD,
  addEntryWithMouse,
  createVaultWithMouse,
  expectEntriesVisible,
  expectLocked,
  signInWithMouse,
  signUpWithMouse,
  unlockWithVaultPassword,
} from "./live/actions.ts";

/**
 * Mode B: two browser profiles, one FastAPI. Ciphertext on the server,
 * plaintext only after vault password on that profile.
 */
test("second profile unlocks the same vault; snapshot has no secrets", async ({ browser }) => {
  const home = await browser.newContext();
  const other = await browser.newContext();
  const homePage = await home.newPage();
  const otherPage = await other.newPage();

  const email = await signUpWithMouse(homePage);
  await createVaultWithMouse(homePage);
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

  await signInWithMouse(otherPage, email);
  await expectLocked(otherPage);
  await unlockWithVaultPassword(otherPage);
  await expectEntriesVisible(otherPage);

  await home.close();
  await other.close();
});
