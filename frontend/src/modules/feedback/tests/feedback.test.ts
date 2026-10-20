import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createNotice,
  describeError,
  feedbackError,
  feedbackReducer,
  initialFeedbackState,
} from "../index.ts";

test("unknown failures never expose their message, stack, or response body", () => {
  const secret = "ghp_demo-never-show-this";
  const failure = Object.assign(new Error(`request leaked ${secret}`), {
    name: secret,
    body: { detail: secret },
    stack: `stack ${secret}`,
  });

  const feedback = describeError(failure);
  const serialized = JSON.stringify(feedback);

  assert.equal(feedback.code, "unexpected");
  assert.equal(feedback.technical.name, "UnknownError");
  assert.equal(serialized.includes(secret), false);
});

test("API failures keep only a safe status classification", () => {
  const failure = Object.assign(new Error("revision conflict for vault-secret-id"), {
    name: "ApiError",
    status: 409,
    body: { detail: "recovery-key-demo" },
  });
  const feedback = describeError(failure);

  assert.equal(feedback.code, "conflict");
  assert.deepEqual(feedback.technical, { name: "ApiError", status: 409 });
  assert.equal(JSON.stringify(feedback).includes("vault-secret-id"), false);
  assert.equal(JSON.stringify(feedback).includes("recovery-key-demo"), false);
});

test("known security failures get distinct user-safe codes", () => {
  const integrity = new Error("ciphertext contained a sensitive identifier");
  integrity.name = "IntegrityError";
  const rollback = new Error("server revision details");
  rollback.name = "RollbackError";

  assert.equal(describeError(integrity).code, "integrity_failed");
  assert.equal(describeError(rollback).code, "rollback_detected");
});

test("intentional app errors use catalog text instead of caller text", () => {
  const feedback = describeError(feedbackError("vault_locked"));
  assert.equal(feedback.code, "vault_locked");
  assert.match(feedback.userText.de, /Tresor ist gesperrt/);
  assert.match(feedback.userText.en, /vault is locked/);
});

test("feedback state keeps existing notice semantics and clears both banners", () => {
  const withNotice = feedbackReducer(initialFeedbackState, {
    type: "notice",
    code: "entries_saved",
  });
  const withError = feedbackReducer(withNotice, {
    type: "action_failed",
    error: new Error("hidden detail"),
  });
  const nextAction = feedbackReducer(withError, { type: "action_started" });

  assert.deepEqual(withNotice.notice, createNotice("entries_saved"));
  assert.equal(withError.error?.code, "unexpected");
  assert.equal(nextAction.error, null);
  assert.equal(nextAction.notice?.code, "entries_saved");
  assert.deepEqual(feedbackReducer(nextAction, { type: "clear" }), initialFeedbackState);
});

test("registration policy errors select safe DE/EN text without reflecting API input", () => {
  for (const code of [
    "account_password_too_short", "account_password_too_long",
    "account_password_blocklisted", "account_password_invalid",
  ]) {
    const failure = Object.assign(new Error("synthetic-hidden-password"), {
      name: "ApiError", status: 422,
      body: { detail: code, input: "synthetic-hidden-password" },
    });
    const feedback = describeError(failure);
    assert.equal(feedback.code, code);
    assert.ok(feedback.userText.de && feedback.userText.en);
    assert.equal(JSON.stringify(feedback).includes("synthetic-hidden-password"), false);
  }
  const unknown = Object.assign(new Error("synthetic-hidden-password"), {
    name: "ApiError", status: 422, body: { detail: "synthetic-hidden-password" },
  });
  assert.equal(describeError(unknown).code, "invalid_request");
});
