/**
 * Week-7 two-minute walkthrough. Policy still lives in access.ts.
 * FastAPI is not on this path. The dummy GitHub token is not a real PAT.
 */
import { decideAccess, type AccessRequest } from "./access.ts";
import { emptyDraft, type EntryDraft, type VaultEntry } from "./entries.ts";

export const DEMO_TTL_SECONDS = 15;

/** Placeholder only. Never a live GitHub PAT. Encrypted on the device if seeded. */
export const DEMO_DUMMY_TOKEN = "ghp_demo-not-a-real-key";

export type DemoSceneId = "setup" | "read" | "delete" | "expire" | "unknown" | "done";

/** Guided order after a GitHub `repository.read` credential exists. */
export const DEMO_WALKTHROUGH: DemoSceneId[] = ["read", "delete", "expire", "unknown", "done"];

export function demoReadRequest(): AccessRequest {
  return {
    application: "n8n",
    provider: "GitHub",
    credential: "personal",
    scope: ["repository.read"],
    ttlSeconds: DEMO_TTL_SECONDS,
  };
}

export function demoDeleteRequest(): AccessRequest {
  return {
    application: "n8n",
    provider: "GitHub",
    credential: "personal",
    scope: ["repository.delete"],
    ttlSeconds: DEMO_TTL_SECONDS,
  };
}

export function demoUnknownRequest(): AccessRequest {
  return {
    application: "malicious-agent",
    provider: "GitHub",
    credential: "personal",
    scope: ["repository.read"],
    ttlSeconds: DEMO_TTL_SECONDS,
  };
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

/** Capabilities are read-only so `repository.delete` stays DENY. */
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
    notes: "Übungs-Token, kein echtes GitHub-PAT. / Dummy token for the demo. Not a live GitHub PAT.",
  };
}

export function redactToken(token: string): string {
  const trimmed = token.trim();
  if (!trimmed) return "••••";
  if (trimmed.length <= 8) return `${trimmed.slice(0, 2)}••••`;
  return `${trimmed.slice(0, 4)}••••`;
}

/** UI copy for a live grant. Must never include the secret or a prefix of it. */
export function grantHandoffCopy(application: string, secondsLeft: number): string {
  const app = application.trim() || "Programm / app";
  return `${app} darf noch ${secondsLeft}s / ${secondsLeft}s left`;
}

export function remainingSeconds(expiresAt: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((expiresAt - now) / 1000));
}

export interface DemoSceneCopy {
  step: string;
  title: string;
  body: string;
  action: string;
}

export function demoSceneCopy(id: DemoSceneId): DemoSceneCopy {
  switch (id) {
    case "setup":
      return {
        step: "Vorbereitung / Setup",
        title: "GitHub-Eintrag fehlt / Need a GitHub credential",
        body: "Die Übung braucht einen GitHub-Eintrag, der nur Lesen darf. Du kannst ein Übungs-Token hier anlegen (bleibt verschlüsselt auf diesem Gerät) oder selbst einen Eintrag speichern. Erkennen ist nicht Erlauben. / The walkthrough uses a GitHub API entry with repository.read only. Seed a dummy token (encrypted on this device) or add your own on Entries. Detect is not Allow.",
        action: "Übungs-Eintrag anlegen / Add demo GitHub credential",
      };
    case "read":
      return {
        step: "1 / 4",
        title: "n8n will GitHub lesen / n8n asks GitHub repository.read",
        body: "Erlauben gibt n8n kurz das Secret (raw_secret_handoff). Die Zeitbegrenzung holt eine Kopie nicht zurück. / Allow hands n8n the secret briefly (raw_secret_handoff). TTL cannot recall a copy.",
        action: `n8n asks GitHub repository.read (${DEMO_TTL_SECONDS}s)`,
      };
    case "delete":
      return {
        step: "2 / 4",
        title: "n8n will löschen / n8n asks repository.delete",
        body: "Löschen steht nicht auf dem Eintrag. Deshalb Ablehnen, bevor irgendetwas rausgeht. / Delete is not on the entry. Policy denies it before any grant.",
        action: "n8n asks repository.delete",
      };
    case "expire":
      return {
        step: "3 / 4",
        title: "Zeit ist um / TTL expires",
        body: "Nach Ablauf gibt es keinen neuen Zugang. Was schon rausgegeben wurde, holst du nicht zurück — dann das Passwort beim Anbieter wechseln. / Expiry stops future handoffs. A copy already given is not un-known — rotate the upstream secret to revoke a leak.",
        action: "Jetzt ablaufen lassen / Expire now",
      };
    case "unknown":
      return {
        step: "4 / 4",
        title: "Unbekanntes Programm fragt / Unknown app asks GitHub",
        body: "Ein Name in der Anfrage ist keine Ausweis. Unbekannt = Ablehnen. Nichts wird automatisch erlaubt. / Process name is not identity. Unknown application = DENY. There is no auto-approve.",
        action: "unknown app asks GitHub",
      };
    case "done":
      return {
        step: "Fertig / Done",
        title: "So merkst du es / Two minutes",
        body: "Erlauben → kurz Zugang → Löschen abgelehnt → Zeit um → Unbekannt abgelehnt. Im Protokoll steht kein Passwort. / Allow → works → delete DENY → expire → unknown DENY. Audit has no secret.",
        action: "Noch einmal / Replay demo",
      };
  }
}
