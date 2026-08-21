import assert from "node:assert/strict";
import { test } from "node:test";

import { decideAccess, issueGrant, readGrant } from "./access.ts";
import {
  DEMO_DUMMY_TOKEN,
  DEMO_TTL_SECONDS,
  DEMO_WALKTHROUGH,
  demoDeleteRequest,
  demoGithubDraft,
  demoReadRequest,
  demoSceneCopy,
  demoUnknownRequest,
  hasGithubReadCredential,
  nextDemoScene,
  redactToken,
  remainingSeconds,
  startingScene,
} from "./access-demo.ts";
import { newEntryId, type VaultEntry } from "./entries.ts";

function seeded(): VaultEntry {
  return { id: newEntryId(), ...demoGithubDraft(), updatedAt: new Date().toISOString() };
}

test("walkthrough order is read → delete → expire → unknown → done", () => {
  assert.deepEqual(DEMO_WALKTHROUGH, ["read", "delete", "expire", "unknown", "done"]);
  assert.equal(nextDemoScene("setup"), "read");
  assert.equal(nextDemoScene("read"), "delete");
  assert.equal(nextDemoScene("delete"), "expire");
  assert.equal(nextDemoScene("expire"), "unknown");
  assert.equal(nextDemoScene("unknown"), "done");
  assert.equal(nextDemoScene("done"), "done");
});

test("empty vault starts on setup; GitHub read credential starts on read", () => {
  assert.equal(startingScene([]), "setup");
  assert.equal(hasGithubReadCredential([]), false);
  const entry = seeded();
  assert.equal(hasGithubReadCredential([entry]), true);
  assert.equal(startingScene([entry]), "read");
});

test("Allow n8n GitHub read → works → delete DENY → expire → unknown DENY", () => {
  const entry = seeded();
  const read = demoReadRequest();
  assert.equal(decideAccess(read, [entry]).status, "pending");
  const grant = issueGrant(read, entry, 1_000);
  const live = readGrant(grant, 1_000);
  assert.ok("material" in live);
  if ("material" in live) assert.equal(live.material, DEMO_DUMMY_TOKEN);

  const del = decideAccess(demoDeleteRequest(), [entry]);
  assert.equal(del.status, "denied");
  if (del.status === "denied") assert.equal(del.reason, "scope_not_permitted");

  const dead = readGrant(grant, 1_000 + DEMO_TTL_SECONDS * 1000);
  assert.equal(dead.status, "denied");
  if (dead.status === "denied") assert.equal(dead.reason, "expired");

  const unknown = decideAccess(demoUnknownRequest(), [entry]);
  assert.equal(unknown.status, "denied");
  if (unknown.status === "denied") assert.equal(unknown.reason, "application_not_allowed");
});

test("demo seed is read-only and is not a live GitHub PAT", () => {
  const draft = demoGithubDraft();
  assert.equal(draft.provider, "GitHub");
  assert.equal(draft.capabilities, "repository.read");
  assert.equal(draft.password, DEMO_DUMMY_TOKEN);
  assert.ok(DEMO_DUMMY_TOKEN.startsWith("ghp_demo"));
  assert.equal(draft.password.includes("github_pat_"), false);
});

test("redacted token never contains the secret body", () => {
  const shown = redactToken(DEMO_DUMMY_TOKEN);
  assert.equal(shown.includes("not-a-real-key"), false);
  assert.ok(shown.startsWith("ghp_"));
  assert.ok(shown.endsWith("••••"));
});

test("remaining seconds hits zero at expiry", () => {
  assert.equal(remainingSeconds(5_000, 5_000), 0);
  assert.equal(remainingSeconds(6_500, 5_000), 2);
});

test("scene copy does not include the dummy token", () => {
  for (const id of ["setup", "read", "delete", "expire", "unknown", "done"] as const) {
    const copy = demoSceneCopy(id);
    assert.equal(JSON.stringify(copy).includes(DEMO_DUMMY_TOKEN), false);
  }
});
