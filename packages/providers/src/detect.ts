/**
 * Phase A — auto-detection. Suggest, never fill.
 *
 * Several independent signals, never a single env name. Confidence is a
 * suggestion score; `requiresConfirmation` is always true. Callers must ask.
 * Field *values* are not inputs. FastAPI is not in this path.
 */
import { resolveProvider } from "./resolve.ts";
import { providerById } from "./registry/index.ts";
import type { CredentialKind, ProviderResolution } from "./types.ts";

export interface DetectionSignals {
  /** Claimed app. A process name is not identity. */
  application?: string;
  /** Page or API URL. Hostname from URL, never string splits. */
  url?: string;
  /** ftp / sftp / https / http. Optional if `url` has a scheme. */
  protocol?: string;
  /** Form field name/id. Never values. */
  fieldNames?: string[];
  /** Visible labels / aria / placeholder. Never values. */
  fieldLabels?: string[];
  /** Tab or document title. */
  pageTitle?: string;
  /** Explicit provider id the user already picked. */
  userSelection?: string;
}

export interface SetupSuggestion {
  providerId: string | null;
  providerName: string | null;
  credentialKind: CredentialKind | null;
  targetApplication: string | null;
  /** Field name/id/label that voted, for a later click-to-fill. Never a secret. */
  matchedField: string | null;
  pageHost: string;
  confidence: number;
  requiresConfirmation: true;
  /** Machine-readable votes. Never raw field values or secrets. */
  reasons: string[];
  promptDe: string;
  promptEn: string;
}

const FIELD_ONLY_MAX = 0.45;
const APP_FIELD_MAX = 0.72;
const HIGH_MIN = 0.95;

const FIELD_PATTERNS: Array<{
  providerId: string;
  kind: CredentialKind;
  test: RegExp;
}> = [
  { providerId: "openai", kind: "api", test: /\bopenai[_-]?api[_-]?key\b|\bopenai[_-]?key\b/i },
  { providerId: "github", kind: "api", test: /\b(github[_-]?(pat|token|api[_-]?key)|gh[_-]?token)\b/i },
  { providerId: "cloudflare", kind: "api", test: /\b(cloudflare[_-]?api[_-]?token|cf[_-]?api[_-]?token)\b/i },
  { providerId: "stripe", kind: "api", test: /\bstripe[_-]?(secret[_-]?key|api[_-]?key)\b/i },
];

const KNOWN_APPS: Array<{ id: string; title: RegExp; ports: number[] }> = [
  { id: "n8n", title: /\bn8n\b/i, ports: [5678] },
];

function emptySuggestion(pageHost = ""): SetupSuggestion {
  return {
    providerId: null,
    providerName: null,
    credentialKind: null,
    targetApplication: null,
    matchedField: null,
    pageHost,
    confidence: 0,
    requiresConfirmation: true,
    reasons: [],
    promptDe: "",
    promptEn: "",
  };
}

function pageInfo(url?: string): { host: string; port: number | null; protocol: string; href: string } | null {
  if (!url?.trim()) return null;
  try {
    const parsed = url.includes("://") ? new URL(url) : new URL(`https://${url}`);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    const port = parsed.port ? Number(parsed.port) : parsed.protocol === "https:" ? 443 : parsed.protocol === "http:" ? 80 : null;
    return { host, port: Number.isFinite(port) ? port : null, protocol: parsed.protocol.replace(":", ""), href: parsed.href };
  } catch {
    return null;
  }
}

function fieldVote(signals: DetectionSignals): { providerId: string; kind: CredentialKind; field: string } | null {
  const texts: Array<{ raw: string; source: "name" | "label" }> = [];
  for (const name of signals.fieldNames ?? []) {
    if (name.trim()) texts.push({ raw: name, source: "name" });
  }
  for (const label of signals.fieldLabels ?? []) {
    if (label.trim()) texts.push({ raw: label, source: "label" });
  }
  for (const text of texts) {
    for (const pattern of FIELD_PATTERNS) {
      if (pattern.test.test(text.raw.replace(/([a-z])([A-Z])/g, "$1_$2"))) {
        return { providerId: pattern.providerId, kind: pattern.kind, field: text.raw };
      }
    }
  }
  return null;
}

