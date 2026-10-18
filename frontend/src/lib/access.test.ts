import assert from "node:assert/strict";
import { test } from "node:test";

import {
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

test("raw material never enters a machine grant, even if policy is bypassed", () => {
  const entry = github();
  const request = req({ ttlSeconds: 10 });
  assert.equal(decideAccess(request, [entry]).status, "denied");
  const grant = issueGrant(request, entry, 1_000);
  assert.equal(grant.material, "");
  assert.deepEqual(readGrant({ ...grant, material: secret }, 1_000), { status: "denied", reason: "handoff_unavailable" });
  assert.equal(JSON.stringify(approvedResponse({ ...grant, material: secret }, 1_000)).includes(secret), false);
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
  const grant = issueGrant(req(), github(), 1_000);
  assert.deepEqual(approvedResponse({ ...grant, material: secret }, 1_000), { status: "denied", reason: "handoff_unavailable" });
});

test("TTL expires later 4AllPass handoffs; the vault secret is not rotated", () => {
  const entry = github();
  const grant = issueGrant(req({ ttlSeconds: 10 }), entry, 1_000);
  const expired = approvedResponse(grant, 1_000 + 10_000);
  assert.equal(expired.status, "denied");
  if (expired.status === "denied") assert.equal(expired.reason, "handoff_unavailable");
  assert.deepEqual(readGrant(grant, 1_000 + 10_000), { status: "denied", reason: "handoff_unavailable" });
  assert.equal(entry.password, secret);
  const wiped = wipeGrant(grant);
  assert.equal(wiped.material, "");
});

test("mediated handoff is denied and never copies the secret", () => {
  const entry = github();
  const verdict = decideAccess(req({ handoff: "mediated" }), [entry]);
  assert.equal(verdict.status, "denied");
  if (verdict.status === "denied") assert.equal(verdict.reason, "handoff_unavailable");
  assert.equal(entry.password, secret);
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
