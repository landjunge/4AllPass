/**
 * Client-side vault hygiene analysis (P0 „Aufräumen“ slice).
 *
 * Pure and read-only: it only inspects the already-unlocked plaintext entries
 * and returns a *change preview*. It never mutates entries, never writes to the
 * vault, never calls crypto or the network, and never copies a secret field
 * (`password`, `notes`, `totpSecret`) into any result.
 *
 * The preview is deliberately **recommendation-free**: it groups entries that
 * look like the same account into *similarity candidates* for a later,
 * explicit user review, and flags *stale* entries. It never proposes which
 * entry to keep or remove — a same `password` does not prove redundancy when
 * `notes`, `totpSecret` or other payload fields differ, so no removal is ever
 * recommended by this function.
 *
 * Grouping uses an **exact service boundary**: `kind` + `protocol` + `port` +
 * full host (lowercased for DNS case-insensitivity only — `www.` and any port
 * are preserved) + the case-preserved identity (`username`, else `account`).
 * The host is taken from the entry's `host`/`domain`, else parsed from `url`
 * (scheme and explicit port included when present).
 */
import type { EntryKind, VaultEntry } from "../../types/vault.ts";

/** Default stale threshold: one year without an update. */
export const DEFAULT_STALE_AFTER_DAYS = 365;

interface ServiceBoundary {
  kind: EntryKind;
  protocol: string;
  port: string;
  host: string;
  identity: string;
}

export interface SimilarGroup {
  kind: "similar";
  /** Exact host (lowercased only; `www.` and port preserved). */
  host: string;
  /** Case-preserved identity (trimmed username or account). Display, not a secret. */
  identity: string;
  entryKind: EntryKind;
  protocol: string;
  port: string;
  /** Candidate entries, newest first (ties by id). No removal recommendation. */
  entryIds: string[];
  titles: string[];
}

export interface StaleFinding {
  kind: "stale";
  entryId: string;
  title: string;
  lastUpdated: string;
  ageDays: number;
}

export type CleanupFinding = SimilarGroup | StaleFinding;

export interface CleanupPreview {
  findings: CleanupFinding[];
  summary: {
    similarGroups: number;
    stale: number;
  };
}

export interface CleanupOptions {
  staleAfterDays?: number;
  /** Clock override for tests. Defaults to the current time. */
  now?: Date;
}

const DAY_MS = 86_400_000;

function schemeOf(value: string): string {
  return value.trim().toLowerCase().replace(/:$/, "");
}

function serviceBoundaryOf(entry: VaultEntry): ServiceBoundary | null {
  // Case is preserved for identity: without an explicit service contract,
  // `Alice` and `alice` must not be folded together (e.g. SSH usernames).
  const identity = (entry.username || entry.account || "").trim();

  const explicitHost = (entry.host || "").trim().toLowerCase();
  const domain = (entry.domain || "").trim().toLowerCase();
  let protocol = schemeOf(entry.protocol);
  let port = entry.port.trim();

  let urlHost = "";
  let urlProtocol = "";
  let urlPort = "";
  if (entry.url) {
    try {
      const url = new URL(entry.url);
      urlHost = url.hostname.toLowerCase();
      urlProtocol = schemeOf(url.protocol);
      urlPort = url.port;
    } catch {
      // Invalid URL: no hostname/protocol/port to take from it.
    }
  }

  // Exact web boundary prefers the parsed URL hostname over `domain` metadata,
  // so `www.example.com` and `example.com` never collapse into one group. An
  // explicit `host` field stays authoritative for non-web protocols (e.g. sftp)
  // that carry no URL.
  const host =
    entry.kind === "web"
      ? urlHost || explicitHost || domain
      : explicitHost || urlHost || domain;

  if (!protocol) protocol = urlProtocol;
  if (!port) port = urlPort;

  if (!host || !identity) return null;
  return { kind: entry.kind, protocol, port, host, identity };
}

function ageInDays(updatedAt: string, now: Date): number {
  const parsed = Date.parse(updatedAt);
  if (Number.isNaN(parsed)) return 0;
  return Math.max(0, Math.floor((now.getTime() - parsed) / DAY_MS));
}

/** Invalid or unparseable dates sort as the oldest; finite values compare by epoch. */
function epochOf(updatedAt: string): number {
  const parsed = Date.parse(updatedAt);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

/** Newest first; ties break on the smaller id for deterministic output. */
function compareByRecency(a: VaultEntry, b: VaultEntry): number {
  const aTime = epochOf(a.updatedAt);
  const bTime = epochOf(b.updatedAt);
  if (aTime < bTime) return 1;
  if (aTime > bTime) return -1;
  return a.id.localeCompare(b.id);
}

export function previewCleanup(entries: VaultEntry[], options: CleanupOptions = {}): CleanupPreview {
  const staleAfterDays = options.staleAfterDays ?? DEFAULT_STALE_AFTER_DAYS;
  const now = options.now ?? new Date();

  const byKey = new Map<string, { service: ServiceBoundary; entries: VaultEntry[] }>();
  for (const entry of entries) {
    const service = serviceBoundaryOf(entry);
    if (!service) continue;
    const key = [service.kind, service.protocol, service.port, service.host, service.identity].join("\u0000");
    const bucket = byKey.get(key);
    if (bucket) bucket.entries.push(entry);
    else byKey.set(key, { service, entries: [entry] });
  }

  const findings: CleanupFinding[] = [];
  let similarGroups = 0;

  for (const { service, entries: group } of byKey.values()) {
    if (group.length < 2) continue;
    similarGroups += 1;
    const ordered = [...group].sort(compareByRecency);
    findings.push({
      kind: "similar",
      host: service.host,
      identity: service.identity,
      entryKind: service.kind,
      protocol: service.protocol,
      port: service.port,
      entryIds: ordered.map((entry) => entry.id),
      titles: ordered.map((entry) => entry.title),
    });
  }

  let stale = 0;
  for (const entry of entries) {
    const age = ageInDays(entry.updatedAt, now);
    if (age >= staleAfterDays) {
      stale += 1;
      findings.push({
        kind: "stale",
        entryId: entry.id,
        title: entry.title,
        lastUpdated: entry.updatedAt,
        ageDays: age,
      });
    }
  }

  return {
    findings,
    summary: { similarGroups, stale },
  };
}

/** A computed preview plus the exact entry set it was computed from. */
export interface CleanupRun {
  /** The entry array this preview was computed from (compared by reference). */
  entries: readonly VaultEntry[];
  preview: CleanupPreview;
}

/**
 * A stored preview stays valid only while the analyzed entry set is still the
 * one on screen. Entries are replaced immutably — a history restore or any edit
 * commits a new array — so reference equality is a precise binding: when the
 * entries change, the old preview is discarded and a fresh explicit click is
 * required. The panel never auto-reanalyzes.
 */
export function runMatchesEntries(run: CleanupRun | null, entries: readonly VaultEntry[]): boolean {
  return run !== null && run.entries === entries;
}