function applicationVote(signals: DetectionSignals, page: ReturnType<typeof pageInfo>): string | null {
  const claimed = signals.application?.trim().toLowerCase() ?? "";
  const title = signals.pageTitle ?? "";
  for (const app of KNOWN_APPS) {
    const byClaim = claimed === app.id;
    const byTitle = app.title.test(title);
    const loopback = page?.host === "localhost" || page?.host === "127.0.0.1" || page?.host === "::1";
    const byPort = Boolean(loopback && page?.port && app.ports.includes(page.port));
    if (byClaim || byTitle || byPort) return app.id;
  }
  if (claimed && KNOWN_APPS.some((app) => app.id === claimed)) return claimed;
  return null;
}

function protocolKind(signals: DetectionSignals, page: ReturnType<typeof pageInfo>): CredentialKind | null {
  const raw = (signals.protocol ?? page?.protocol ?? "").toLowerCase();
  if (raw === "ftp" || raw === "sftp") return "ftp";
  return null;
}

function nameOf(providerId: string | null): string | null {
  if (!providerId) return null;
  return providerById(providerId)?.name ?? null;
}

function prompts(input: {
  providerName: string | null;
  kind: CredentialKind | null;
  application: string | null;
  pageHost: string;
}): { promptDe: string; promptEn: string } {
  const where = input.pageHost ? `${input.pageHost} · ` : "";
  if (input.kind === "api" && input.providerName && input.application) {
    return {
      promptDe: `${where}${input.application} richtet einen ${input.providerName}-Key ein. Passenden Key aus 4AllPass verwenden?`,
      promptEn: `${where}${input.application} is setting up a ${input.providerName} key. Use a matching key from 4AllPass?`,
    };
  }
  if (input.kind === "api" && input.providerName) {
    return {
      promptDe: `${where}${input.providerName}-Key erkannt. Passenden Key aus 4AllPass verwenden?`,
      promptEn: `${where}${input.providerName} key detected. Use a matching key from 4AllPass?`,
    };
  }
  if (input.kind === "ftp") {
    return {
      promptDe: `${where}FTP/SFTP-Zugang erkannt. Passenden Eintrag aus 4AllPass verwenden?`,
      promptEn: `${where}FTP/SFTP access detected. Use a matching 4AllPass entry?`,
    };
  }
  if (input.providerName) {
    return {
      promptDe: `${where}${input.providerName}-Anmeldung erkannt. Eintrag aus 4AllPass verwenden?`,
      promptEn: `${where}${input.providerName} login detected. Use a 4AllPass entry?`,
    };
  }
  return { promptDe: "", promptEn: "" };
}

