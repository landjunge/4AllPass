import assert from "node:assert/strict";
import { test } from "node:test";
import { pickPassword, pickUsername, type InputLike } from "../src/fill.ts";

function input(partial: Partial<InputLike> & { type: string }): InputLike {
  return { name: "", id: "", autocomplete: "", ...partial };
}

test("pickUsername prefers autocomplete=username", () => {
  const search = input({ type: "search", name: "q" });
  const user = input({ type: "text", autocomplete: "username", name: "acct" });
  assert.equal(pickUsername([search, user]), user);
});

test("pickPassword prefers current-password and skips new-password-only signup", () => {
  const current = input({ type: "password", autocomplete: "current-password", name: "old" });
  const next = input({ type: "password", autocomplete: "new-password", name: "next" });
  assert.equal(pickPassword([current, next]), current);
  assert.equal(pickPassword([next, input({ type: "password", autocomplete: "new-password", name: "confirm" })]), null);
});

test("pickPassword fills a login with no autocomplete", () => {
  const user = input({ type: "text", name: "email" });
  const pass = input({ type: "password", name: "password" });
  assert.equal(pickUsername([user, pass]), user);
  assert.equal(pickPassword([user, pass]), pass);
});
