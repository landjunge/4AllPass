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
  assert.match(feedback.userText, /Tresor ist gesperrt/);
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
