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

async function setupLegacy(
  page: Page,
  options: { decorate?: (wire: Record<string, unknown>) => void } = {},
): Promise<{ vaultId: string; wire: Record<string, unknown> }> {
  await page.goto("/");
  await reachUnlockedLocalApp(page);
  const vaultId = await page.evaluate(() => localStorage.getItem("4allpass.active-vault"));
  expect(vaultId, "synthetic local vault id").toMatch(/^[0-9a-f-]{36}$/i);
  await page.getByTestId("lock").click();
  await expect(page.getByTestId("master-password")).toBeVisible();
  await page.evaluate((id) => {
    localStorage.removeItem(`4allpass.pin.${id}`);
  }, vaultId!);
  const wire = fakeLegacyWire(vaultId!) as unknown as Record<string, unknown>;
  options.decorate?.(wire);
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

/** Read the durable reservation through IndexedDB (same origin, shared). */
async function readReservation(page: Page, vaultId: string): Promise<Record<string, unknown> | null> {
  return page.evaluate(async (id) => new Promise((resolve, reject) => {
    const open = indexedDB.open("4allpass-legacy-migration", 1);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains("attempts")) open.result.createObjectStore("attempts");
    };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction("attempts", "readonly");
      const get = tx.objectStore("attempts").get(id);
      get.onsuccess = () => { resolve((get.result as Record<string, unknown>) ?? null); db.close(); };
      get.onerror = () => reject(get.error);
    };
  }), vaultId);
}

/** Open a fresh connection and read the durable legacy backup. */
async function readLegacyBackup(page: Page, vaultId: string): Promise<Record<string, unknown> | null> {
  return page.evaluate(async (id) => new Promise((resolve, reject) => {
    const open = indexedDB.open("4allpass-snapshot-cache", 1);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains("wire")) open.result.createObjectStore("wire");
    };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction("wire", "readonly");
      const get = tx.objectStore("wire").get(`legacy:${id}`);
      get.onsuccess = () => { resolve((get.result as Record<string, unknown>) ?? null); db.close(); };
      get.onerror = () => reject(get.error);
    };
  }), vaultId);
}

/** Read the live head cache through a fresh IndexedDB connection. */
async function readHeadCache(page: Page, vaultId: string): Promise<Record<string, unknown> | null> {
  return page.evaluate(async (id) => new Promise((resolve, reject) => {
    const open = indexedDB.open("4allpass-snapshot-cache", 1);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains("wire")) open.result.createObjectStore("wire");
    };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction("wire", "readonly");
      const get = tx.objectStore("wire").get(id);
      get.onsuccess = () => { resolve((get.result as Record<string, unknown>) ?? null); db.close(); };
      get.onerror = () => reject(get.error);
    };
  }), vaultId);
}

