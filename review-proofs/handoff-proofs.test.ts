/**
 * Adversarial review proofs — what the "time-boxed access_token" actually is,
 * and what the unlocked UI will talk to.
 * Throwaway: demonstrates the findings, not part of the product test suite.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  approvedResponse,
  capabilitiesOf,
  credentialFromEntry,
  decideAccess,
  issueGrant,
} from "../frontend/src/lib/access.ts";
import type { VaultEntry } from "../frontend/src/lib/entries.ts";

const LIVE_PAT = "ghp_thisIsTheLongLivedPersonalAccessToken";

function githubEntry(over: Partial<VaultEntry> = {}): VaultEntry {
  return {
    id: "entry_github",
    kind: "api",
    title: "GitHub",
    provider: "GitHub",
    account: "personal",
    username: "ada",
    password: LIVE_PAT,
    url: "https://github.com",
    notes: "",
    capabilities: "repository.read",
    totpSecret: "",
    ...(over as VaultEntry),
  } as VaultEntry;
}

test("F-8 the granted access_token IS the stored long-lived secret, byte for byte", () => {
  const entry = githubEntry();
  const request = {
    application: "n8n",
    provider: "GitHub",
    credential: "personal",
    scope: ["repository.read"],
    ttlSeconds: 600,
  };
  assert.equal(decideAccess(request, [entry]).status, "pending");

  const grant = issueGrant(request, entry);
  assert.equal(grant.material, LIVE_PAT);

  const response = approvedResponse(grant, Date.now());
  assert.equal(response.status, "approved");
  // This is what n8n receives. Not a derived, scoped or provider-issued token.
  assert.equal(response.access_token, LIVE_PAT);
  assert.equal(response.expires_in, 600);
});

test("F-8b TTL expiry only stops the local re-read; the provider secret is unchanged", () => {
  const entry = githubEntry();
  const request = {
    application: "n8n",
    provider: "GitHub",
    credential: "personal",
    scope: ["repository.read"],
    ttlSeconds: 1,
  };
  const grant = issueGrant(request, entry, 1_000);
  assert.equal(approvedResponse(grant, 1_000).status, "approved");
  const later = approvedResponse(grant, 3_000);
  assert.equal(later.status, "denied");
  // The copy handed out at t=1000 is still a valid GitHub PAT forever.
  assert.equal(entry.password, LIVE_PAT);
});

test("F-9 an entry with no capabilities silently gains repository.read / sftp.read", () => {
  const api = githubEntry({ capabilities: "" });
  assert.deepEqual(capabilitiesOf(api), ["repository.read"]);
  assert.deepEqual(credentialFromEntry(api).capabilities, ["repository.read"]);

  const sftp = githubEntry({ capabilities: "", kind: "sftp" as VaultEntry["kind"] });
  assert.deepEqual(capabilitiesOf(sftp), ["sftp.read"]);

  // So a never-configured API entry answers a repository.read request.
  const decision = decideAccess(
    {
      application: "n8n",
      provider: "GitHub",
      credential: "personal",
      scope: ["repository.read"],
      ttlSeconds: 600,
    },
    [api],
  );
  assert.equal(decision.status, "pending");
});

test("F-10 connectLocalBroker accepts a non-loopback broker URL", async () => {
  const client = await import("../frontend/src/lib/local-broker-client.ts");
  client.connectLocalBroker("https://relay.evil.example", "attacker-pairing-token");
  const state = client.getBrokerClientState();
  // No loopback assertion anywhere in this module, unlike @4allpass/access.
  assert.equal(state.status, "live");
  assert.equal(state.url, "https://relay.evil.example");
  client.disconnectLocalBroker();

  const src = await import("node:fs").then((fs) =>
    fs.promises.readFile(
      new URL("../frontend/src/lib/local-broker-client.ts", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(src.includes("assertLoopback"), false);
  assert.equal(src.includes("127.0.0.1") && src.includes("hostname"), false);
});
