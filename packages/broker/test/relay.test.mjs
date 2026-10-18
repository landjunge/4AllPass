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
    assert.equal(res.json.reason, "handoff_unavailable");
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

test("all legacy handoff modes fail closed and never queue plaintext", async () => {
  const { broker, token, base } = await start();
  try {
    for (const handoff of [undefined, "raw_secret", "mediated", "export"]) {
      const result = await postJson(`${base}/v1/access/request`, { token, body: { application: "n8n", provider: "GitHub", scope: ["repository.read"], ttl: 15, handoff } });
      assert.deepEqual(result.json, { status: "denied", reason: "handoff_unavailable" });
    }
  } finally { await broker.close(); }
});
test("origin and token comparisons preserve their boundary", () => {
  assert.equal(browserGrantOrigin("null"), true);
  assert.equal(browserGrantOrigin("https://evil.example"), true);
  assert.equal(browserGrantOrigin(undefined), false);
  assert.equal(tokenMatches("a", "b"), false);
  assert.equal(tokenMatches("a", "a"), true);
});
