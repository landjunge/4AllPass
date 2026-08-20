import { bytesToHex, randomBytes } from "@4allpass/crypto";
import { entriesForPage, type FillEntry } from "./match.ts";
import { unlockVault } from "./unlock.ts";

interface SessionState {
  apiOrigin: string;
  token: string;
  vaultId: string;
  entries: FillEntry[];
}

let session: SessionState | null = null;

async function httpTab(preferredUrl?: string): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({});
  const http = tabs.filter((tab) => tab.id && tab.url && /^https?:/.test(tab.url));
  if (preferredUrl) {
    const host = (() => {
      try {
        return new URL(preferredUrl).hostname;
      } catch {
        return "";
      }
    })();
    const hit = http.find((tab) => tab.url && tab.url.includes(host));
    if (hit) return hit;
  }
  return http.at(-1);
}

function fillCredentials(username: string, password: string): void {
  const inputs = [...document.querySelectorAll("input")].filter((input) => {
    if (input.type === "hidden" || input.disabled) return false;
    const style = getComputedStyle(input);
    return style.display !== "none" && style.visibility !== "hidden";
  });
  const user =
    inputs.find((input) =>
      /user|email|login|id/i.test(`${input.name} ${input.id} ${input.autocomplete}`),
    ) ?? inputs.find((input) => input.type !== "password");
  const pass = inputs.find((input) => input.type === "password");
  const assign = (input: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;
    setter?.call(input, value);
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };
  if (user) assign(user, username);
  if (pass) assign(pass, password);
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
      return {
        ok: true,
        unlocked: session !== null,
        entryCount: session?.entries.length ?? 0,
      };
    case "lock":
      session = null;
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
      return { ok: true, entryCount: session.entries.length };
    }
    case "candidates": {
      if (!session) return { ok: false, error: "vault is locked" };
      const origin = String(message.pageUrl ?? "");
      return { ok: true, entries: entriesForPage(session.entries, origin) };
    }
    case "fill-tab": {
      if (!session) return { ok: false, error: "vault is locked" };
      const tab = await httpTab(typeof message.pageUrl === "string" ? message.pageUrl : undefined);
      if (!tab?.id || !tab.url) return { ok: false, error: "no website tab to fill" };
      const matches = entriesForPage(session.entries, tab.url);
      if (matches.length === 0) return { ok: false, error: "no entry matches this page" };
      const chosen =
        typeof message.entryId === "string"
          ? matches.find((entry) => entry.id === message.entryId)
          : matches.length === 1
            ? matches[0]
            : undefined;
      if (!chosen) return { ok: true, needsPick: true, entries: matches };
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: fillCredentials,
        args: [chosen.username, chosen.password],
      });
      return { ok: true, filled: chosen.title || chosen.username };
    }
    default:
      return { ok: false, error: "unknown message" };
  }
}
