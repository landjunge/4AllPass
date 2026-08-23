import { bytesToHex, randomBytes } from "@4allpass/crypto";
import { ext } from "./browser.ts";
import { AUTO_LOCK_MINUTES, createIdleLock } from "./idle-lock.ts";
import { formatFillFailure, type FillReason, type FillResult } from "./fill.ts";
import { entriesForPage, publicPicks, type FillEntry } from "./match.ts";
import { unlockVault } from "./unlock.ts";

interface SessionState {
  apiOrigin: string;
  token: string;
  vaultId: string;
  entries: FillEntry[];
}

let session: SessionState | null = null;

const MENU_FILL = "fill-login";
const AUTO_LOCK_ALARM = "autolock";

function dropSession(): void {
  if (session) {
    session.token = "";
    for (const entry of session.entries) {
      entry.password = "";
      entry.username = "";
    }
  }
  session = null;
}

const idle = createIdleLock(() => {
  void lockVault();
});

async function armChromeAlarm(): Promise<void> {
  try {
    await ext.alarms.clear(AUTO_LOCK_ALARM);
    if (session) {
      await ext.alarms.create(AUTO_LOCK_ALARM, { delayInMinutes: AUTO_LOCK_MINUTES });
    }
  } catch {
    // alarms permission missing in tests / older chrome
  }
}

function noteActivity(): void {
  if (!session) {
    idle.stop();
    void ext.alarms.clear(AUTO_LOCK_ALARM).catch(() => undefined);
    return;
  }
  idle.touch();
  void armChromeAlarm();
}

async function lockVault(): Promise<void> {
  idle.stop();
  dropSession();
  try {
    await ext.alarms.clear(AUTO_LOCK_ALARM);
  } catch {
    // ignore
  }
  await setMenuEnabled(false);
  await refreshBadge();
}

async function ensureApiOrigin(origin: string): Promise<void> {
  if (!ext.permissions?.contains || !ext.permissions.request) return;
  const origins = [`${origin.replace(/\/$/, "")}/*`];
  try {
    if (await ext.permissions.contains({ origins })) return;
    const granted = await ext.permissions.request({ origins });
    if (!granted) throw new Error("this browser blocked access to the API origin");
  } catch (error) {
    if (error instanceof Error && /blocked access to the API origin/.test(error.message)) throw error;
  }
}

async function deviceId(): Promise<string> {
  const stored = await ext.storage.local.get("deviceId");
  if (typeof stored.deviceId === "string" && stored.deviceId.startsWith("dev_")) {
    return stored.deviceId;
  }
  const created = `dev_${bytesToHex(randomBytes(12))}`;
  await ext.storage.local.set({ deviceId: created });
  return created;
}

async function activeHttpTab(): Promise<chrome.tabs.Tab | undefined> {
  const [focused] = await ext.tabs.query({ active: true, lastFocusedWindow: true });
  if (focused?.id && focused.url && /^https?:/.test(focused.url)) return focused;
  const tabs = await ext.tabs.query({});
  const http = tabs.filter((tab) => tab.id && tab.url && /^https?:/.test(tab.url));
  http.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
  return http[0];
}

function emptyFill(reason: FillReason): FillResult {
  return { ok: false, fields: [], mode: "skipped", reason };
}

async function sendToTab(tabId: number, payload: Record<string, unknown>): Promise<FillResult> {
  try {
    const response = (await ext.tabs.sendMessage(tabId, payload)) as FillResult | undefined;
    if (response) return response;
  } catch {
    // no content script yet
  }
  await ext.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  const retry = (await ext.tabs.sendMessage(tabId, payload)) as FillResult | undefined;
  return retry ?? emptyFill("no-fields");
}

async function refreshBadge(tabId?: number): Promise<void> {
  const tab = tabId
    ? await ext.tabs.get(tabId).catch(() => undefined)
    : await activeHttpTab();
  if (!tab?.id) return;
  if (!session || !tab.url) {
    await ext.action.setBadgeText({ tabId: tab.id, text: "" });
    return;
  }
  const n = entriesForPage(session.entries, tab.url).length;
  await ext.action.setBadgeBackgroundColor({ color: "#3d6bff" });
  await ext.action.setBadgeText({ tabId: tab.id, text: n > 0 ? String(n) : "" });
}

async function setMenuEnabled(on: boolean): Promise<void> {
  try {
    await ext.contextMenus.update(MENU_FILL, {
      enabled: on,
      title: on ? "Fill with 4AllPass" : "Fill with 4AllPass (unlock first)",
    });
  } catch {
    // menu not created yet
  }
}

let menuChain = Promise.resolve();

