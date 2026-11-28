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
import { softDeleteEntryById } from "../../services/vault/entries.ts";

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

/**
 * A stable, serializable identity for one finding, used by the UI to track
 * which proposed changes are selected. Two preview runs over the same data
 * produce the same keys, so a selection made against one run still makes
 * sense if the panel recomputes after a rejected apply.
 */
export function cleanupFindingKey(finding: CleanupFinding): string {
  return finding.kind === "similar" ? `similar:${finding.entryIds.join(",")}` : `stale:${finding.entryId}`;
}

/**
 * How much payload a duplicate candidate carries, for picking a merge
 * survivor. Never inspects secret *values* — only whether optional fields are
 * present — so completeness can be computed without reading `password` or
 * `totpSecret` content into any log or UI.
 */
function completenessScore(entry: VaultEntry): number {
  const presence = [
    entry.notes,
    entry.totpSecret,
    entry.port,
    entry.protocol,
    entry.capabilities,
    entry.credentialType,
    entry.domain,
    entry.providerId,
    entry.url,
  ].filter((field) => field.trim() !== "").length;
  return presence + (entry.favorite ? 1 : 0);
}

/**
 * The survivor of a duplicate group: the most complete entry, newest first
 * on a tie, id as the final deterministic tiebreak. The other group members
 * are never dropped — the caller moves them to trash, never purges them.
 */
function pickSurvivor(group: VaultEntry[]): VaultEntry {
  return [...group].sort((a, b) => {
    const byCompleteness = completenessScore(b) - completenessScore(a);
    if (byCompleteness !== 0) return byCompleteness;
    return compareByRecency(a, b);
  })[0]!;
}

/**
 * Which id `applyCleanup` would actually keep for a similarity group — the
 * same completeness-then-recency rule `pickSurvivor` uses, not the preview's
 * newest-first `entryIds` order. A caller displaying "(kept)" must use this,
 * not `entryIds[0]`, or the label can name the wrong side (#279 review).
 */
export function survivorIdForGroup(group: SimilarGroup, entries: readonly VaultEntry[]): string | null {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const members = group.entryIds.map((id) => byId.get(id)).filter((entry): entry is VaultEntry => entry != null);
  if (members.length === 0) return null;
  return pickSurvivor(members).id;
}

export interface CleanupApplyResult {
  ok: true;
  /** The full entry array (active + trash) with the selected changes applied. */
  entries: VaultEntry[];
  /** Number of similarity groups merged (each moves all but the survivor to trash). */
  mergedGroups: number;
  /** Number of stale entries moved to trash. */
  staleTrashed: number;
  /** Every entry id that was moved to trash by this apply, for reporting — never a secret field. */
  trashedIds: string[];
}

export interface CleanupApplyRejected {
  ok: false;
  /** The analyzed entry set no longer matches the vault's current entries; recompute before applying. */
  reason: "stale-run";
}

/**
 * Applies a (possibly partial) selection of a `CleanupPreview`'s findings:
 * duplicates are merged by keeping the most complete/newest entry and moving
 * every other entry in that group to trash (soft delete, never a hard
 * delete); stale entries are moved to trash. Nothing is ever purged or
 * silently discarded — both sides of a merge remain recoverable in the
 * Papierkorb.
 *
 * Before touching anything, the current active entries are checked against
 * `run` with `runMatchesEntries`. If the vault changed since the preview was
 * computed, this rejects with `{ ok: false, reason: "stale-run" }` instead of
 * applying a decision that was made against outdated data — the caller must
 * recompute a fresh preview and let the user decide again.
 */
export function applyCleanup(
  allEntries: VaultEntry[],
  activeEntriesAtPreview: readonly VaultEntry[],
  run: CleanupRun,
  selectedKeys: ReadonlySet<string>,
  now: string = new Date().toISOString(),
): CleanupApplyResult | CleanupApplyRejected {
  if (!runMatchesEntries(run, activeEntriesAtPreview)) {
    return { ok: false, reason: "stale-run" };
  }

  let next = allEntries;
  let mergedGroups = 0;
  let staleTrashed = 0;
  const trashedIds: string[] = [];
  // An id a merge in this same apply just kept active. A separately selected
  // stale finding for that same id must not then trash it anyway — that
  // would both break the duplicate-group's own "(kept)" label and silently
  // leave the group with no active entry at all (#279 review).
  const protectedSurvivorIds = new Set<string>();

  for (const finding of run.preview.findings) {
    if (!selectedKeys.has(cleanupFindingKey(finding))) continue;

    if (finding.kind === "similar") {
      const group = finding.entryIds
        .map((id) => next.find((entry) => entry.id === id))
        .filter((entry): entry is VaultEntry => entry != null && entry.deletedAt == null);
      // Defensive: if the group already collapsed (e.g. a prior selection in
      // this same apply already trashed one side), skip rather than guess.
      if (group.length < 2) continue;
      const survivor = pickSurvivor(group);
      protectedSurvivorIds.add(survivor.id);
      for (const entry of group) {
        if (entry.id === survivor.id) continue;
        next = softDeleteEntryById(next, entry.id, now);
        trashedIds.push(entry.id);
      }
      mergedGroups += 1;
    } else {
      if (protectedSurvivorIds.has(finding.entryId)) continue;
      const entry = next.find((candidate) => candidate.id === finding.entryId);
      if (!entry || entry.deletedAt != null) continue;
      next = softDeleteEntryById(next, finding.entryId, now);
      trashedIds.push(finding.entryId);
      staleTrashed += 1;
    }
  }

  return { ok: true, entries: next, mergedGroups, staleTrashed, trashedIds };
}
