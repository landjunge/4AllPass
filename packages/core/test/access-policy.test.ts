import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_HANDOFF,
  auditContainsSecret,
  auditLine,
  decideAccess,
  effectiveHandoff,
  evaluatePolicy,
  explainAccess,
  grantIsValid,
  handoffIsAvailable,
  issueGrant,
  parseAccessBody,
  parseHandoff,
  resolveHandoff,
  whyContainsSecret,
  type AccessGrant,
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

/** Legacy metadata grant used only to exercise grant validity/expiry. */
function metadataGrant(over: Partial<AccessGrant> = {}): AccessGrant {
  return {
    id: "grant_test",
    requestId: "req_test",
    applicationId: "n8n",
    provider: "GitHub",
    capability: "repository.read",
    issuedAt: 1_000,
    expiresAt: 11_000,
    credentialId: "entry_github",
    scope: ["repository.read"],
    handoff: "raw_secret",
    ...over,
  };
}

test("1 repository.read is blocked until protected execution is connected", () => {
  const decision = evaluatePolicy(req(), [github()]);
  assert.equal(decision.decision, "deny");
  if (decision.decision === "deny") assert.equal(decision.reason, "handoff_unavailable");
  assert.equal(decideAccess(req(), [github()]).status, "denied");
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
  assert.equal(evaluatePolicy(req({ provider: "GitHub" }), [github()]).decision, "deny");
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
  const grant = metadataGrant({ expiresAt: 1_000 + 10_000 });
  assert.equal(grantIsValid(grant, 1_000), true);
  assert.equal(grantIsValid(grant, 1_000 + 10_000), false);
});

test("5 wrong capability is denied", () => {
  const decision = evaluatePolicy(req({ scope: ["sftp.read"] }), [github()]);
  assert.equal(decision.decision, "deny");
  if (decision.decision === "deny") assert.equal(decision.reason, "scope_not_permitted");
});

test("6 expired grant is invalid", () => {
  const grant = metadataGrant({ expiresAt: 5_000 + 1_000 });
  assert.equal(grantIsValid(grant, 5_000 + 1_000), false);
  assert.ok(!("material" in grant));
  assert.ok(!("access_token" in grant));
});

test("explainAccess pending is human Allow, not auto-handoff, and omits secrets", () => {
  const verdict = decideAccess(req(), [github()]);
  const why = explainAccess(verdict);
  assert.equal(why.code, "handoff_unavailable");
  assert.ok(why.why.includes("blocked"));
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

test("omitted handoff requests mediated and remains blocked", () => {
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

test("mediated handoff is denied, not silently turned into raw_secret", () => {
  const decision = evaluatePolicy(req({ handoff: "mediated" }), [github()]);
  assert.equal(decision.decision, "deny");
  if (decision.decision === "deny") assert.equal(decision.reason, "handoff_unavailable");
  assert.equal(decideAccess(req({ handoff: "mediated" }), [github()]).status, "denied");
});

test("unknown app is still DENY when it asks for mediated", () => {
  const decision = evaluatePolicy(
    req({ application: "malicious-agent", handoff: "mediated" }),
    [github()],
  );
  assert.equal(decision.decision, "deny");
  if (decision.decision === "deny") assert.equal(decision.reason, "application_not_allowed");
});

test("invalid handoff is malformed, not a secret path", () => {
  const bad = parseAccessBody({
    application: "n8n",
    provider: "GitHub",
    scope: ["repository.read"],
    ttl: 600,
    handoff: "env_export",
  });
  assert.ok("status" in bad);
  if ("status" in bad) assert.equal(bad.reason, "malformed_request");
});

test("issueGrant refuses every unavailable handoff and emits no grant", () => {
  const omitted = issueGrant(req(), "entry_github", 1_000);
  assert.deepEqual(omitted, { status: "denied", reason: "handoff_unavailable" });
  assert.equal("grant" in omitted, false);
  assert.deepEqual(issueGrant(req({ handoff: "raw_secret" }), "entry_github", 1_000), {
    status: "denied",
    reason: "handoff_unavailable",
  });
  assert.deepEqual(issueGrant(req({ handoff: "mediated" }), "entry_github", 1_000), {
    status: "denied",
    reason: "handoff_unavailable",
  });
});

test("omitted handoff uses the one shared default for parser and policy", () => {
  assert.equal(DEFAULT_HANDOFF, "mediated");
  assert.equal(effectiveHandoff(undefined), DEFAULT_HANDOFF);
  assert.equal(parseHandoff(undefined), DEFAULT_HANDOFF);
  assert.equal(parseHandoff(""), DEFAULT_HANDOFF);
  const parsed = parseAccessBody({
    application: "n8n",
    provider: "GitHub",
    scope: ["repository.read"],
    ttl: 600,
  });
  assert.ok(!("status" in parsed));
  if ("status" in parsed) return;
  assert.equal(parsed.handoff, DEFAULT_HANDOFF);
  assert.deepEqual(
    evaluatePolicy(req(), [github()]),
    evaluatePolicy(req({ handoff: DEFAULT_HANDOFF }), [github()]),
  );
});

test("a future reopen still resolves omission to the shared default, never raw_secret", () => {
  assert.equal(resolveHandoff(undefined, ["mediated"]), "mediated");
  assert.equal(resolveHandoff(undefined, ["raw_secret"]), null);
  assert.equal(resolveHandoff(undefined, []), null);
  assert.equal(handoffIsAvailable("raw_secret"), false);
  assert.equal(handoffIsAvailable("mediated"), false);
});

test("explainAccess mediated deny names the rule without secrets", () => {
  const verdict = decideAccess(req({ handoff: "mediated" }), [github()]);
  const why = explainAccess(verdict);
  assert.equal(why.code, "handoff_unavailable");
  assert.match(why.why, /Machine access blocked/);
  assert.equal(whyContainsSecret(why, "ghp_live-secret-must-not-log"), false);
});

test("7 core works without browser APIs", () => {
  const g = globalThis as Record<string, unknown>;
  assert.equal(g.window, undefined);
  assert.equal(g.document, undefined);
  const verdict = decideAccess(req(), [github()]);
  assert.equal(verdict.status, "denied");
  const row = auditLine(req(), "APPROVED");
  assert.equal(auditContainsSecret(row, "ghp_live-secret-must-not-log"), false);
});
