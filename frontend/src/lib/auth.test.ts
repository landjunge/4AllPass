import assert from "node:assert/strict";
import { test } from "node:test";

import { api } from "./api.ts";

test("account requests send the session cookie and no Authorization header", async () => {
  const calls: RequestInit[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(init ?? {});
    return new Response(
      JSON.stringify({ id: "u1", email: "a@example.com", createdAt: "2026-01-01T00:00:00Z" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    const account = await api.login("a@example.com", "account-password-1234");
    assert.equal(account.email, "a@example.com");
    assert.equal(calls[0]?.credentials, "include");
    const headers = new Headers(calls[0]?.headers);
    assert.equal(headers.has("Authorization"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