/** Key-order-insensitive JSON image for the backup-equals-wire check. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
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
  const before = await readReservation(page, vaultId);
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
  const after = await readReservation(page, vaultId);
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

test("two independent pages share one reservation: max one POST, no receipt clobber", async ({ page, context, browser }) => {
  const { vaultId } = await setupLegacy(page);

  // Second, independent page in the same browser context: same origin, same
  // IndexedDB origin storage. Synthetic wire only.
  const pageB = await context.newPage();
  try {
    await pageB.goto("/");
    await pageB.evaluate((id) => localStorage.setItem("4allpass.active-vault", id), vaultId);
    await pageB.evaluate((id) => localStorage.removeItem(`4allpass.pin.${id}`), vaultId);
    const wireB = fakeLegacyWire(vaultId);
    await pageB.route(new RegExp(`/api/v1/vaults/${vaultId}/snapshot$`), (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(wireB),
      }),
    );
    await reachUnlockedLocalApp(pageB);
    await expect(pageB.getByTestId("legacy-migration-banner")).toBeVisible();
    await pageB.getByTestId("language-de").click();
    await expect(pageB.getByTestId("legacy-migration-now")).toBeEnabled();
    expect(await pageB.evaluate(() => localStorage.getItem("4allpass.active-vault"))).toBe(vaultId);
    // Let page B load the empty reservation before page A claims it.
    await pageB.waitForTimeout(500);

    let postsA = 0;
    let releasePost: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => { releasePost = resolve; });
    await page.route(new RegExp(`/api/v1/vaults/${vaultId}/snapshots$`), async (route) => {
      postsA += 1;
      await gate;
      const body = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...body, vaultId }),
      });
    });
    let postsB = 0;
    await pageB.route(new RegExp(`/api/v1/vaults/${vaultId}/snapshots$`), async (route) => {
      postsB += 1;
      await route.abort("failed");
    });

    // Page A claims and parks immediately before its POST.
    void page.getByTestId("legacy-migration-now").click();
    await expect.poll(() => postsA).toBe(1);
    const during = await readReservation(pageB, vaultId);
    expect(during?.state).toBe("prepared");
    const owner = during?.operationID;
    expect(typeof owner).toBe("string");

    // Page B still had an enabled button from its earlier empty read. Its
    // migration must hit the durable reservation, not a second POST.
    await pageB.getByTestId("legacy-migration-now").click();
    await expect(pageB.getByTestId("legacy-migration-message")).toContainText("letzte Versuch ist unklar");
    await expect(pageB.getByTestId("legacy-migration-now")).toBeDisabled();
    await pageB.waitForTimeout(250);
    expect(postsB, "second page must not POST").toBe(0);
    const afterB = await readReservation(pageB, vaultId);
    expect(afterB?.operationID).toBe(owner);
    expect(afterB?.state).toBe("prepared");

    releasePost!();
    await expect(page.getByTestId("legacy-migration-banner")).toContainText("Tresor aktualisiert");
    expect(postsA).toBe(1);
    expect(postsB).toBe(0);
    const resolved = await readReservation(pageB, vaultId);
    expect(resolved?.operationID).toBe(owner);
    expect(resolved?.state).toBe("resolved");
    await pageB.screenshot({ path: join(OUT, "two-page-blocked.png") });
    evidence("two-page", {
      browser: browser.browserType().name(),
      version: browser.version(),
      viewport: page.viewportSize(),
      sourceHead: process.env.AP286_SOURCE_HEAD ?? "unknown",
      postsA,
      postsB,
      owner,
      during: during?.state,
      afterB: afterB?.state,
      resolved: resolved?.state,
      data: "synthetic only",
    });
  } finally {
    await pageB.close();
  }
});

test("unknown raw fields are backed up verbatim and fail closed before POST", async ({ page, context, browser }) => {
  const { vaultId } = await setupLegacy(page, {
    decorate: (raw) => {
      raw.futureTop = { note: "keep me" };
      (raw.entries as Array<Record<string, unknown>>)[0]!.futureEntry = "keep-entry";
      (raw.envelopes as Array<Record<string, unknown>>)[0]!.futureEnvelope = { nested: [1, 2, 3] };
    },
  });
  const counter = countMigrationPosts(page, vaultId);
  await page.getByTestId("legacy-migration-now").click();
  await expect(page.getByTestId("legacy-migration-message")).toContainText("nicht verlustfrei");
  await page.waitForTimeout(250);
  expect(counter.count, "unsupported metadata must not POST").toBe(0);
  counter.dispose();
  const reservation = await readReservation(page, vaultId);
  expect(reservation?.state).toBe("rejected");
  await page.screenshot({ path: join(OUT, "unsupported-metadata.png") });

  // Genuinely new connection: read the legacy backup from IndexedDB directly.
  const pageB = await context.newPage();
  let backup: Record<string, unknown> | null = null;
  try {
    await pageB.goto("/");
    backup = await readLegacyBackup(pageB, vaultId);
    expect(backup, "durable legacy backup").not.toBeNull();
    expect(backup?.revision).toBe(1);
    expect(backup?.sealedManifest).toBeUndefined();
    expect(backup?.futureTop).toEqual({ note: "keep me" });
    expect((backup?.entries as Array<Record<string, unknown>>)[0]?.futureEntry).toBe("keep-entry");
    expect((backup?.envelopes as Array<Record<string, unknown>>)[0]?.futureEnvelope).toEqual({ nested: [1, 2, 3] });
    expect((backup?.entries as Array<Record<string, unknown>>)[0]?.id).toBe("legacy_browser_1");
  } finally {
    await pageB.close();
  }
  evidence("unsupported-metadata", {
    browser: browser.browserType().name(),
    version: browser.version(),
    viewport: page.viewportSize(),
    sourceHead: process.env.AP286_SOURCE_HEAD ?? "unknown",
    posts: 0,
    reservation: reservation?.state,
    backupUnknownTop: backup?.futureTop,
    data: "synthetic only",
  });
});

test("online legacy unlock caches the raw wire; offline reopen migrates fail-closed", async ({ page, context, browser }) => {
  const { vaultId, wire } = await setupLegacy(page, {
    decorate: (raw) => {
      raw.futureTop = { note: "offline keep" };
      (raw.entries as Array<Record<string, unknown>>)[0]!.futureEntry = "keep-entry";
      (raw.envelopes as Array<Record<string, unknown>>)[0]!.futureEnvelope = { nested: [4, 5, 6] };
    },
  });

  // The online unlock must have written the exact raw wire, not a typed re-encode.
  const headOnline = await readHeadCache(page, vaultId);
  expect(headOnline?.futureTop).toEqual({ note: "offline keep" });
  expect((headOnline?.entries as Array<Record<string, unknown>>)[0]?.futureEntry).toBe("keep-entry");
  expect((headOnline?.envelopes as Array<Record<string, unknown>>)[0]?.futureEnvelope).toEqual({ nested: [4, 5, 6] });

  // Offline: the snapshot GET fails; unlock must use the head cache.
  await page.unroute(new RegExp(`/api/v1/vaults/${vaultId}/snapshot$`));
  await page.route(new RegExp(`/api/v1/vaults/${vaultId}/snapshot$`), (route) => route.abort("failed"));
  await page.reload();
  await reachUnlockedLocalApp(page);
  await expect(page.getByTestId("legacy-migration-banner")).toBeVisible();
  await page.getByTestId("language-de").click();
  const counter = countMigrationPosts(page, vaultId);
  await page.getByTestId("legacy-migration-now").click();
  await expect(page.getByTestId("legacy-migration-message")).toContainText("nicht verlustfrei");
  await page.waitForTimeout(250);
  expect(counter.count, "unsupported offline legacy must not POST").toBe(0);
  counter.dispose();
  const reservation = await readReservation(page, vaultId);
  expect(reservation?.state).toBe("rejected");
  await page.screenshot({ path: join(OUT, "offline-reopen-unsupported.png") });

  // Genuinely new connection: the backup equals the online wire, unknown fields included.
  const pageB = await context.newPage();
  let backup: Record<string, unknown> | null = null;
  try {
    await pageB.goto("/");
    backup = await readLegacyBackup(pageB, vaultId);
    expect(backup, "offline legacy backup").not.toBeNull();
    expect(canonical(backup)).toBe(canonical(wire));
  } finally {
    await pageB.close();
  }
  evidence("offline-reopen", {
    browser: browser.browserType().name(),
    version: browser.version(),
    viewport: page.viewportSize(),
    sourceHead: process.env.AP286_SOURCE_HEAD ?? "unknown",
    posts: 0,
    reservation: reservation?.state,
    backupEqualsWire: true,
    headUnknownTop: headOnline?.futureTop,
    data: "synthetic only",
  });
});
