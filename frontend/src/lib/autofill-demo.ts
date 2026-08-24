import { emptyDraft, type EntryDraft, type VaultEntry } from "./entries.ts";

/** Same origin as the desktop sidecar. Extension host-match uses this URL. */
export const AUTOFILL_DEMO_URL = "http://127.0.0.1:8788/test-login.html";
export const AUTOFILL_DEMO_USERNAME = "ada@example.com";
export const AUTOFILL_DEMO_PASSWORD = "s3cret-autofill";

export function isAutofillDemoEntry(entry: Pick<VaultEntry, "url">): boolean {
  return entry.url.replace(/\/$/, "") === AUTOFILL_DEMO_URL;
}

export function autofillDemoDraft(): EntryDraft {
  return {
    ...emptyDraft("web"),
    title: "4AllPass demo login",
    username: AUTOFILL_DEMO_USERNAME,
    password: AUTOFILL_DEMO_PASSWORD,
    url: AUTOFILL_DEMO_URL,
    domain: "127.0.0.1",
  };
}
