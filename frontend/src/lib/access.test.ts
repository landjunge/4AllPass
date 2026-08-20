import assert from "node:assert/strict";
import { test } from "node:test";

import {
  auditContainsSecret,
  auditLine,
  decideAccess,
  issueGrant,
  readGrant,
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

test("n8n GitHub read can be approved then expires", () => {
  const entry = github();
  const request = req({ ttlSeconds: 10 });
  const verdict = decideAccess(request, [entry]);
  assert.equal(verdict.status, "pending");
  const grant = issueGrant(request, entry, 1_000);
  const live = readGrant(grant, 1_000);
  assert.ok("material" in live);
  if ("material" in live) assert.equal(live.material, secret);
  const dead = readGrant(grant, 1_000 + 10_000);
  assert.equal(dead.status, "denied");
  if (dead.status === "denied") assert.equal(dead.reason, "expired");
  const wiped = wipeGrant(grant);
  assert.equal(wiped.material, "");
});

test("audit rows never contain the secret", () => {
  const row = auditLine(req(), "APPROVED");
  assert.equal(auditContainsSecret(row, secret), false);
  assert.equal(JSON.stringify(row).includes(secret), false);
});
