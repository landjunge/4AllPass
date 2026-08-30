import assert from "node:assert/strict";
import { test } from "node:test";
import {
  browserGrantOrigin,
  createBroker,
  newBrokerToken,
  originsFromEnv,
  postJson,
  pwaOriginAllowed,
  tokenMatches,
} from "../src/relay.mjs";

async function start() {
  const token = newBrokerToken();
  const broker = createBroker({ token, port: 0, host: "127.0.0.1" });
  const addr = await broker.listen(0);
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const base = `http://127.0.0.1:${port}`;
  return { broker, token, base };
}

test("local app origin is allowed to poll", () => {
  assert.equal(pwaOriginAllowed("http://127.0.0.1:8788"), true);
  assert.equal(pwaOriginAllowed("http://localhost:8788"), true);
  assert.equal(originsFromEnv("").includes("http://127.0.0.1:8788"), true);
});

test("pairing token is required", async () => {
  const { broker, base } = await start();
  try {
    const res = await postJson(`${base}/v1/access/request`, {
      token: "wrong",
      body: { application: "n8n", provider: "GitHub", scope: ["repository.read"], ttl: 15 },
    });
    assert.equal(res.status, 401);
    assert.equal(res.json.status, "denied");
  } finally {
    await broker.close();
  }
});

test("no vault poller is vault_locked, not a token", async () => {
  const { broker, token, base } = await start();
  try {
    const res = await postJson(`${base}/v1/access/request`, {
      token,
      body: { application: "n8n", provider: "GitHub", scope: ["repository.read"], ttl: 15 },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.status, "denied");
    assert.equal(res.json.reason, "vault_locked");
    assert.equal("access_token" in res.json, false);
  } finally {
    await broker.close();
  }
});

test("browser Origin on the grant path is rejected", async () => {
  const { broker, token, base } = await start();
  try {
    const res = await postJson(`${base}/v1/access/request`, {
      token,
      origin: "https://evil.example",
      body: { application: "n8n", provider: "GitHub", scope: ["repository.read"], ttl: 15 },
    });
    assert.equal(res.status, 403);
  } finally {
    await broker.close();
  }
});

test("n8n POST waits for PWA Allow and never logs the secret", async () => {
  const lines = [];
  const token = newBrokerToken();
  const broker = createBroker({
    token,
    port: 0,
    host: "127.0.0.1",
    log: { info: (...a) => lines.push(a.join(" ")), warn: (...a) => lines.push(a.join(" ")) },
  });
  const addr = await broker.listen(0);
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const base = `http://127.0.0.1:${port}`;
  const secret = "ghp_live-secret-must-not-log";
  const pwa = "http://127.0.0.1:5173";
  try {
    const poll = postJson(`${base}/v1/broker/poll`, { token, origin: pwa, method: "GET", body: undefined });
    await new Promise((r) => setTimeout(r, 40));
    const n8n = postJson(`${base}/v1/access/request`, {
      token,
      body: { application: "n8n", provider: "GitHub", scope: ["repository.read"], ttl: 15 },
    });
    const incoming = await poll;
    assert.equal(incoming.status, 200);
    assert.equal(incoming.json.method, "POST /v1/access/request");
    const decide = await postJson(`${base}/v1/broker/decide`, {
      token,
      origin: pwa,
      body: {
        v: 1,
        id: incoming.json.id,
        body: { status: "approved", access_token: secret, expires_in: 15 },
      },
    });
    assert.equal(decide.status, 200);
    const granted = await n8n;
    assert.equal(granted.json.status, "approved");
    assert.equal(granted.json.access_token, secret);
    assert.equal(JSON.stringify(lines).includes(secret), false);
  } finally {
    await broker.close();
  }
});

test("PWA origin allowlist and grant Origin helper", () => {
  assert.equal(pwaOriginAllowed("http://127.0.0.1:5173"), true);
  assert.equal(pwaOriginAllowed("https://evil.example"), false);
  assert.equal(browserGrantOrigin("https://evil.example"), true);
  assert.equal(browserGrantOrigin("null"), true);
  assert.equal(browserGrantOrigin(""), false);
  assert.equal(browserGrantOrigin(undefined), false);
});

test("pairing token compare rejects prefix and length mismatches", () => {
  const token = newBrokerToken();
  assert.equal(tokenMatches(token, token), true);
  assert.equal(tokenMatches("", token), false);
  assert.equal(tokenMatches(token, ""), false);
  assert.equal(tokenMatches(token.slice(1), token), false);
  const flipped = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
  assert.equal(tokenMatches(flipped, token), false);
});

test("second decide on the same id is 404 and does not reissue the secret", async () => {
  const lines = [];
  const token = newBrokerToken();
  const broker = createBroker({
    token,
    port: 0,
    host: "127.0.0.1",
    log: { info: (...a) => lines.push(a.join(" ")), warn: (...a) => lines.push(a.join(" ")) },
  });
  const addr = await broker.listen(0);
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const base = `http://127.0.0.1:${port}`;
  const secret = "ghp_live-secret-must-not-log";
  const pwa = "http://127.0.0.1:5173";
  try {
    const poll = postJson(`${base}/v1/broker/poll`, { token, origin: pwa, method: "GET", body: undefined });
    await new Promise((r) => setTimeout(r, 40));
    const n8n = postJson(`${base}/v1/access/request`, {
      token,
      body: { application: "n8n", provider: "GitHub", scope: ["repository.read"], ttl: 15 },
    });
    const incoming = await poll;
    const decideBody = {
      v: 1,
      id: incoming.json.id,
      body: { status: "approved", access_token: secret, expires_in: 15 },
    };
    const decide = await postJson(`${base}/v1/broker/decide`, { token, origin: pwa, body: decideBody });
    assert.equal(decide.status, 200);
    const granted = await n8n;
    assert.equal(granted.json.access_token, secret);
    const replay = await postJson(`${base}/v1/broker/decide`, { token, origin: pwa, body: decideBody });
    assert.equal(replay.status, 404);
    assert.notEqual(replay.json?.access_token, secret);
    assert.equal(JSON.stringify(lines).includes(secret), false);
  } finally {
    await broker.close();
  }
});

test("approved grant cannot be polled again; next request without a listener is vault_locked", async () => {
  const token = newBrokerToken();
  const broker = createBroker({ token, port: 0, host: "127.0.0.1" });
  const addr = await broker.listen(0);
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const base = `http://127.0.0.1:${port}`;
  const secret = "ghp_live-secret-must-not-log";
  const pwa = "http://127.0.0.1:5173";
  try {
    const poll = postJson(`${base}/v1/broker/poll`, { token, origin: pwa, method: "GET", body: undefined });
    await new Promise((r) => setTimeout(r, 40));
    const n8n = postJson(`${base}/v1/access/request`, {
      token,
      body: { application: "n8n", provider: "GitHub", scope: ["repository.read"], ttl: 15 },
    });
    const incoming = await poll;
    await postJson(`${base}/v1/broker/decide`, {
      token,
      origin: pwa,
      body: {
        v: 1,
        id: incoming.json.id,
        body: { status: "approved", access_token: secret, expires_in: 15 },
      },
    });
    const granted = await n8n;
    assert.equal(granted.json.status, "approved");
    const again = await postJson(`${base}/v1/access/request`, {
      token,
      body: { application: "n8n", provider: "GitHub", scope: ["repository.read"], ttl: 15 },
    });
    assert.equal(again.status, 200);
    assert.equal(again.json.status, "denied");
    assert.equal(again.json.reason, "vault_locked");
    assert.equal("access_token" in again.json, false);
  } finally {
    await broker.close();
  }
});
