/**
 * Real-browser P02 evidence: full offline app start from the last verified
 * encrypted snapshot cache (IndexedDB + revision pin), through the actual
 * AppShell/account/vault-list bootstrap. Synthetic local accounts and vaults
 * only; the throwaway local server stays loopback-only. API transport failures
 * are produced with Playwright route interception (the established pattern in
 * vault-desk-legacy-migration.spec.ts); one case uses a real service-worker
 * offline navigation. No production vault, no product data.
 */
import { expect, test, type Page } from "@playwright/test";
import {
  addEntryWithMouse,
  reachUnlockedLocalApp,
  unlockWithVaultPassword,
  VAULT_PASSWORD,
} from "../live/actions.ts";

const BOOTSTRAP_KEY = "4allpass.offline-bootstrap";
const TOKEN_KEY = "4allpass.session";
const ENTRY = {
  title: "Offline synthetic login",
  username: "offline@example.invalid",
  password: "synthetic-only",
};

test.use({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block" });

/** Every API call (incl. /api/v1/health) fails before an HTTP status exists. */
async function blockApi(page: Page): Promise<void> {
  await page.route("**/api/v1/**", (route) => route.abort("failed"));
}

async function readBootstrap(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  }, BOOTSTRAP_KEY);
}

/**
 * Online signup + vault + one committed entry, then lock and an online reload
 * so startup proves the account and writes the bound bootstrap metadata.
 */
async function seedOnlineVault(
  page: Page,
): Promise<{ vaultId: string; email: string; entryTitle: string }> {
  await page.goto("/");
  await reachUnlockedLocalApp(page);
  // The local app shares one silent account/vault across tests on this
  // server; keep entry titles unique so list assertions stay unambiguous.
  const entryTitle = `${ENTRY.title} ${Date.now().toString(36)}`;
  await addEntryWithMouse(page, { ...ENTRY, title: entryTitle });
  const vaultId = await page.evaluate(() => localStorage.getItem("4allpass.active-vault"));
  expect(vaultId, "synthetic local vault id").toMatch(/^[0-9a-f-]{36}$/i);
  await page.getByTestId("lock").click();
  await expect(page.getByTestId("lock-state")).toHaveText("LOCKED");
  // Online reload: startup proves the session and writes the bound bootstrap.
  // The local app uses the silent storage session (local@127.0.0.1), whose
  // email is not rendered in the header — the bound metadata is the anchor.
  await page.reload();
  await expect(page.getByTestId("master-password")).toBeVisible({ timeout: 60_000 });
  // The session restores before the vault list finishes loading; wait for the
  // bound metadata the online startup writes after listVaults resolves.
  await expect
    .poll(() => readBootstrap(page), { timeout: 30_000, message: "bound bootstrap written by the online startup" })
    .not.toBeNull();
  const bootstrap = await readBootstrap(page);
  const email = bootstrap!.email as string;
  expect(email.length).toBeGreaterThan(0);
  return { vaultId: vaultId!, email, entryTitle };
}

test("offline cold start: bound metadata, cold reload, unlock from encrypted cache, lock/reopen", async ({ page }, testInfo) => {
  const { vaultId, email, entryTitle } = await seedOnlineVault(page);

  const bootstrap = await readBootstrap(page);
  expect(bootstrap, "bound bootstrap written by the online startup").not.toBeNull();
  expect(Object.keys(bootstrap!).sort()).toEqual([
    "email", "sessionFingerprint", "storageOrigin", "vaults", "version",
  ]);
  expect(bootstrap!.version).toBe(2);
  expect(bootstrap!.email).toBe(email);
  expect(bootstrap!.sessionFingerprint).toMatch(/^[0-9a-f]{64}$/);
  expect(bootstrap!.storageOrigin).toBeNull();
  const vaults = bootstrap!.vaults as Array<Record<string, unknown>>;
  expect(vaults.length).toBeGreaterThanOrEqual(1);
  expect(vaults.some((row) => row.vaultId === vaultId)).toBe(true);
  expect(Object.keys(vaults[0]).sort()).toEqual([
    "activeRevision", "activeVaultKeyVersion", "createdAt", "cryptoProtocolVersion", "vaultId",
  ]);
  const raw = await page.evaluate((key) => localStorage.getItem(key), BOOTSTRAP_KEY);
  const token = await page.evaluate((key) => sessionStorage.getItem(key), TOKEN_KEY);
  expect(token, "session token present").toBeTruthy();
  expect(raw!.includes(token!), "no raw token in metadata").toBe(false);

  // Cold reload with the network down: identity + vault list come from the
  // bound metadata, the vault stays locked until the master password.
  await blockApi(page);
  await page.reload();
  await expect(page.getByTestId("master-password")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("lock-state")).toHaveText("LOCKED");
  expect((await readBootstrap(page))!.email, "same bound account after cold reload").toBe(email);
  await page.screenshot({ path: testInfo.outputPath("offline-locked.png") });

  // Unlock: GET /snapshot fails as transport, the verified IndexedDB wire +
  // revision pin open the vault. No server answer, no write.
  await unlockWithVaultPassword(page);
  await expect(page.getByRole("button", { name: new RegExp(entryTitle) })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("offline-unlocked.png") });

  // An offline write attempt must surface an error, never a success notice.
  await page.getByTestId("new-entry").click();
  await expect(page.getByTestId("entry-title")).toBeVisible();
  await page.getByTestId("entry-title").fill("Must not commit offline");
  await page.getByTestId("entry-username").fill("nope@example.invalid");
  await page.getByTestId("entry-password").fill("synthetic-only");
  await page.getByTestId("save-entry").click();
  await expect(page.getByTestId("error-banner")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("lock-state")).toHaveText("UNLOCKED");
  await expect(page.getByRole("button", { name: /Must not commit offline/ })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("offline-write-refused.png") });

  // Lock and reopen offline again: stable, still from the encrypted cache.
  await page.getByTestId("lock").click();
  await expect(page.getByTestId("lock-state")).toHaveText("LOCKED");
  await unlockWithVaultPassword(page);
  await expect(page.getByRole("button", { name: new RegExp(entryTitle) })).toBeVisible();
});

