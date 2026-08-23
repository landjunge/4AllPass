import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildLoginModel,
  ineligibleReason,
  pickPassword,
  pickUsername,
  scorePassword,
  scoreUsername,
  type InputLike,
} from "../src/fill.ts";

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

test("buildLoginModel accepts username + current-password spec tokens", () => {
  const user = input({ type: "text", autocomplete: "username" });
  const pass = input({ type: "password", autocomplete: "current-password" });
  const model = buildLoginModel([user, pass]);
  assert.equal(model.eligible, true);
  assert.ok(model.username && model.username.confidence >= 0.95);
  assert.ok(model.password && model.password.confidence >= 0.95);
  assert.equal(model.username.input, user);
  assert.equal(model.password.input, pass);
});

test("buildLoginModel skips new-password-only signup", () => {
  const user = input({ type: "text", autocomplete: "username" });
  const pass = input({ type: "password", autocomplete: "new-password" });
  const model = buildLoginModel([user, pass]);
  assert.equal(model.password, null);
  assert.equal(model.username?.input, user);
  assert.equal(model.eligible, true);
});

test("buildLoginModel new-password only is not eligible", () => {
  const model = buildLoginModel([
    input({ type: "password", autocomplete: "new-password", name: "next" }),
    input({ type: "password", autocomplete: "new-password", name: "confirm" }),
  ]);
  assert.equal(model.password, null);
  assert.equal(model.username, null);
  assert.equal(model.eligible, false);
});

test("given-name is never a login username even if name=user", () => {
  const given = input({ type: "text", name: "user", autocomplete: "given-name" });
  const pass = input({ type: "password", name: "password" });
  assert.equal(scoreUsername(given), null);
  assert.equal(pickUsername([given, pass]), null);
  const model = buildLoginModel([given, pass]);
  assert.equal(model.username, null);
  assert.ok(model.password);
});

test("weak text fallback is not eligible alone", () => {
  const weak = input({ type: "text", name: "q" });
  const model = buildLoginModel([weak]);
  assert.equal(model.eligible, false);
  assert.equal(model.username, null);
  assert.equal(pickUsername([weak]), weak);
});

test("password without autocomplete is eligible", () => {
  const pass = input({ type: "password" });
  const model = buildLoginModel([pass]);
  assert.equal(model.eligible, true);
  assert.ok(model.password && model.password.confidence >= 0.7);
  assert.equal(model.username, null);
});

test("section prefix and webauthn suffix still match current-password", () => {
  const pass = input({ type: "password", autocomplete: "section-login current-password webauthn" });
  const scored = scorePassword(pass);
  assert.equal(scored?.confidence, 0.98);
});

test("autocomplete=off still uses name heuristics", () => {
  const user = input({ type: "text", name: "email", autocomplete: "off" });
  const scored = scoreUsername(user);
  assert.equal(scored?.role, "email");
  assert.ok(scored && scored.confidence >= 0.8);
});

test("readonly and disabled fields are skipped", () => {
  assert.equal(scoreUsername(input({ type: "text", autocomplete: "username", readonly: true })), null);
  assert.equal(scorePassword(input({ type: "password", disabled: true })), null);
});

test("ineligibleReason distinguishes signup from low confidence", () => {
  const signup = [
    input({ type: "password", autocomplete: "new-password", name: "next" }),
    input({ type: "password", autocomplete: "new-password", name: "confirm" }),
  ];
  assert.equal(ineligibleReason(signup, buildLoginModel(signup)), "signup");
  const weak = [input({ type: "text", name: "q" })];
  assert.equal(ineligibleReason(weak, buildLoginModel(weak)), "low-confidence");
  assert.equal(ineligibleReason([], buildLoginModel([])), "no-fields");
});
