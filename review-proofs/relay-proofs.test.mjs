/**
 * Adversarial review proofs — @4allpass/broker loopback relay.
 * Same origin/token logic as backend/app/broker.py.
 * Throwaway: demonstrates the findings, not part of the product test suite.
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import {
  browserGrantOrigin,
  createBroker,
  newBrokerToken,
  postJson,
} from "../packages/broker/src/relay.mjs";

const token = newBrokerToken();
const broker = createBroker({ token, port: 0, host: "127.0.0.1" });
const addr = await broker.listen(0);
const base = `http://127.0.0.1:${addr.port}`;
const UI_ORIGIN = "http://127.0.0.1:8788";

after(() => broker.close());

test("F-5 'browser Origin on the grant path is 403' only covers http/https", () => {
  assert.equal(browserGrantOrigin("https://evil.example"), true);
  assert.equal(browserGrantOrigin("http://127.0.0.1:8788"), true);
  // Origins a browser really does send that are NOT rejected:
  assert.equal(browserGrantOrigin("null"), false); // sandboxed iframe, data:, file:
  assert.equal(browserGrantOrigin("chrome-extension://abcdefghijklmnop"), false);
  assert.equal(browserGrantOrigin("moz-extension://abcdefghijklmnop"), false);
});

test("F-5b Origin: null passes the grant-path guard; https:// is 403", async () => {
  const body = { application: "n8n", provider: "GitHub", scope: ["repository.read"], ttl: 15 };

  // An http(s) Origin is refused outright.
  const blocked = await postJson(`${base}/v1/access/request`, {
    token,
    origin: "https://evil.example",
    body,
  });
  assert.equal(blocked.status, 403);

  // Origin: null (sandboxed iframe / data: / file:) is not an http(s) string,
  // so the guard never fires. The request reaches the relay logic and is only
  // answered "vault_locked" because no UI is polling.
  const through = await postJson(`${base}/v1/access/request`, {
    token,
    origin: "null",
    body,
  });
  assert.equal(through.status, 200);
  assert.deepEqual(through.json, { status: "denied", reason: "vault_locked" });

  // Same for a browser-extension origin.
  const ext = await postJson(`${base}/v1/access/request`, {
    token,
    origin: "chrome-extension://abcdefghijklmnop",
    body,
  });
  assert.equal(ext.status, 200);
  assert.deepEqual(ext.json, { status: "denied", reason: "vault_locked" });
});

test("F-6 pairing token holder can poll: it can steal and answer someone else's request", async () => {
  // The attacker is a second holder of the one shared pairing token.
  const attackerPoll = fetch(`${base}/v1/broker/poll`, {
    headers: { authorization: `Bearer ${token}`, origin: UI_ORIGIN },
  });
  await new Promise((r) => setTimeout(r, 50));

  // A legitimate agent asks for access.
  const agent = postJson(`${base}/v1/access/request`, {
    token,
    body: { application: "n8n", provider: "GitHub", scope: ["repository.read"], ttl: 15 },
  });

  const stolen = await (await attackerPoll).json();
  // The attacker — not the unlocked UI — now owns this request id.
  assert.equal(stolen.method, "POST /v1/access/request");
  assert.equal(stolen.body.application, "n8n");

  // No human ever saw a prompt. The attacker answers it.
  const decided = await postJson(`${base}/v1/broker/decide`, {
    token,
    origin: UI_ORIGIN,
    body: { v: 1, id: stolen.id, body: { status: "approved", access_token: "attacker-chosen", expires_in: 15 } },
  });
  assert.equal(decided.status, 200);

  const got = await agent;
  assert.deepEqual(got.json, { status: "approved", access_token: "attacker-chosen", expires_in: 15 });
});

test("F-7 relay compares the pairing token with !== (not constant time)", async () => {
  const src = await import("node:fs").then((fs) =>
    fs.promises.readFile(new URL("../packages/broker/src/relay.mjs", import.meta.url), "utf8"),
  );
  assert.match(src, /if \(bearer !== token\)/);
  assert.equal(src.includes("timingSafeEqual"), false);
});
