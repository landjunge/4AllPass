import assert from "node:assert/strict";
import { test } from "node:test";

import {
  auditContainsSecret,
  auditLine,
  decideAccess,
  evaluatePolicy,
  explainAccess,
  grantIsValid,
  issueGrant,
  parseAccessBody,
  whyContainsSecret,
  type AccessRequest,
  type Credential,
} from "../src/index.ts";

function github(): Credential {
  return {
    id: "entry_github",
    provider: "GitHub",
    label: "GitHub",
    account: "personal",
    capabilities: ["repository.read"],
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

test("1 repository.read is policy-allow (pending human, not auto-handoff)", () => {
  const decision = evaluatePolicy(req(), [github()]);
  assert.equal(decision.decision, "allow");
  if (decision.decision === "allow") {
    assert.equal(decision.credentialId, "entry_github");
    assert.equal(decision.risk, false);
  }
  assert.equal(decideAccess(req(), [github()]).status, "pending");
});

test("2 repository.delete is denied", () => {
  const decision = evaluatePolicy(req({ scope: ["repository.delete"] }), [github()]);
  assert.equal(decision.decision, "deny");
  if (decision.decision === "deny") assert.equal(decision.reason, "scope_not_permitted");
});

test("3 unknown application is denied", () => {
  const decision = evaluatePolicy(req({ application: "malicious-agent" }), [github()]);
  assert.equal(decision.decision, "deny");
  if (decision.decision === "deny") assert.equal(decision.reason, "application_not_allowed");
});

test("provider substring git does not match GitHub", () => {
  const decision = evaluatePolicy(req({ provider: "git" }), [github()]);
  assert.equal(decision.decision, "deny");
  if (decision.decision === "deny") assert.equal(decision.reason, "no_credential");
  assert.equal(evaluatePolicy(req({ provider: "hub" }), [github()]).decision, "deny");
  assert.equal(evaluatePolicy(req({ provider: "GitHub" }), [github()]).decision, "allow");
});

test("4 ttl <= 0 is malformed; expired grant is invalid", () => {
  const bad = parseAccessBody({
    application: "n8n",
    provider: "GitHub",
    scope: ["repository.read"],
    ttl: 0,
  });
  assert.ok("status" in bad);
  if ("status" in bad) assert.equal(bad.status, "denied");
  const grant = issueGrant(req({ ttlSeconds: 10 }), "entry_github", 1_000);
  assert.equal(grantIsValid(grant, 1_000), true);
  assert.equal(grantIsValid(grant, 1_000 + 10_000), false);
});

test("5 wrong capability is denied", () => {
  const decision = evaluatePolicy(req({ scope: ["sftp.read"] }), [github()]);
  assert.equal(decision.decision, "deny");
  if (decision.decision === "deny") assert.equal(decision.reason, "scope_not_permitted");
});

test("6 expired grant is invalid", () => {
  const grant = issueGrant(req({ ttlSeconds: 1 }), "entry_github", 5_000);
  assert.equal(grantIsValid(grant, 5_000 + 1_000), false);
  assert.ok(!("material" in grant));
  assert.ok(!("access_token" in grant));
});

test("explainAccess pending is human Allow, not auto-handoff, and omits secrets", () => {
  const verdict = decideAccess(req(), [github()]);
  const why = explainAccess(verdict);
  assert.equal(why.code, "pending_human_allow");
  assert.ok(why.why.includes("Allow"));
  assert.equal(whyContainsSecret(why, "ghp_live-secret-must-not-log"), false);
});

test("explainAccess unknown app DENY names the rule without secrets", () => {
  const verdict = decideAccess(req({ application: "malicious-agent" }), [github()]);
  assert.equal(verdict.status, "denied");
  const why = explainAccess(verdict);
  assert.equal(why.code, "application_not_allowed");
  assert.ok(why.why.includes("Unknown application"));
  assert.equal(whyContainsSecret(why, "ghp_live-secret-must-not-log"), false);
});

test("7 core works without browser APIs", () => {
  const g = globalThis as Record<string, unknown>;
  assert.equal(g.window, undefined);
  assert.equal(g.document, undefined);
  const verdict = decideAccess(req(), [github()]);
  assert.equal(verdict.status, "pending");
  const row = auditLine(req(), "APPROVED");
  assert.equal(auditContainsSecret(row, "ghp_live-secret-must-not-log"), false);
});
