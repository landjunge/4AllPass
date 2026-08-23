import assert from "node:assert/strict";
import { test } from "node:test";
import { storageAuthRequest } from "../src/unlock.ts";

test("desktop local unlock uses /auth/local and no account body", () => {
  const auth = storageAuthRequest("", "");
  assert.equal(auth.path, "/auth/local");
  assert.equal(auth.body, undefined);
  assert.equal(storageAuthRequest("  ", "").path, "/auth/local");
});

test("server unlock still posts email to /auth/login", () => {
  const auth = storageAuthRequest("ada@example.com", "account-password-1234");
  assert.equal(auth.path, "/auth/login");
  assert.deepEqual(auth.body, {
    email: "ada@example.com",
    password: "account-password-1234",
  });
});

test("partial account fields do not silently become local auth", () => {
  assert.equal(storageAuthRequest("ada@example.com", "").path, "/auth/login");
  assert.equal(storageAuthRequest("", "account-password-1234").path, "/auth/login");
});
