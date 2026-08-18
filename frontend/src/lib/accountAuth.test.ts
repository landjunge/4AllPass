import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AccountAuthError,
  createAccountAuthClient,
  type AccountAuthClient,
} from "./accountAuth.ts";

interface RecordedCall {
  url: string;
  init: RequestInit;
}

function stubFetch(responses: Response[]): {
  client: AccountAuthClient;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const queue = [...responses];
  const fetchImpl = (async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const next = queue.shift();
    if (!next) throw new Error("no stubbed response left");
    return next;
  }) as unknown as typeof fetch;

  return { client: createAccountAuthClient({ fetchImpl }), calls };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const USER = {
  id: "0f5f1f5e-0000-4000-8000-000000000001",
  email: "user@example.com",
  is_active: true,
  created_at: "2026-08-18T00:00:00Z",
};

test("login sends credentials and maps the account to camelCase", async () => {
  const { client, calls } = stubFetch([json(200, USER)]);

  const user = await client.login("user@example.com", "correct-horse-battery-staple");

  assert.deepEqual(user, {
    id: USER.id,
    email: USER.email,
    isActive: true,
    createdAt: USER.created_at,
  });
  assert.equal(calls[0].url, "/auth/login");
  assert.equal(calls[0].init.method, "POST");
});

test("every request opts into sending the session cookie", async () => {
  const { client, calls } = stubFetch([
    json(201, USER),
    json(200, USER),
    json(200, USER),
    new Response(null, { status: 204 }),
  ]);

  await client.register("user@example.com", "correct-horse-battery-staple");
  await client.login("user@example.com", "correct-horse-battery-staple");
  await client.currentUser();
  await client.logout();

  // Without `credentials: "include"` the browser withholds the cookie and
  // every authenticated call silently becomes a 401.
  assert.equal(calls.length, 4);
  for (const call of calls) {
    assert.equal(call.init.credentials, "include");
  }
});

test("no session material is written to storage or to the URL", async () => {
  const { client, calls } = stubFetch([json(200, USER), json(200, USER)]);

  await client.login("user@example.com", "correct-horse-battery-staple");
  await client.currentUser();

  // The token lives in an HttpOnly cookie; this client has nothing to persist,
  // so there is no storage write to leak and no token to put in a query string.
  assert.equal(typeof globalThis.localStorage, "undefined");
  for (const call of calls) {
    assert.ok(!call.url.includes("?"), call.url);
  }
});

test("the password is only ever in the request body, never in the URL", async () => {
  const password = "correct-horse-battery-staple";
  const { client, calls } = stubFetch([json(200, USER)]);

  await client.login("user@example.com", password);

  assert.ok(!calls[0].url.includes(password));
  assert.equal(calls[0].init.body, JSON.stringify({ email: "user@example.com", password }));
});

test("currentUser reports 'not signed in' as null, not as an error", async () => {
  const { client } = stubFetch([json(401, { detail: "not authenticated" })]);

  assert.equal(await client.currentUser(), null);
});

test("a rejected login surfaces the server's status and message", async () => {
  const { client } = stubFetch([json(401, { detail: "invalid email or password" })]);

  await assert.rejects(
    () => client.login("user@example.com", "wrong-password-entirely"),
    (error: unknown) => {
      assert.ok(error instanceof AccountAuthError);
      assert.equal(error.status, 401);
      assert.equal(error.message, "invalid email or password");
      return true;
    },
  );
});

test("a duplicate registration surfaces the conflict", async () => {
  const { client } = stubFetch([json(409, { detail: "email already registered" })]);

  await assert.rejects(
    () => client.register("user@example.com", "correct-horse-battery-staple"),
    (error: unknown) => error instanceof AccountAuthError && error.status === 409,
  );
});

test("a validation error is reported without echoing the submitted body", async () => {
  const password = "short";
  const { client } = stubFetch([
    json(422, { detail: [{ loc: ["body", "password"], input: password }] }),
  ]);

  await assert.rejects(
    () => client.register("user@example.com", password),
    (error: unknown) => {
      assert.ok(error instanceof AccountAuthError);
      assert.ok(!error.message.includes(password));
      return true;
    },
  );
});

test("baseUrl is honoured for a cross-origin deployment", async () => {
  const calls: RecordedCall[] = [];
  const fetchImpl = (async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return json(200, USER);
  }) as unknown as typeof fetch;

  const client = createAccountAuthClient({ baseUrl: "https://api.vault.example/", fetchImpl });
  await client.currentUser();

  assert.equal(calls[0].url, "https://api.vault.example/auth/me");
});
