import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildLoginModel,
  formatAssistPrompt,
  formatFillFailure,
  formatFillSuccess,
  ineligibleReason,
  leftoverAssistFields,
  pickPassword,
  pickUsername,
  probeFromModel,
  shouldOfferAssist,
  scoreOtp,
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
  assert.equal(model.eligible, false);
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

test("one-time-code is an otp field, not a username", () => {
  const otp = input({ type: "text", autocomplete: "one-time-code", name: "code" });
  assert.equal(scoreUsername(otp), null);
  const scored = scoreOtp(otp);
  assert.equal(scored?.role, "otp");
  assert.ok(scored && scored.confidence >= 0.95);
  const model = buildLoginModel([otp]);
  assert.equal(model.eligible, true);
  assert.equal(model.otp?.input, otp);
});

test("GitHub-shaped login_field is a username even without autocomplete", () => {
  const login = input({ type: "text", name: "login", id: "login_field" });
  const scored = scoreUsername(login);
  assert.equal(scored?.role, "username");
  assert.ok(scored && scored.confidence >= 0.82);
  const model = buildLoginModel([
    login,
    input({ type: "password", name: "password", id: "password" }),
  ]);
  assert.equal(model.eligible, true);
  assert.equal(model.username?.input, login);
});

test("GitHub live /login is one form: username + password (webauthn suffix ok)", () => {
  // Live HTML 2026-08: both fields on /login. Conditional UI may append "webauthn".
  const loginPage = [
    input({ type: "text", name: "login", id: "login_field", autocomplete: "username webauthn" }),
    input({ type: "password", name: "password", id: "password", autocomplete: "current-password" }),
  ];
  const model = buildLoginModel(loginPage);
  assert.equal(model.eligible, true);
  assert.equal(model.username?.input, loginPage[0]);
  assert.equal(model.password?.input, loginPage[1]);
  assert.ok(model.confidence >= 0.98);
});

test("GitHub still supports split pages: username-only, password-only, then OTP", () => {
  const userPage = [
    input({ type: "text", name: "login", id: "login_field", autocomplete: "username" }),
  ];
  const passPage = [
    input({ type: "password", name: "password", id: "password", autocomplete: "current-password" }),
  ];
  const otpPage = [
    input({ type: "text", name: "app_otp", id: "app_totp", autocomplete: "one-time-code" }),
  ];
  const userModel = buildLoginModel(userPage);
  const passModel = buildLoginModel(passPage);
  const otpModel = buildLoginModel(otpPage);
  assert.equal(userModel.eligible, true);
  assert.equal(userModel.username?.input, userPage[0]);
  assert.equal(userModel.password, null);
  assert.equal(passModel.eligible, true);
  assert.equal(passModel.password?.input, passPage[0]);
  assert.equal(passModel.username, null);
  assert.equal(otpModel.eligible, true);
  assert.equal(otpModel.otp?.input, otpPage[0]);
  assert.equal(shouldOfferAssist(userPage), false);
  assert.equal(shouldOfferAssist(passPage), false);
});

test("new_password id is signup skip, not a login password", () => {
  assert.equal(scorePassword(input({ type: "password", name: "new_password" })), null);
  assert.equal(scorePassword(input({ type: "password", id: "new-pass" })), null);
  assert.equal(scorePassword(input({ type: "password", name: "newPassword" })), null);
  assert.equal(scorePassword(input({ type: "password", id: "newpassword" })), null);
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

test("formatFillFailure names erkannt/gefüllt/Ergebnis without secrets", () => {
  const line = formatFillFailure({
    reason: "verify-mismatch",
    fields: ["username", "password"],
    filled: ["username"],
    mode: "controlled",
    confidence: 0.96,
  });
  assert.equal(line.includes("secret"), false);
  assert.equal(line.includes("ghp_"), false);
  assert.ok(line.includes("Erkannt / recognized username+password"));
  assert.ok(line.includes("Gefüllt / filled username"));
  assert.ok(line.includes("Ergebnis / result verify-mismatch"));
  assert.ok(line.includes("controlled"));
  assert.ok(line.includes("96%"));
  assert.ok(line.includes("page did not accept the fill"));
});

test("formatFillSuccess names fields without secrets", () => {
  const line = formatFillSuccess({
    fields: ["username", "password"],
    mode: "native",
    confidence: 0.98,
  });
  assert.equal(line.startsWith("Gefüllt / Filled"), true);
  assert.ok(line.includes("username+password"));
  assert.ok(line.includes("native"));
  assert.equal(line.includes("secret"), false);
});

test("probeFromModel skips secrets and flags signup", () => {
  const signup = [
    input({ type: "password", autocomplete: "new-password", name: "next" }),
  ];
  const probed = probeFromModel(signup, buildLoginModel(signup));
  assert.equal(probed.ok, false);
  assert.equal(probed.reason, "signup");
  assert.deepEqual(probed.fields, []);
});

test("username + new-password is signup, not a login fill", () => {
  const signup = [
    input({ type: "text", autocomplete: "username" }),
    input({ type: "password", autocomplete: "new-password", name: "next" }),
  ];
  const model = buildLoginModel(signup);
  const probed = probeFromModel(signup, model);
  assert.equal(model.eligible, false);
  assert.equal(probed.ok, false);
  assert.equal(probed.reason, "signup");
});

test("assist is offered for a weak username next to a password, not a lone search box", () => {
  const search = input({ type: "text", name: "q" });
  const pass = input({ type: "password" });
  assert.equal(shouldOfferAssist([search]), false);
  assert.equal(shouldOfferAssist([search, pass]), true);
  const strict = buildLoginModel([search, pass]);
  const weak = buildLoginModel([search, pass], 0);
  assert.deepEqual(leftoverAssistFields(strict, weak), ["username"]);
  assert.equal(strict.password?.input, pass);
  assert.equal(strict.username, null);
});

test("assist is not offered on signup", () => {
  const signup = [
    input({ type: "text", autocomplete: "username" }),
    input({ type: "password", autocomplete: "new-password", name: "next" }),
  ];
  assert.equal(shouldOfferAssist(signup), false);
});

test("formatAssistPrompt names roles without secrets", () => {
  const line = formatAssistPrompt(["username"]);
  assert.ok(line.includes("username"));
  assert.equal(line.includes("secret"), false);
  assert.equal(line.includes("ada@"), false);
});
