/**
 * Real-browser AP286 evidence: synthetic manifestless vault served to the
 * throwaway local app; no production vault, no product data.
 *
 * Covers DE/EN banner, confirm, decline, UNKNOWN across reload (no further
 * POST), focus and lock effect. Playwright route interception is the existing
 * test infrastructure; the local server remains loopback-only.
 */
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ARGON2ID_PROFILES,
  deriveMasterKey,
  encodeVaultSnapshot,
  encryptEntry,
  generateSalt,
  generateVaultKey,
  kdfParamsFrom,
  wrapVaultKey,
  zeroize,
} from "@4allpass/crypto";
import { emptyDraft, encodeEntryPlaintext, type VaultEntry } from "../../src/modules/entries/index.ts";
import { reachUnlockedLocalApp, VAULT_PASSWORD } from "../live/actions.ts";

const OUT = process.env.AP286_BROWSER_DIR
  ?? join(process.env.HOME ?? ".", ".local/state/family-design-20261112/ap286-browser-20261113-v1");
mkdirSync(OUT, { recursive: true, mode: 0o700 });

test.use({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block" });

function fakeLegacyWire(vaultId: string) {
  const profile = ARGON2ID_PROFILES["standard"];
  const vaultKey = generateVaultKey();
  const salt = generateSalt(16);
  const masterKey = deriveMasterKey(VAULT_PASSWORD, salt, profile);
  try {
    const masterEnvelope = wrapVaultKey({
      vaultKey,
      wrappingKey: masterKey,
      vaultId,
      type: "master",
      vaultKeyVersion: 1,
      kdf: kdfParamsFrom(profile, salt),
    });
    const item: VaultEntry = {
      ...emptyDraft(),
      id: "legacy_browser_1",
      title: "Synthetic legacy login",
      username: "synthetic@example.invalid",
      password: "synthetic-only",
      updatedAt: "2026-11-13T00:00:00Z",
    };
    const plaintext = encodeEntryPlaintext(item);
    const entry = encryptEntry({
      vaultKey,
      vaultId,
      entryId: item.id,
      vaultKeyVersion: 1,
      schemaVersion: 1,
      plaintext,
    });
    zeroize(plaintext);
    return encodeVaultSnapshot({
      vaultId,
      revision: 1,
      vaultKeyVersion: 1,
      cryptoProtocolVersion: 1,
      entries: [entry],
      envelopes: [masterEnvelope],
    });
  } finally {
    zeroize(masterKey, vaultKey);
  }
}

function evidence(name: string, value: Record<string, unknown>): void {
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify(value, null, 2));
}

function countMigrationPosts(page: Page, vaultId: string) {
  let posts = 0;
  const listener = (request: import("@playwright/test").Request) => {
    if (
      request.method() === "POST" &&
      request.url().includes(`/api/v1/vaults/${vaultId}/snapshots`)
    ) {
      posts += 1;
    }
  };
  page.on("request", listener);
  return {
    get count() { return posts; },
    dispose() { page.off("request", listener); },
  };
}

async function setupLegacy(page: Page): Promise<{ vaultId: string; wire: unknown }> {
  await page.goto("/");
  await reachUnlockedLocalApp(page);
  const vaultId = await page.evaluate(() => localStorage.getItem("4allpass.active-vault"));
  expect(vaultId, "synthetic local vault id").toMatch(/^[0-9a-f-]{36}$/i);
  await page.getByTestId("lock").click();
  await expect(page.getByTestId("master-password")).toBeVisible();
  await page.evaluate((id) => {
    localStorage.removeItem(`4allpass.pin.${id}`);
  }, vaultId!);
  const wire = fakeLegacyWire(vaultId!);
  await page.route(new RegExp(`/api/v1/vaults/${vaultId}/snapshot$`), (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(wire),
    }),
  );
  await page.getByTestId("master-password").fill(VAULT_PASSWORD);
  await page.getByTestId("unlock-submit").click();
  await expect(page.getByTestId("legacy-migration-banner")).toBeVisible();
  await page.getByTestId("language-de").click();
  return { vaultId: vaultId!, wire };
}

