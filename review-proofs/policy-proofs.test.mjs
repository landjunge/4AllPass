/**
 * Adversarial review proofs — @4allpass/core access policy.
 * Throwaway: demonstrates the findings, not part of the product test suite.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evaluatePolicy,
  decideAccess,
  issueGrant,
  parseAccessBody,
} from "../packages/core/src/index.ts";

function cred(over = {}) {
  return {
    id: "entry_github",
    provider: "GitHub",
    label: "GitHub",
    account: "personal",
    capabilities: ["repository.read"],
    ...over,
  };
}

function req(over = {}) {
  return {
    application: "n8n",
    provider: "GitHub",
    credential: "personal",
    scope: ["repository.read"],
    ttlSeconds: 600,
    ...over,
  };
}

test("F-1 provider match is a SUBSTRING match, not equality", () => {
  // The caller asks for provider "hub". The vault entry is "GitHub".
  const decision = evaluatePolicy(req({ provider: "hub" }), [cred()]);
  assert.equal(decision.decision, "allow");
  assert.equal(decision.credentialId, "entry_github");

  // One character is enough.
  assert.equal(evaluatePolicy(req({ provider: "i" }), [cred()]).decision, "allow");
  assert.equal(evaluatePolicy(req({ provider: "t" }), [cred()]).decision, "allow");
});

test("F-1b first substring hit wins across several entries", () => {
  const vault = [
    cred({ id: "entry_gitlab", provider: "GitLab work", label: "GitLab work", account: "" }),
    cred({ id: "entry_github", provider: "GitHub", label: "GitHub", account: "personal" }),
  ];
  // Human prompt will read "n8n requests git repository.read".
  const decision = evaluatePolicy(req({ provider: "git" }), vault);
  assert.equal(decision.decision, "allow");
  // GitLab's material is released, not GitHub's.
  assert.equal(decision.credentialId, "entry_gitlab");
});

test("F-2 TTL has no upper bound: a 'time-boxed' grant can outlive the decade", () => {
  const parsed = parseAccessBody({
    application: "n8n",
    provider: "GitHub",
    credential: "personal",
    scope: ["repository.read"],
    ttl: 315_360_000, // 10 years in seconds
  });
  assert.ok(!("status" in parsed));
  assert.equal(parsed.ttlSeconds, 315_360_000);
  const grant = issueGrant(parsed, "entry_github", 0);
  assert.equal(grant.expiresAt, 315_360_000_000);
  // decideAccess is happy too — nothing clamps it.
  assert.equal(decideAccess(parsed, [cred()]).status, "pending");
});

test("F-3 scope[0] is the only capability copied into grant.capability", () => {
  const both = cred({ capabilities: ["repository.read", "repository.delete"] });
  const decision = evaluatePolicy(
    req({ scope: ["repository.read", "repository.delete"] }),
    [both],
  );
  assert.equal(decision.decision, "allow");
  assert.equal(decision.risk, true); // risk flag is computed, at least
  const grant = issueGrant(req({ scope: ["repository.read", "repository.delete"] }), both.id, 0);
  assert.equal(grant.capability, "repository.read");
  assert.deepEqual(grant.scope, ["repository.read", "repository.delete"]);
});

test("F-4 application identity: whitespace/case variants of the allowlist pass", () => {
  for (const name of ["n8n", "N8N", "  n8n  ", "\tN8n\n"]) {
    assert.equal(evaluatePolicy(req({ application: name }), [cred()]).decision, "allow", name);
  }
  // ... and the raw string (with padding) is what the prompt renders.
  const grant = issueGrant(req({ application: "  N8N  " }), "entry_github", 0);
  assert.equal(grant.applicationId, "n8n");
});

test("control: unknown app and out-of-scope capability really are DENY", () => {
  assert.equal(
    evaluatePolicy(req({ application: "malicious-agent" }), [cred()]).reason,
    "application_not_allowed",
  );
  assert.equal(
    evaluatePolicy(req({ scope: ["repository.delete"] }), [cred()]).reason,
    "scope_not_permitted",
  );
});
