import type { Line } from "../../lib/copy-mode.ts";
import { decideAccess, type AccessRequest } from "./access.ts";
import { emptyDraft, type EntryDraft, type VaultEntry } from "../entries/index.ts";

export const DEMO_TTL_SECONDS = 15;
export const DEMO_DUMMY_TOKEN = "ghp_demo-not-a-real-key";
export type DemoSceneId = "setup" | "read" | "delete" | "expire" | "unknown" | "done";
export const DEMO_WALKTHROUGH: DemoSceneId[] = ["read", "delete", "expire", "unknown", "done"];

export function demoReadRequest(): AccessRequest {
  return { application: "n8n", provider: "GitHub", credential: "personal", scope: ["repository.read"], ttlSeconds: DEMO_TTL_SECONDS };
}

export function demoDeleteRequest(): AccessRequest {
  return { application: "n8n", provider: "GitHub", credential: "personal", scope: ["repository.delete"], ttlSeconds: DEMO_TTL_SECONDS };
}

export function demoUnknownRequest(): AccessRequest {
  return { application: "malicious-agent", provider: "GitHub", credential: "personal", scope: ["repository.read"], ttlSeconds: DEMO_TTL_SECONDS };
}

export function hasGithubReadCredential(entries: VaultEntry[]): boolean {
  return decideAccess(demoReadRequest(), entries).status === "pending";
}

export function startingScene(entries: VaultEntry[]): DemoSceneId {
  return hasGithubReadCredential(entries) ? "read" : "setup";
}

export function nextDemoScene(current: DemoSceneId): DemoSceneId {
  if (current === "setup") return "read";
  const index = DEMO_WALKTHROUGH.indexOf(current);
  if (index < 0) return "read";
  return DEMO_WALKTHROUGH[Math.min(index + 1, DEMO_WALKTHROUGH.length - 1)]!;
}

export function demoGithubDraft(): EntryDraft {
  const draft = emptyDraft("api");
  return {
    ...draft,
    title: "GitHub (demo)",
    provider: "GitHub",
    account: "personal",
    password: DEMO_DUMMY_TOKEN,
    capabilities: "repository.read",
    credentialType: "personal_access_token",
    // Tresor-Inhalt, keine Bedienoberflaeche: EntryDraft.notes ist ein String und
    // wird verschluesselt gespeichert, nicht uebersetzt angezeigt.
    notes: "Übungs-Token, kein echtes GitHub-PAT. / Dummy token for the demo. Not a live GitHub PAT.",
  };
}

export function redactToken(token: string): string {
  const trimmed = token.trim();
  if (!trimmed) return "••••";
  if (trimmed.length <= 8) return `${trimmed.slice(0, 2)}••••`;
  return `${trimmed.slice(0, 4)}••••`;
}

export function grantHandoffCopy(application: string, secondsLeft: number): Line {
  const app = application.trim();
  return {
    de: `${app || "Programm"} darf noch ${secondsLeft}s`,
    en: `${app || "app"} has ${secondsLeft}s left`,
  };
}

export function remainingSeconds(expiresAt: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((expiresAt - now) / 1000));
}

export interface DemoSceneCopy { step: Line; title: Line; body: Line; action: Line; }

export function demoSceneCopy(id: DemoSceneId): DemoSceneCopy {
  switch (id) {
    case "setup": return { step: { de: "Vorbereitung", en: "Setup" }, title: { de: "GitHub-Eintrag fehlt", en: "Need a GitHub credential" }, body: { de: "Die Übung braucht einen GitHub-Eintrag, der nur Lesen darf. Du kannst ein Übungs-Token hier anlegen (bleibt verschlüsselt auf diesem Gerät) oder selbst einen Eintrag speichern. Erkennen ist nicht Erlauben.", en: "The walkthrough uses a GitHub API entry with repository.read only. Seed a dummy token (encrypted on this device) or add your own on Entries. Detect is not Allow." }, action: { de: "Übungs-Eintrag anlegen", en: "Add demo GitHub credential" } };
    case "read": return { step: { de: "1 / 4", en: "1 / 4" }, title: { de: "n8n will GitHub lesen", en: "n8n asks GitHub repository.read" }, body: { de: "Erlauben gibt n8n kurz das Secret (raw_secret_handoff). Die Zeitbegrenzung holt eine Kopie nicht zurück.", en: "Allow hands n8n the secret briefly (raw_secret_handoff). TTL cannot recall a copy." }, action: { de: `n8n asks GitHub repository.read (${DEMO_TTL_SECONDS}s)`, en: `n8n asks GitHub repository.read (${DEMO_TTL_SECONDS}s)` } };
    case "delete": return { step: { de: "2 / 4", en: "2 / 4" }, title: { de: "n8n will löschen", en: "n8n asks repository.delete" }, body: { de: "Löschen steht nicht auf dem Eintrag. Deshalb Ablehnen, bevor irgendetwas rausgeht.", en: "Delete is not on the entry. Policy denies it before any grant." }, action: { de: "n8n asks repository.delete", en: "n8n asks repository.delete" } };
    case "expire": return { step: { de: "3 / 4", en: "3 / 4" }, title: { de: "Zeit ist um", en: "TTL expires" }, body: { de: "Nach Ablauf gibt es keinen neuen Zugang. Was schon rausgegeben wurde, holst du nicht zurück — dann das Passwort beim Anbieter wechseln.", en: "Expiry stops future handoffs. A copy already given is not un-known — rotate the upstream secret to revoke a leak." }, action: { de: "Jetzt ablaufen lassen", en: "Expire now" } };
    case "unknown": return { step: { de: "4 / 4", en: "4 / 4" }, title: { de: "Unbekanntes Programm fragt", en: "Unknown app asks GitHub" }, body: { de: "Ein Name in der Anfrage ist keine Ausweis. Unbekannt = Ablehnen. Nichts wird automatisch erlaubt.", en: "Process name is not identity. Unknown application = DENY. There is no auto-approve." }, action: { de: "unknown app asks GitHub", en: "unknown app asks GitHub" } };
    case "done": return { step: { de: "Fertig", en: "Done" }, title: { de: "So merkst du es", en: "Two minutes" }, body: { de: "Erlauben → kurz Zugang → Löschen abgelehnt → Zeit um → Unbekannt abgelehnt. Im Protokoll steht kein Passwort.", en: "Allow → works → delete DENY → expire → unknown DENY. Audit has no secret." }, action: { de: "Noch einmal", en: "Replay demo" } };
  }
}
