import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  connectLocalBroker,
  disconnectLocalBroker,
  getBrokerClientState,
  onBrokerRequest,
  subscribeBrokerClient,
} from "./local-broker-client.ts";

const originalFetch = globalThis.fetch;
const dummyToken = "synthetic-pairing-only";
const url = "http://127.0.0.1:18799";
const message = { v: 1, method: "POST /v1/access/request", id: "synthetic-request" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

afterEach(() => {
  disconnectLocalBroker();
  onBrokerRequest(null);
  globalThis.fetch = originalFetch;
});

test("an outstanding first authenticated poll stays connecting", async () => {
  const response = deferred<Response>();
  globalThis.fetch = () => response.promise;
  connectLocalBroker(url, dummyToken);
  assert.equal(getBrokerClientState().status, "connecting");
  response.resolve(new Response(null, { status: 204 }));
  // Disconnect before the repeated poll can reuse this synthetic response.
  disconnectLocalBroker();
  await settle();
  assert.equal(getBrokerClientState().status, "off");
});

test("a successful empty poll establishes transport availability", async () => {
  let calls = 0;
  globalThis.fetch = async () => ++calls === 1
    ? new Response(null, { status: 204 }) : new Promise<Response>(() => {});
  connectLocalBroker(url, dummyToken);
  await settle();
  assert.equal(calls, 2);
  assert.equal(getBrokerClientState().status, "live");
});

test("a valid poll delivers the message after establishing availability", async () => {
  let calls = 0;
  const seen: unknown[] = [];
  globalThis.fetch = async () => ++calls === 1
    ? Response.json(message) : new Promise<Response>(() => {});
  onBrokerRequest((value) => {
    assert.equal(getBrokerClientState().status, "live");
    seen.push(value);
  });
  connectLocalBroker(url, dummyToken);
  await settle();
  assert.deepEqual(seen, [message]);
});

for (const status of [401, 403, 500]) {
  test(`HTTP ${status} cannot establish a live connection or deliver a body`, async () => {
    let delivered = 0;
    let calls = 0;
    globalThis.fetch = async () => ++calls === 1
      ? Response.json(message, { status }) : new Promise<Response>(() => {});
    onBrokerRequest(() => { delivered += 1; });
    connectLocalBroker(url, dummyToken);
    await settle();
    assert.equal(getBrokerClientState().status, "error");
    assert.equal(delivered, 0);
  });
}

test("malformed successful response is an error instead of a live connection", async () => {
  let calls = 0;
  globalThis.fetch = async () => ++calls === 1
    ? Response.json({ v: 99, method: "unexpected" }) : new Promise<Response>(() => {});
  connectLocalBroker(url, dummyToken);
  await settle();
  assert.equal(getBrokerClientState().status, "error");
});

test("a stopped session cannot deliver an already loading response", async () => {
  const body = deferred<unknown>();
  let delivered = 0;
  globalThis.fetch = async () => ({ status: 200, ok: true, json: () => body.promise }) as Response;
  onBrokerRequest(() => { delivered += 1; });
  connectLocalBroker(url, dummyToken);
  await settle();
  disconnectLocalBroker();
  body.resolve(message);
  await settle();
  assert.equal(delivered, 0);
  assert.equal(getBrokerClientState().status, "off");
});

test("a replaced session cannot publish an older response", async () => {
  const body = deferred<unknown>();
  let calls = 0;
  let delivered = 0;
  globalThis.fetch = async () => ++calls === 1
    ? ({ status: 200, ok: true, json: () => body.promise }) as Response
    : new Promise<Response>(() => {});
  onBrokerRequest(() => { delivered += 1; });
  connectLocalBroker(url, dummyToken);
  await settle();
  connectLocalBroker(url, "synthetic-replacement-only");
  body.resolve(message);
  await settle();
  assert.equal(delivered, 0);
  assert.equal(getBrokerClientState().status, "connecting");
});

test("a successful retry clears the previous transport error", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) throw new Error("synthetic transport failure");
    return calls === 2 ? new Response(null, { status: 204 }) : new Promise<Response>(() => {});
  };
  connectLocalBroker(url, dummyToken);
  await settle();
  assert.equal(getBrokerClientState().status, "error");
  const deadline = Date.now() + 3000;
  while (calls < 3 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(calls, 3);
  assert.equal(getBrokerClientState().status, "live");
  assert.equal(getBrokerClientState().error, "");
});

test("disconnecting from a live notification prevents message delivery", async () => {
  let delivered = 0;
  let calls = 0;
  globalThis.fetch = async () => ++calls === 1
    ? Response.json(message) : new Promise<Response>(() => {});
  onBrokerRequest(() => { delivered += 1; });
  const unsubscribe = subscribeBrokerClient(() => {
    if (getBrokerClientState().status === "live") disconnectLocalBroker();
  });
  try {
    connectLocalBroker(url, dummyToken);
    await settle();
    assert.equal(delivered, 0);
    assert.equal(getBrokerClientState().status, "off");
  } finally { unsubscribe(); }
});
