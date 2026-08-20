import { bytesToHex, randomBytes } from "@4allpass/crypto";
import { AUTO_LOCK_MINUTES, createIdleLock } from "./idle-lock.ts";
import { entriesForPage, type FillEntry } from "./match.ts";
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
    await chrome.alarms.clear(AUTO_LOCK_ALARM);
    if (session) {
      await chrome.alarms.create(AUTO_LOCK_ALARM, { delayInMinutes: AUTO_LOCK_MINUTES });
    }
  } catch {
    // alarms permission missing in tests / older chrome
  }
}

function noteActivity(): void {
  if (!session) {
    idle.stop();
    void chrome.alarms.clear(AUTO_LOCK_ALARM).catch(() => undefined);
    return;
  }
  idle.touch();
  void armChromeAlarm();
}

async function lockVault(): Promise<void> {
  idle.stop();
  dropSession();
  try {
    await chrome.alarms.clear(AUTO_LOCK_ALARM);
  } catch {
    // ignore
  }
  await setMenuEnabled(false);
  await refreshBadge();
}

async function deviceId(): Promise<string> {
  const stored = await chrome.storage.local.get("deviceId");
  if (typeof stored.deviceId === "string" && stored.deviceId.startsWith("dev_")) {
    return stored.deviceId;
  }
  const created = `dev_${bytesToHex(randomBytes(12))}`;
  await chrome.storage.local.set({ deviceId: created });
  return created;
}

async function activeHttpTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id && tab.url && /^https?:/.test(tab.url)) return tab;
  const tabs = await chrome.tabs.query({});
  return tabs.find((candidate) => candidate.id && candidate.url && /^https?:/.test(candidate.url));
}

async function fillInTab(tabId: number, username: string, password: string): Promise<boolean> {
  try {
    const response = (await chrome.tabs.sendMessage(tabId, {
      type: "fill-form",
      username,
      password,
    })) as { ok?: boolean } | undefined;
    if (response?.ok) return true;
  } catch {
    // no content script yet
  }
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  const retry = (await chrome.tabs.sendMessage(tabId, {
    type: "fill-form",
    username,
    password,
  })) as { ok?: boolean } | undefined;
  return Boolean(retry?.ok);
}

async function refreshBadge(tabId?: number): Promise<void> {
  const tab = tabId
    ? await chrome.tabs.get(tabId).catch(() => undefined)
    : await activeHttpTab();
  if (!tab?.id) return;
  if (!session || !tab.url) {
    await chrome.action.setBadgeText({ tabId: tab.id, text: "" });
    return;
  }
  const n = entriesForPage(session.entries, tab.url).length;
  await chrome.action.setBadgeBackgroundColor({ color: "#3d6bff" });
  await chrome.action.setBadgeText({ tabId: tab.id, text: n > 0 ? String(n) : "" });
}

async function setMenuEnabled(on: boolean): Promise<void> {
  try {
    await chrome.contextMenus.update(MENU_FILL, {
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
    await chrome.contextMenus.removeAll();
    chrome.contextMenus.create({
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
    await chrome.action.openPopup();
  } catch {
    // no user-gesture window
  }
}

async function fillActive(entryId?: string): Promise<Record<string, unknown>> {
  if (!session) {
    await openPopupSafe();
    return { ok: false, error: "vault is locked" };
  }
  noteActivity();
  const tab = await activeHttpTab();
  if (!tab?.id || !tab.url) return { ok: false, error: "no website tab to fill" };
  const matches = entriesForPage(session.entries, tab.url);
  if (matches.length === 0) return { ok: false, error: "no entry matches this page" };
  const chosen = entryId
    ? matches.find((entry) => entry.id === entryId)
    : matches.length === 1
      ? matches[0]
      : undefined;
  if (!chosen) {
    await openPopupSafe();
    return { ok: true, needsPick: true, entries: matches };
  }
  const filled = await fillInTab(tab.id, chosen.username, chosen.password);
  if (!filled) return { ok: false, error: "no login fields on this page" };
  return { ok: true, filled: chosen.title || chosen.username };
}

chrome.runtime.onInstalled.addListener(() => {
  void ensureMenu();
});

chrome.runtime.onStartup.addListener(() => {
  void ensureMenu();
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "fill-login") void fillActive();
  if (command === "lock-vault") void lockVault();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AUTO_LOCK_ALARM) void lockVault();
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === MENU_FILL) void fillActive();
});

chrome.tabs.onActivated.addListener((info) => {
  void refreshBadge(info.tabId);
});

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === "complete" || change.url) void refreshBadge(tabId);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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
      const apiOrigin = String(message.apiOrigin ?? "http://127.0.0.1:8010").replace(/\/$/, "");
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
      return { ok: true, entries: tab?.url ? entriesForPage(session.entries, tab.url) : [] };
    }
    case "fill-tab":
      return fillActive(typeof message.entryId === "string" ? message.entryId : undefined);
    default:
      return { ok: false, error: "unknown message" };
  }
}

void ensureMenu();
