import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ACCESS_TTL_SECONDS_MAX,
  STANDING_RATE_MAX,
  STANDING_RULE_MAX_AGE_MS,
  STANDING_TTL_SECONDS_MAX,
  decideAccess,
  decideStandingAccess,
  evaluatePolicy,
  parseAccessBody,
  takeRateSlot,
  type AccessRequest,
  type Credential,
  type StandingRule,
} from "../src/index.ts";

function github(over: Partial<Credential> = {}): Credential {
  return {
    id: "entry_github",
    provider: "GitHub",
    label: "GitHub",
    account: "personal",
    capabilities: ["repository.read"],
    ...over,
  };
}

function valve(): Credential {
  return {
    id: "entry_valve",
    provider: "lab-valve",
    label: "lab-valve",
    account: "personal",
    capabilities: ["valve.open"],
    riskClass: "actuation",
  };
}

const requesterId = "req:ed25519:" + "ab".repeat(32);

function req(over: Partial<AccessRequest> = {}): AccessRequest {
  return {
    application: "headless",
    provider: "GitHub",
    credential: "personal",
    scope: ["repository.read"],
    ttlSeconds: 60,
    requesterId,
    ...over,
  };
}

function rule(over: Partial<StandingRule> = {}): StandingRule {
  const createdAt = 1_000_000;
  return {
    requesterId,
    credentialId: "entry_github",
    provider: "GitHub",
    scope: ["repository.read"],
    riskClass: "data",
    createdAt,
    expiresAt: createdAt + STANDING_RULE_MAX_AGE_MS,
    maxTtlSeconds: STANDING_TTL_SECONDS_MAX,
    ...over,
  };
}

test("live n8n path is unchanged: policy-allow is still pending human", () => {
  const decision = evaluatePolicy(
    {
      application: "n8n",
      provider: "GitHub",
      credential: "personal",
      scope: ["repository.read"],
      ttlSeconds: 600,
    },
    [github()],
  );
  assert.equal(decision.decision, "allow");
  if (decision.decision === "allow") assert.equal(decision.riskClass, "data");
  assert.equal(
    decideAccess(
      {
        application: "n8n",
        provider: "GitHub",
        credential: "personal",
        scope: ["repository.read"],
        ttlSeconds: 600,
      },
      [github()],
    ).status,
    "pending",
  );
});

test("actuation credential is high-risk and still pending on the live path", () => {
  const decision = evaluatePolicy(
    {
      application: "n8n",
      provider: "lab-valve",
      credential: "personal",
      scope: ["valve.open"],
      ttlSeconds: 30,
    },
    [valve()],
  );
  assert.equal(decision.decision, "allow");
  if (decision.decision === "allow") {
    assert.equal(decision.riskClass, "actuation");
    assert.equal(decision.risk, true);
  }
});

test("standing data grant auto-approves with clamped TTL", () => {
  const { decision } = decideStandingAccess(req({ ttlSeconds: 10_000 }), [github()], [rule()], [], 1_000_100);
  assert.equal(decision.status, "approved");
  if (decision.status === "approved") {
    assert.equal(decision.ttlSeconds, STANDING_TTL_SECONDS_MAX);
    assert.equal(decision.riskClass, "data");
    assert.equal(decision.credentialId, "entry_github");
  }
});

test("actuation standing rule never auto-approves", () => {
  const { decision } = decideStandingAccess(
    req({ provider: "lab-valve", scope: ["valve.open"], ttlSeconds: 30 }),
    [valve()],
    [
      rule({
        credentialId: "entry_valve",
        provider: "lab-valve",
        scope: ["valve.open"],
        riskClass: "actuation",
      }),
    ],
    [],
    1_000_100,
  );
  assert.equal(decision.status, "pending");
  if (decision.status === "pending") {
    assert.equal(decision.reason, "actuation_requires_live");
    assert.equal(decision.riskClass, "actuation");
  }
});

test("actuation credential blocks standing even if the rule says data", () => {
  const { decision } = decideStandingAccess(
    req({ provider: "lab-valve", scope: ["valve.open"] }),
    [valve()],
    [
      rule({
        credentialId: "entry_valve",
        provider: "lab-valve",
        scope: ["valve.open"],
        riskClass: "data",
      }),
    ],
    [],
    1_000_100,
  );
  assert.equal(decision.status, "pending");
  if (decision.status === "pending") assert.equal(decision.reason, "actuation_requires_live");
});

test("missing standing rule is deny, not n8n string trust", () => {
  const { decision } = decideStandingAccess(req(), [github()], [], [], 1_000_100);
  assert.equal(decision.status, "denied");
  if (decision.status === "denied") assert.equal(decision.reason, "standing_unavailable");
});

test("expired standing rule is deny", () => {
  const createdAt = 1_000;
  const { decision } = decideStandingAccess(
    req(),
    [github()],
    [rule({ createdAt, expiresAt: createdAt + 10 })],
    [],
    createdAt + 11,
  );
  assert.equal(decision.status, "denied");
  if (decision.status === "denied") assert.equal(decision.reason, "standing_expired");
});

test("standing rule older than max age is deny even if expiresAt is far", () => {
  const createdAt = 1_000;
  const { decision } = decideStandingAccess(
    req(),
    [github()],
    [
      rule({
        createdAt,
        expiresAt: createdAt + STANDING_RULE_MAX_AGE_MS * 4,
      }),
    ],
    [],
    createdAt + STANDING_RULE_MAX_AGE_MS + 1,
  );
  assert.equal(decision.status, "denied");
  if (decision.status === "denied") assert.equal(decision.reason, "standing_expired");
});

test("rate limit is per requester and independent of the rule", () => {
  let stamps: number[] = [];
  const now = 5_000_000;
  for (let i = 0; i < STANDING_RATE_MAX; i++) {
    const slot = takeRateSlot(stamps, now + i);
    assert.equal(slot.ok, true);
    stamps = slot.timestamps;
  }
  const blocked = takeRateSlot(stamps, now);
  assert.equal(blocked.ok, false);
  const { decision } = decideStandingAccess(req(), [github()], [rule()], stamps, now);
  assert.equal(decision.status, "denied");
  if (decision.status === "denied") assert.equal(decision.reason, "rate_limited");
});

test("parseAccessBody rejects ttl above the hard max", () => {
  const bad = parseAccessBody({
    application: "n8n",
    provider: "GitHub",
    scope: ["repository.read"],
    ttl: ACCESS_TTL_SECONDS_MAX + 1,
  });
  assert.ok("status" in bad);
  if ("status" in bad) {
    assert.equal(bad.status, "denied");
    assert.equal(bad.reason, "ttl_too_large");
  }
  const ok = parseAccessBody({
    application: "n8n",
    provider: "GitHub",
    scope: ["repository.read"],
    ttl: 600,
    requesterId,
  });
  assert.ok(!("status" in ok));
  if (!("status" in ok)) assert.equal(ok.requesterId, requesterId);
});

test("standing does not treat application n8n as identity", () => {
  const { decision } = decideStandingAccess(
    req({ application: "n8n", requesterId: "req:ed25519:" + "cd".repeat(32) }),
    [github()],
    [rule()],
    [],
    1_000_100,
  );
  assert.equal(decision.status, "denied");
  if (decision.status === "denied") assert.equal(decision.reason, "standing_unavailable");
});
