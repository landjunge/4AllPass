import { ext } from "./browser.ts";
import { formatFillFailure, formatFillSuccess, type FillReason, type FillMode } from "./fill.ts";
import { POPUP_SETTINGS_KEY, parsePopupSettings, popupSettingsForStore } from "./popup-settings.ts";
import { isHttpUrl, pickFillTab } from "./tab-target.ts";

const assistBtn = document.getElementById("assist") as HTMLButtonElement;
let lastEntryId: string | undefined;

const statusEl = document.getElementById("status") as HTMLParagraphElement;
const errorEl = document.getElementById("error") as HTMLParagraphElement;
const unlockForm = document.getElementById("unlock") as HTMLFormElement;
const unlockedEl = document.getElementById("unlocked") as HTMLDivElement;
const picksEl = document.getElementById("picks") as HTMLUListElement;

function showError(text: string): void {
  errorEl.hidden = false;
  errorEl.textContent = text;
}

function showFillMiss(result: Record<string, unknown>): void {
  showError(
    formatFillFailure({
      reason: result.reason as FillReason | undefined,
      fields: Array.isArray(result.fields) ? (result.fields as Array<"username" | "password">) : undefined,
      filled: Array.isArray(result.filled) ? (result.filled as Array<"username" | "password">) : undefined,
      mode: result.mode as FillMode | undefined,
      confidence: typeof result.confidence === "number" ? result.confidence : undefined,
    }),
  );
  showAssist(result);
}

function showAssist(result: Record<string, unknown>): void {
  const fields = Array.isArray(result.assistFields)
    ? (result.assistFields as Array<"username" | "password">)
    : [];
  lastEntryId = typeof result.entryId === "string" ? result.entryId : lastEntryId;
  const prompt = typeof result.assistPrompt === "string" ? result.assistPrompt : "";
  assistBtn.hidden = fields.length === 0;
  if (fields.length && prompt) statusEl.textContent = prompt;
}

function clearError(): void {
  errorEl.hidden = true;
  errorEl.textContent = "";
}

async function send(message: Record<string, unknown>): Promise<Record<string, unknown>> {
  return (await ext.runtime.sendMessage(message)) as Record<string, unknown>;
}

function renderPicks(entries: Array<{ id: string; title: string; username: string }>): void {
  picksEl.replaceChildren();
  for (const entry of entries) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${entry.title || entry.username}`;
    button.addEventListener("click", () => {
      void send({ type: "fill-tab", entryId: entry.id }).then((filled) => {
        if (!filled.ok) showFillMiss(filled);
        else {
          statusEl.textContent = formatFillSuccess({
            fields: Array.isArray(filled.fields) ? (filled.fields as Array<"username" | "password">) : undefined,
            mode: filled.mode as FillMode | undefined,
            confidence: typeof filled.confidence === "number" ? filled.confidence : undefined,
          });
          showAssist(filled);
        }
      });
    });
    item.append(button);
    picksEl.append(item);
  }
}

async function restoreSettings(): Promise<void> {
  const stored = await ext.storage.local.get(POPUP_SETTINGS_KEY);
  const settings = parsePopupSettings(stored[POPUP_SETTINGS_KEY]);
  (document.getElementById("api") as HTMLInputElement).value = settings.apiOrigin;
  (document.getElementById("email") as HTMLInputElement).value = settings.email;
  const details = document.getElementById("server-account") as HTMLDetailsElement | null;
  if (details && settings.email) details.open = true;
}

async function rememberSettings(): Promise<void> {
  const apiOrigin = (document.getElementById("api") as HTMLInputElement).value;
  const email = (document.getElementById("email") as HTMLInputElement).value;
  await ext.storage.local.set({ [POPUP_SETTINGS_KEY]: popupSettingsForStore(apiOrigin, email) });
}

async function render(): Promise<void> {
  assistBtn.hidden = true;
  const status = await send({ type: "status" });
  const unlocked = status.unlocked === true;
  unlockForm.hidden = unlocked;
  unlockedEl.hidden = !unlocked;
  statusEl.textContent = unlocked
    ? `Entsperrt / Unlocked · ${String(status.entryCount)} Einträge / entries`
    : "Gesperrt. Entschlüsselung bleibt auf diesem Gerät. / Locked. Decryption stays on this device.";
  picksEl.replaceChildren();
  if (!unlocked) return;
  const candidates = await send({ type: "candidates-active" });
  if (candidates.ok && Array.isArray(candidates.entries)) {
    const entries = candidates.entries as Array<{ id: string; title: string; username: string }>;
    if (entries.length > 1) renderPicks(entries);
  }
}

unlockForm.addEventListener("submit", (event) => {
  event.preventDefault();
  clearError();
  const apiOrigin = (document.getElementById("api") as HTMLInputElement).value;
  const email = (document.getElementById("email") as HTMLInputElement).value;
  const accountPassword = (document.getElementById("account") as HTMLInputElement).value;
  const vaultPassword = (document.getElementById("vault") as HTMLInputElement).value;
  void rememberSettings()
    .then(() => send({ type: "unlock", apiOrigin, email, accountPassword, vaultPassword }))
    .then((result) => {
      if (!result.ok) showError(String(result.error ?? "unlock failed"));
      else void render();
    });
});

document.getElementById("lock")?.addEventListener("click", () => {
  void send({ type: "lock" }).then(() => render());
});

async function fillTargetTab(): Promise<chrome.tabs.Tab | undefined> {
  const [focused] = await ext.tabs.query({ active: true, lastFocusedWindow: true });
  const tabs = await ext.tabs.query({});
  const http = tabs.filter((tab) => tab.id !== undefined && isHttpUrl(tab.url));
  http.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
  return pickFillTab(focused, http[0]);
}

async function requestTabOrigin(tab: chrome.tabs.Tab | undefined): Promise<void> {
  if (!tab?.url || !ext.permissions?.request || !isHttpUrl(tab.url)) return;
  const origins = [`${new URL(tab.url).origin}/*`];
  try {
    if (await ext.permissions.contains({ origins })) return;
    await ext.permissions.request({ origins });
  } catch {
    // user denied, or the site is already in host_permissions
  }
}

document.getElementById("fill")?.addEventListener("click", () => {
  clearError();
  assistBtn.hidden = true;
  picksEl.replaceChildren();
  void fillTargetTab()
    .then(async (tab) => {
      await requestTabOrigin(tab);
      return send({ type: "fill-tab", tabId: tab?.id });
    })
    .then((result) => {
    if (!result.ok) {
      showFillMiss(result);
      return;
    }
    if (result.needsPick && Array.isArray(result.entries)) {
      renderPicks(result.entries as Array<{ id: string; title: string; username: string }>);
      return;
    }
    statusEl.textContent = formatFillSuccess({
      fields: Array.isArray(result.fields) ? (result.fields as Array<"username" | "password">) : undefined,
      mode: result.mode as FillMode | undefined,
      confidence: typeof result.confidence === "number" ? result.confidence : undefined,
    });
    showAssist(result);
  });
});

assistBtn.addEventListener("click", () => {
  clearError();
  assistBtn.hidden = true;
  void send({ type: "fill-tab", entryId: lastEntryId, assist: true }).then((result) => {
    if (!result.ok) {
      showFillMiss(result);
      return;
    }
    statusEl.textContent = formatFillSuccess({
      fields: Array.isArray(result.fields) ? (result.fields as Array<"username" | "password">) : undefined,
      mode: result.mode as FillMode | undefined,
      confidence: typeof result.confidence === "number" ? result.confidence : undefined,
    });
  });
});

void restoreSettings().then(() => render());