function score(opts: {
  domain: ProviderResolution | null;
  field: { providerId: string; kind: CredentialKind } | null;
  application: string | null;
  protocol: CredentialKind | null;
  user: string | null;
  providerId: string | null;
  kind: CredentialKind | null;
}): { confidence: number; reasons: string[] } {
  const reasons: string[] = [];
  let domainHit = false;
  let fieldHit = false;
  let appHit = false;
  let protocolHit = false;
  let userHit = false;

  if (opts.domain?.providerId && opts.domain.providerId === opts.providerId) {
    domainHit = true;
    reasons.push(`domain:${opts.domain.providerId}`);
  }
  if (opts.field && opts.field.providerId === opts.providerId) {
    fieldHit = true;
    reasons.push(`field:${opts.field.providerId}`);
  }
  if (opts.application) {
    appHit = true;
    reasons.push(`application:${opts.application}`);
  }
  if (opts.protocol && opts.protocol === opts.kind) {
    protocolHit = true;
    reasons.push(`protocol:${opts.protocol}`);
  }
  if (opts.user && opts.user === opts.providerId) {
    userHit = true;
    reasons.push(`user:${opts.user}`);
  }

  const agreeing =
    Number(domainHit) + Number(fieldHit) + Number(userHit) + Number(protocolHit && opts.kind === "ftp");

  if (!opts.providerId && !opts.kind) {
    return { confidence: 0, reasons };
  }

  // A lone env-style field is easy to spoof. Never high.
  if (fieldHit && !domainHit && !userHit && !appHit) {
    return { confidence: FIELD_ONLY_MAX, reasons };
  }
  if (fieldHit && appHit && !domainHit && !userHit) {
    return { confidence: APP_FIELD_MAX, reasons };
  }
  if (userHit && (domainHit || fieldHit)) {
    return { confidence: 1, reasons };
  }
  if (domainHit && fieldHit) {
    return { confidence: 0.98, reasons };
  }
  if (domainHit) {
    return { confidence: opts.domain?.confidence ?? 0, reasons };
  }
  if (protocolHit && !opts.providerId) {
    return { confidence: 0.7, reasons };
  }
  if (userHit) {
    return { confidence: HIGH_MIN, reasons };
  }
  if (agreeing >= 2) {
    return { confidence: 0.9, reasons };
  }
  return { confidence: Math.min(FIELD_ONLY_MAX, 0.4), reasons };
}

export function detectSetup(signals: DetectionSignals = {}): SetupSuggestion {
  const page = pageInfo(signals.url);
  const pageHost = page
    ? page.port && page.port !== 80 && page.port !== 443
      ? `${page.host}:${page.port}`
      : page.host
    : "";

  const domain = signals.url ? resolveProvider(signals.url) : null;
  const field = fieldVote(signals);
  const application = applicationVote(signals, page);
  const protocol = protocolKind(signals, page);
  const user = signals.userSelection?.trim() ? signals.userSelection.trim() : null;
  const userProvider = user && providerById(user) ? user : null;

  let providerId: string | null = null;
  let kind: CredentialKind | null = null;

  if (userProvider) {
    providerId = userProvider;
    kind = field && field.providerId === userProvider ? field.kind : (protocol ?? "web-login");
  } else if (field && domain?.providerId && field.providerId !== domain.providerId) {
    // Conflict: do not pick a provider at high confidence. Prefer the field for
    // API-key pages (n8n on localhost is unknown domain); prefer domain when
    // there is no API field match — handled by the branches below.
    providerId = field.kind === "api" ? field.providerId : domain.providerId;
    kind = field.kind === "api" ? field.kind : "web-login";
  } else if (field) {
    providerId = field.providerId;
    kind = field.kind;
  } else if (domain?.providerId) {
    providerId = domain.providerId;
    kind = "web-login";
  } else if (protocol) {
    kind = protocol;
  }

  if (!providerId && !kind) {
    const blank = emptySuggestion(pageHost);
    if (application) blank.reasons = [`application:${application}`];
    blank.targetApplication = application;
    return blank;
  }

  const { confidence, reasons } = score({
    domain,
    field,
    application,
    protocol,
    user: userProvider,
    providerId,
    kind,
  });

  // Conflicting field vs domain: keep the suggestion but cap below high.
  let nextConfidence = confidence;
  if (field && domain?.providerId && field.providerId !== domain.providerId) {
    reasons.push("conflict:field-domain");
    nextConfidence = Math.min(nextConfidence, APP_FIELD_MAX);
  }

  const providerName = nameOf(providerId);
  const copy = prompts({
    providerName,
    kind,
    application,
    pageHost,
  });

  return {
    providerId,
    providerName,
    credentialKind: kind,
    targetApplication: application,
    matchedField: field?.field ?? null,
    pageHost,
    confidence: nextConfidence,
    requiresConfirmation: true,
    reasons,
    promptDe: copy.promptDe,
    promptEn: copy.promptEn,
  };
}

export const DETECT_FIELD_ONLY_MAX = FIELD_ONLY_MAX;
export const DETECT_HIGH_MIN = HIGH_MIN;