test("tampered bootstrap (extra top-level field) fails closed and is removed", async ({ page }, testInfo) => {
  const { email } = await seedOnlineVault(page);
  await page.evaluate((key) => {
    const record = JSON.parse(localStorage.getItem(key)!);
    record.token = "smuggled-token";
    localStorage.setItem(key, JSON.stringify(record));
  }, BOOTSTRAP_KEY);
  await blockApi(page);
  await page.reload();
  await expect(page.getByTestId("auth-submit")).toBeVisible({ timeout: 60_000 });
  expect(await readBootstrap(page), "tampered cache removed").toBeNull();
  expect(email.length).toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath("tampered-fail-closed.png") });
});

test("tampered vault summary (smuggled key field) fails closed and is removed", async ({ page }) => {
  await seedOnlineVault(page);
  await page.evaluate((key) => {
    const record = JSON.parse(localStorage.getItem(key)!);
    record.vaults[0].vaultKey = "AA==";
    localStorage.setItem(key, JSON.stringify(record));
  }, BOOTSTRAP_KEY);
  await blockApi(page);
  await page.reload();
  await expect(page.getByTestId("auth-submit")).toBeVisible({ timeout: 60_000 });
  expect(await readBootstrap(page)).toBeNull();
});

test("a different bearer token never adopts the cached account", async ({ page }) => {
  await seedOnlineVault(page);
  await page.evaluate((key) => sessionStorage.setItem(key, "a-different-bearer-token"), TOKEN_KEY);
  await blockApi(page);
  await page.reload();
  await expect(page.getByTestId("auth-submit")).toBeVisible({ timeout: 60_000 });
  expect(await readBootstrap(page), "foreign-binding cache removed").toBeNull();
});

test("missing snapshot cache: metadata loads, unlock fails closed", async ({ page }, testInfo) => {
  const { vaultId, email } = await seedOnlineVault(page);
  await page.evaluate(async (id) => {
    const open = indexedDB.open("4allpass-snapshot-cache", 1);
    await new Promise<void>((resolve, reject) => {
      open.onupgradeneeded = () => {
        if (!open.result.objectStoreNames.contains("wire")) open.result.createObjectStore("wire");
      };
      open.onsuccess = () => resolve();
      open.onerror = () => reject(open.error);
    });
    const db = open.result;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("wire", "readwrite");
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error("delete aborted"));
      tx.objectStore("wire").delete(id);
    });
    db.close();
  }, vaultId);
  await blockApi(page);
  await page.reload();
  await expect(page.getByTestId("master-password")).toBeVisible({ timeout: 60_000 });
  expect((await readBootstrap(page))!.email).toBe(email);
  await page.getByTestId("master-password").fill(VAULT_PASSWORD);
  await page.getByTestId("unlock-submit").click();
  await expect(page.getByTestId("error-banner")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("lock-state")).toHaveText("LOCKED");
  await page.screenshot({ path: testInfo.outputPath("missing-cache-fail-closed.png") });
});

test("aborted IndexedDB read transaction fails closed", async ({ page }, testInfo) => {
  await seedOnlineVault(page);
  // Abort every wire-store read after its request succeeded: the store must
  // reject (transaction-completion guarantee), never return a partial value.
  await page.addInitScript(() => {
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...args: unknown[]) {
      const tx = (original as (...a: unknown[]) => IDBTransaction).apply(this, args);
      if (this.name === "4allpass-snapshot-cache") {
        const objectStore = tx.objectStore.bind(tx);
        tx.objectStore = function (...storeArgs: unknown[]) {
          const store = (objectStore as (...a: unknown[]) => IDBObjectStore).apply(tx, storeArgs);
          const get = store.get.bind(store);
          store.get = function (...getArgs: unknown[]) {
            const request = (get as (...a: unknown[]) => IDBRequest).apply(store, getArgs);
            request.addEventListener("success", () => tx.abort(), { once: true });
            return request;
          };
          return store;
        };
      }
      return tx;
    };
  });
  await blockApi(page);
  await page.reload();
  await expect(page.getByTestId("master-password")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("master-password").fill(VAULT_PASSWORD);
  await page.getByTestId("unlock-submit").click();
  await expect(page.getByTestId("error-banner")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("lock-state")).toHaveText("LOCKED");
  await page.screenshot({ path: testInfo.outputPath("idb-abort-fail-closed.png") });
});

test.describe("service worker shell", () => {
  test.use({ serviceWorkers: "allow" });

  test("fully offline cold start: SW serves the shell, cache unlocks the vault", async ({ page, context }, testInfo) => {
    const { email, entryTitle } = await seedOnlineVault(page);
    await expect
      .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker?.controller)), { timeout: 30_000 })
      .toBe(true);
    await context.setOffline(true);
    try {
      await page.reload();
      await expect(page.getByTestId("master-password")).toBeVisible({ timeout: 60_000 });
      expect((await readBootstrap(page))!.email).toBe(email);
      await unlockWithVaultPassword(page);
      await expect(page.getByRole("button", { name: new RegExp(entryTitle) })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("sw-offline-unlocked.png") });
    } finally {
      await context.setOffline(false);
    }
  });
});
