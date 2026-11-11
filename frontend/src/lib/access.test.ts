import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_HANDOFF,
  approvedResponse,
  auditContainsSecret,
  auditLine,
  decideAccess,
  explainAccess,
  issueGrant,
  parseAccessBody,
  readGrant,
  whyContainsSecret,
  wipeGrant,
  type AccessGrant,
  type AccessRequest,
} from "./access.ts";
import { emptyDraft, newEntryId, type VaultEntry } from "./entries.ts";

const secret = "ghp_live-secret-must-not-log";

function github(): VaultEntry {
  return {
    id: newEntryId(),
    ...emptyDraft("api"),
    title: "GitHub",
    provider: "GitHub",
    account: "personal",
    password: secret,
    capabilities: "repository.read",
    updatedAt: new Date().toISOString(),
  };
}

function req(over: Partial<AccessRequest> = {}): AccessRequest {
  return {
    application: "n8n",
    provider: "GitHub",
    credential: "personal",
    scope: ["repository.read"],
    ttlSeconds: 600,
    ...over,
  };
}

/** Grant shape a legacy in-memory caller could still hold. */
function legacyGrant(entry: VaultEntry, over: Partial<AccessGrant> = {}): AccessGrant {
  return {
    id: "grant_legacy",
    application: "n8n",
    provider: "GitHub",
    entryId: entry.id,
    scope: ["repository.read"],
    expiresAt: 11_000,
    material: "",
    handoff: "raw_secret",
    ...over,
  };
}

test("unknown application is DENY", () => {
  const verdict = decideAccess(req({ application: "malicious-agent" }), [github()]);
  assert.equal(verdict.status, "denied");
  if (verdict.status === "denied") assert.equal(verdict.reason, "application_not_allowed");
});

test("missing credential is DENY", () => {
  const verdict = decideAccess(req({ provider: "Stripe" }), [github()]);
  assert.equal(verdict.status, "denied");
  if (verdict.status === "denied") assert.equal(verdict.reason, "no_credential");
});

test("scope not on the entry is DENY", () => {
  const verdict = decideAccess(req({ scope: ["repository.delete"] }), [github()]);
  assert.equal(verdict.status, "denied");
  if (verdict.status === "denied") assert.equal(verdict.reason, "scope_not_permitted");
});

test("raw material never enters a machine grant; unavailable handoff is refused", () => {
  const entry = github();
  const request = req({ ttlSeconds: 10 });
  assert.equal(decideAccess(request, [entry]).status, "denied");
  assert.deepEqual(issueGrant(request, entry, 1_000), {
    status: "denied",
    reason: "handoff_unavailable",
  });
  const stale = legacyGrant(entry, { material: secret });
  assert.deepEqual(readGrant(stale, 1_000), { status: "denied", reason: "handoff_unavailable" });
  assert.equal(JSON.stringify(approvedResponse(stale, 1_000)).includes(secret), false);
});

test("empty provider is unknown_provider", () => {
  const verdict = decideAccess(req({ provider: "  " }), [github()]);
  assert.equal(verdict.status, "denied");
  if (verdict.status === "denied") assert.equal(verdict.reason, "unknown_provider");
});

test("revoked credential is DENY", () => {
  const entry = { ...github(), capabilities: "revoked" };
  const verdict = decideAccess(req(), [entry]);
  assert.equal(verdict.status, "denied");
  if (verdict.status === "denied") assert.equal(verdict.reason, "revoked_credential");
});

test("malformed POST body is DENY", () => {
  const bad = parseAccessBody({ application: "n8n", provider: "GitHub", scope: "read", ttl: 600 });
  assert.equal(bad.status, "denied");
  if (bad.status === "denied") assert.equal(bad.reason, "malformed_request");
});

test("ttl above the hard max is DENY, not a silent clamp in the parser", () => {
  const bad = parseAccessBody({
    application: "n8n",
    provider: "GitHub",
    scope: ["repository.read"],
    ttl: 86_401,
  });
  assert.equal(bad.status, "denied");
  if (bad.status === "denied") assert.equal(bad.reason, "ttl_too_large");
});

test("stale approved response is denied rather than returning access_token", () => {
  const stale = legacyGrant(github(), { material: secret });
  assert.deepEqual(approvedResponse(stale, 1_000), { status: "denied", reason: "handoff_unavailable" });
});

test("TTL expires later 4AllPass handoffs; the vault secret is not rotated", () => {
  const entry = github();
  const grant = legacyGrant(entry);
  assert.deepEqual(approvedResponse(grant, 1_000), { status: "denied", reason: "handoff_unavailable" });
  const expired = approvedResponse(grant, grant.expiresAt);
  assert.equal(expired.status, "denied");
  if (expired.status === "denied") assert.equal(expired.reason, "handoff_unavailable");
  assert.deepEqual(readGrant(grant, grant.expiresAt), { status: "denied", reason: "handoff_unavailable" });
  assert.equal(entry.password, secret);
  const wiped = wipeGrant(grant);
  assert.equal(wiped.material, "");
});

test("mediated handoff is denied and never copies the secret", () => {
  const entry = github();
  const verdict = decideAccess(req({ handoff: "mediated" }), [entry]);
  assert.equal(verdict.status, "denied");
  if (verdict.status === "denied") assert.equal(verdict.reason, "handoff_unavailable");
  assert.deepEqual(issueGrant(req({ handoff: "mediated" }), entry, 1_000), {
    status: "denied",
    reason: "handoff_unavailable",
  });
  assert.equal(entry.password, secret);
});

test("issueGrant never mints a grant for an unavailable handoff", () => {
  const entry = github();
  assert.deepEqual(issueGrant(req(), entry, 1_000), {
    status: "denied",
    reason: "handoff_unavailable",
  });
  assert.deepEqual(issueGrant(req({ handoff: "raw_secret" }), entry, 1_000), {
    status: "denied",
    reason: "handoff_unavailable",
  });
  assert.deepEqual(issueGrant(req({ handoff: "mediated" }), entry, 1_000), {
    status: "denied",
    reason: "handoff_unavailable",
  });
});

test("omitted handoff uses the shared default and remains blocked", () => {
  assert.equal(DEFAULT_HANDOFF, "mediated");
  const parsed = parseAccessBody({
    application: "n8n",
    provider: "GitHub",
    scope: ["repository.read"],
    ttl: 600,
  });
  assert.ok(!("status" in parsed));
  if ("status" in parsed) return;
  assert.equal(parsed.handoff, DEFAULT_HANDOFF);
  assert.equal(decideAccess(parsed, [github()]).status, "denied");
});

test("application n8n is policy metadata, not proof of process identity", () => {
  const spoofed = decideAccess(req({ application: "n8n" }), [github()]);
  assert.equal(spoofed.status, "denied");
  const unknown = decideAccess(req({ application: "malicious-agent" }), [github()]);
  assert.equal(unknown.status, "denied");
});

test("audit rows never contain the secret", () => {
  const row = auditLine(req(), "APPROVED");
  assert.equal(auditContainsSecret(row, secret), false);
  assert.equal(JSON.stringify(row).includes(secret), false);
  assert.equal(row.ttlSeconds, 600);
});

test("explainAccess why never contains the vault secret", () => {
  const denied = decideAccess(req({ application: "malicious-agent" }), [github()]);
  const why = explainAccess(denied);
  assert.equal(whyContainsSecret(why, secret), false);
  assert.equal(why.why.includes(secret), false);
  const pending = decideAccess(req(), [github()]);
  assert.equal(explainAccess(pending).code, "handoff_unavailable");
});
