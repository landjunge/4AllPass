import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AccessClientError,
  DEFAULT_BROKER_URL,
  GitHub,
  assertLoopbackUrl,
  fourAllPass,
  redactGrant,
  redactSecrets,
} from "../src/index.ts";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("loopback URLs are accepted; remote URLs are not", () => {
  assert.equal(assertLoopbackUrl("http://127.0.0.1:8788").hostname, "127.0.0.1");
  assert.equal(assertLoopbackUrl("http://localhost:8787").hostname, "127.0.0.1");
  assert.equal(assertLoopbackUrl("http://localhost:8787").origin, "http://127.0.0.1:8787");
  assert.throws(
    () => fourAllPass({ token: "tok", url: "https://api.4allpass.example" }),
    (error: unknown) => error instanceof AccessClientError && error.code === "not_loopback",
  );
  assert.throws(
    () => fourAllPass({ token: "tok", url: "http://192.168.1.9:8788" }),
    (error: unknown) => error instanceof AccessClientError && error.code === "not_loopback",
  );
});

test("missing pairing token fails before fetch", async () => {
  const previous = process.env.FOURALLPASS_BROKER_TOKEN;
  delete process.env.FOURALLPASS_BROKER_TOKEN;
  try {
    let called = 0;
    const client = fourAllPass({
      url: DEFAULT_BROKER_URL,
      fetch: async () => {
        called += 1;
        return jsonResponse(200, { status: "denied", reason: "malformed_request" });
      },
    });
    await assert.rejects(
      client.request({ provider: GitHub.provider, capability: GitHub.repositoryRead, ttl: 15 }),
      (error: unknown) => error instanceof AccessClientError && error.code === "missing_token",
    );
    assert.equal(called, 0);
  } finally {
    if (previous === undefined) delete process.env.FOURALLPASS_BROKER_TOKEN;
    else process.env.FOURALLPASS_BROKER_TOKEN = previous;
  }
});

test("request POSTs JSON with Bearer and no Origin", async () => {
  let seen: { url: string; init: RequestInit } | undefined;
  const client = fourAllPass({
    token: "pairing-token-test",
    url: DEFAULT_BROKER_URL,
    application: "n8n",
    fetch: async (url, init) => {
      seen = { url: String(url), init: init ?? {} };
      return jsonResponse(200, {
        status: "approved",
        access_token: "ghp_demo-not-a-real-key",
        expires_in: 15,
      });
    },
  });
  const result = await client.request({
    provider: GitHub.provider,
    capability: GitHub.repositoryRead,
    ttl: 15,
  });
  assert.equal(result.status, "approved");
  if (result.status !== "approved") throw new Error("expected approved");
  assert.equal(result.accessToken, "ghp_demo-not-a-real-key");
  assert.equal(result.expiresIn, 15);
  assert.equal(seen?.url, "http://127.0.0.1:8788/v1/access/request");
  const headers = new Headers(seen?.init.headers);
  assert.equal(headers.get("Authorization"), "Bearer pairing-token-test");
  assert.equal(headers.get("Content-Type"), "application/json");
  assert.equal(headers.get("Origin"), null);
  assert.equal(seen?.init.method, "POST");
  const body = JSON.parse(String(seen?.init.body)) as Record<string, unknown>;
  assert.deepEqual(body, {
    application: "n8n",
    provider: "GitHub",
    credential: "personal",
    scope: ["repository.read"],
    ttl: 15,
  });
});

test("denied is a result, not a thrown secret", async () => {
  const client = fourAllPass({
    token: "pairing-token-test",
    url: DEFAULT_BROKER_URL,
    fetch: async () =>
      jsonResponse(200, { status: "denied", reason: "application_not_allowed" }),
  });
  const result = await client.request({
    provider: GitHub.provider,
    capability: GitHub.repositoryRead,
    ttl: 15,
    application: "malicious-agent",
  });
  assert.deepEqual(result, { status: "denied", reason: "application_not_allowed" });
  await assert.rejects(
    client.requestOrThrow({
      provider: GitHub.provider,
      capability: GitHub.repositoryDelete,
      ttl: 15,
    }),
    (error: unknown) =>
      error instanceof AccessClientError &&
      error.code === "denied" &&
      !error.message.includes("ghp_"),
  );
});

test("HTTP 403 (browser Origin on grant path) is denied, not a token leak", async () => {
  const client = fourAllPass({
    token: "pairing-token-test",
    url: DEFAULT_BROKER_URL,
    fetch: async () => jsonResponse(403, { status: "denied", reason: "malformed_request" }),
  });
  const result = await client.request({
    provider: GitHub.provider,
    capability: GitHub.repositoryRead,
    ttl: 15,
  });
  assert.equal(result.status, "denied");
});

test("redactGrant never includes the secret; error strings strip ghp_", () => {
  const shown = redactGrant({
    status: "approved",
    accessToken: "ghp_demo-not-a-real-key",
    expiresIn: 12,
  });
  assert.equal(shown.status, "approved");
  assert.equal(shown.access_token, "(redacted in this client)");
  assert.equal(JSON.stringify(shown).includes("ghp_"), false);
  const text = redactSecrets('boom {"access_token":"ghp_live-secret"}', ["ghp_live-secret"]);
  assert.equal(text.includes("ghp_live-secret"), false);
  assert.equal(text.includes("ghp_"), false);
});

test("capability list maps to scope; empty provider is refused", async () => {
  let body: Record<string, unknown> | undefined;
  const client = fourAllPass({
    token: "pairing-token-test",
    url: DEFAULT_BROKER_URL,
    fetch: async (_url, init) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse(200, { status: "denied", reason: "scope_not_permitted" });
    },
  });
  await client.request({
    provider: GitHub.provider,
    capabilities: [GitHub.repositoryRead, GitHub.issueRead],
    ttl: 60,
  });
  assert.deepEqual(body?.scope, ["repository.read", "issue.read"]);
  await assert.rejects(
    client.request({ provider: "  ", capability: GitHub.repositoryRead, ttl: 15 }),
    (error: unknown) => error instanceof AccessClientError && error.code === "malformed_request",
  );
});