async function ensureMenu(): Promise<void> {
  menuChain = menuChain.then(async () => {
    await ext.contextMenus.removeAll();
    ext.contextMenus.create({
      id: MENU_FILL,
      title: session ? "Fill with 4AllPass" : "Fill with 4AllPass (unlock first)",
      contexts: ["page", "frame", "editable"],
      enabled: session !== null,
    });
  });
  await menuChain;
}

async function openPopupSafe(): Promise<void> {
  try {
    await ext.action.openPopup();
  } catch {
    // no user-gesture window
  }
}

async function fillActive(entryId?: string): Promise<Record<string, unknown>> {
  if (!session) {
    await openPopupSafe();
    return { ok: false, error: formatFillFailure({ reason: "locked" }), reason: "locked" };
  }
  noteActivity();
  const tab = await activeHttpTab();
  if (!tab?.id || !tab.url) return { ok: false, error: "no website tab to fill", reason: "no-fields" };
  const matches = entriesForPage(session.entries, tab.url);
  if (matches.length === 0) {
    return { ok: false, error: formatFillFailure({ reason: "no-match" }), reason: "no-match" };
  }
  const chosen = entryId
    ? matches.find((entry) => entry.id === entryId)
    : matches.length === 1
      ? matches[0]
      : undefined;
  if (!chosen) {
    await openPopupSafe();
    return { ok: true, needsPick: true, entries: publicPicks(matches) };
  }
  const probe = await sendToTab(tab.id, { type: "probe-form" });
  if (!probe.ok) {
    return {
      ok: false,
      error: formatFillFailure(probe),
      reason: probe.reason,
      fields: probe.fields,
      filled: probe.filled ?? [],
      mode: probe.mode,
      confidence: probe.confidence,
    };
  }
  const filled = await sendToTab(tab.id, {
    type: "fill-form",
    username: chosen.username,
    password: chosen.password,
  });
  if (!filled.ok) {
    return {
      ok: false,
      error: formatFillFailure(filled),
      reason: filled.reason,
      fields: filled.fields,
      filled: filled.filled ?? [],
      mode: filled.mode,
      confidence: filled.confidence,
    };
  }
  return {
    ok: true,
    fields: filled.fields,
    filled: filled.filled ?? filled.fields,
    mode: filled.mode,
    confidence: filled.confidence,
  };
}

ext.runtime.onInstalled.addListener(() => {
  void ensureMenu();
});

ext.runtime.onStartup.addListener(() => {
  void ensureMenu();
});

ext.commands.onCommand.addListener((command) => {
  if (command === "fill-login") void fillActive();
  if (command === "lock-vault") void lockVault();
});

ext.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AUTO_LOCK_ALARM) void lockVault();
});

ext.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === MENU_FILL) void fillActive();
});

ext.tabs.onActivated.addListener((info) => {
  void refreshBadge(info.tabId);
});

ext.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === "complete" || change.url) void refreshBadge(tabId);
});

ext.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void (async () => {
    try {
      sendResponse(await handle(message));
    } catch (error) {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  })();
  return true;
});

async function handle(message: { type?: string; [key: string]: unknown }): Promise<unknown> {
  switch (message.type) {
    case "status":
      if (session) noteActivity();
      return {
        ok: true,
        unlocked: session !== null,
        entryCount: session?.entries.length ?? 0,
        autoLockMinutes: AUTO_LOCK_MINUTES,
      };
    case "lock":
      await lockVault();
      return { ok: true };
    case "unlock": {
      const apiOrigin = String(message.apiOrigin ?? "http://127.0.0.1:8788").replace(/\/$/, "");
      await ensureApiOrigin(apiOrigin);
      const unlocked = await unlockVault({
        apiOrigin,
        deviceId: await deviceId(),
        email: String(message.email ?? ""),
        accountPassword: String(message.accountPassword ?? ""),
        vaultPassword: String(message.vaultPassword ?? ""),
      });
      session = {
        apiOrigin,
        token: unlocked.token,
        vaultId: unlocked.vaultId,
        entries: unlocked.entries,
      };
      noteActivity();
      await setMenuEnabled(true);
      await refreshBadge();
      return { ok: true, entryCount: session.entries.length };
    }
    case "candidates-active": {
      if (!session) return { ok: false, error: "vault is locked" };
      noteActivity();
      const tab = await activeHttpTab();
      return {
        ok: true,
        entries: tab?.url ? publicPicks(entriesForPage(session.entries, tab.url)) : [],
      };
    }
    case "fill-tab":
      return fillActive(typeof message.entryId === "string" ? message.entryId : undefined);
    default:
      return { ok: false, error: "unknown message" };
  }
}

void ensureMenu();