test("DE/EN legacy banner, confirm once, focus", async ({ page, browser }) => {
  const { vaultId } = await setupLegacy(page);
  await page.getByTestId("language-de").click();
  await expect(page.getByTestId("legacy-migration-banner")).toContainText("noch nicht als Ganzes versiegelt");
  await expect(page.getByTestId("legacy-migration-now")).toHaveText("Jetzt aktualisieren");
  await page.getByTestId("language-en").click();
  await expect(page.getByTestId("legacy-migration-banner")).toContainText("not yet sealed as a whole");
  await expect(page.getByTestId("legacy-migration-now")).toHaveText("Update now");
  await page.getByTestId("language-de").click();

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  let focused = "";
  for (let index = 0; index < 80; index += 1) {
    await page.keyboard.press("Tab");
    focused = await page.evaluate(
      () => document.activeElement?.getAttribute("data-testid") ?? "",
    );
    if (focused === "legacy-migration-now") break;
  }
  expect(focused).toBe("legacy-migration-now");
  const focusEvidence = await page.getByTestId("legacy-migration-now").evaluate((element) => ({
    focusVisible: element.matches(":focus-visible"),
    outline: getComputedStyle(element).outlineStyle,
    outlineWidth: getComputedStyle(element).outlineWidth,
  }));
  expect(focusEvidence.focusVisible).toBe(true);
  expect(focusEvidence.outline).not.toBe("none");
  expect(parseFloat(focusEvidence.outlineWidth)).toBeGreaterThanOrEqual(2);
  await page.screenshot({ path: join(OUT, "de-confirm.png") });

  let posts = 0;
  await page.route(new RegExp(`/api/v1/vaults/${vaultId}/snapshots$`), async (route) => {
    posts += 1;
    const body = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...body, vaultId }),
    });
  });
  await page.getByTestId("legacy-migration-now").click();
  await expect(page.getByTestId("legacy-migration-banner")).toContainText("Tresor aktualisiert");
  await expect(page.getByTestId("legacy-migration-now")).toHaveCount(0);
  expect(posts).toBe(1);
  await page.screenshot({ path: join(OUT, "de-confirm-success.png") });
  evidence("confirm", {
    browser: browser.browserType().name(),
    version: browser.version(),
    viewport: page.viewportSize(),
    sourceHead: process.env.AP286_SOURCE_HEAD ?? "unknown",
    posts,
    focusEvidence,
    screenshots: ["de-confirm.png", "de-confirm-success.png"],
    data: "synthetic only",
  });
});

test("decline keeps the legacy vault readable and posts nothing", async ({ page }) => {
  const { vaultId } = await setupLegacy(page);
  await page.getByTestId("language-de").click();
  const counter = countMigrationPosts(page, vaultId);
  await page.getByTestId("legacy-migration-later").click();
  await expect(page.getByTestId("legacy-migration-banner")).toHaveCount(0);
  await expect(page.getByTestId("lock-state")).toHaveText("UNLOCKED");
  await page.waitForTimeout(250);
  expect(counter.count, "decline must not POST a migration").toBe(0);
  counter.dispose();
  await page.screenshot({ path: join(OUT, "de-decline.png") });
  evidence("decline", {
    vaultId,
    posts: counter.count,
    state: "UNLOCKED",
    counter: "page.on(request) migration POSTs",
    data: "synthetic only",
  });
});

test("UNKNOWN blocks after reload with no further POST", async ({ page, browser }) => {
  const { vaultId } = await setupLegacy(page);
  let posts = 0;
  await page.route(new RegExp(`/api/v1/vaults/${vaultId}/snapshots$`), async (route) => {
    posts += 1;
    await route.abort("failed");
  });
  await page.getByTestId("legacy-migration-now").click();
  await expect(page.getByTestId("legacy-migration-banner")).toContainText("Ausgang ist unklar");
  expect(posts).toBe(1);
  const before = await page.evaluate((id) => {
    const raw = localStorage.getItem(`4allpass.legacy-migration.${id}`);
    return raw ? JSON.parse(raw) as Record<string, unknown> : null;
  }, vaultId);
  expect(before?.state).toBe("unknown");
  expect(before?.baseRevision).toBe(1);
  expect(typeof before?.preparedManifestDigest).toBe("string");
  await page.screenshot({ path: join(OUT, "de-unknown.png") });

  await page.reload();
  await reachUnlockedLocalApp(page);
  await expect(page.getByTestId("legacy-migration-banner")).toBeVisible();
  await expect(page.getByTestId("legacy-migration-blocked")).toContainText("letzte Versuch ist unklar");
  await expect(page.getByTestId("legacy-migration-now")).toBeDisabled();
  expect(posts).toBe(1);
  const after = await page.evaluate((id) => {
    const raw = localStorage.getItem(`4allpass.legacy-migration.${id}`);
    return raw ? JSON.parse(raw) as Record<string, unknown> : null;
  }, vaultId);
  expect(after?.state).toBe("unknown");
  await page.screenshot({ path: join(OUT, "de-unknown-reload.png") });
  evidence("unknown", {
    browser: browser.browserType().name(),
    version: browser.version(),
    viewport: page.viewportSize(),
    sourceHead: process.env.AP286_SOURCE_HEAD ?? "unknown",
    posts,
    receipt: after,
    screenshots: ["de-unknown.png", "de-unknown-reload.png"],
    data: "synthetic only",
  });
});

test("lock hides the banner without a migration POST", async ({ page }) => {
  const { vaultId } = await setupLegacy(page);
  const counter = countMigrationPosts(page, vaultId);
  await page.getByTestId("lock").click();
  await expect(page.getByTestId("legacy-migration-banner")).toHaveCount(0);
  await expect(page.getByTestId("lock-state")).toHaveText("LOCKED");
  await page.waitForTimeout(250);
  expect(counter.count, "lock must not POST a migration").toBe(0);
  counter.dispose();
  await page.screenshot({ path: join(OUT, "de-lock.png") });
  evidence("lock", {
    vaultId,
    posts: counter.count,
    state: "LOCKED",
    counter: "page.on(request) migration POSTs",
    data: "synthetic only",
  });
});
