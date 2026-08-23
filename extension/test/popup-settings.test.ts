import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_API_ORIGIN,
  normalizeApiOrigin,
  parsePopupSettings,
  popupSettingsForStore,
} from "../src/popup-settings.ts";

test("empty API origin falls back to the desktop sidecar", () => {
  assert.equal(normalizeApiOrigin(""), DEFAULT_API_ORIGIN);
  assert.equal(normalizeApiOrigin("  "), DEFAULT_API_ORIGIN);
  assert.equal(normalizeApiOrigin("http://127.0.0.1:8788/"), "http://127.0.0.1:8788");
});

test("stored settings never include a password field", () => {
  const stored = popupSettingsForStore("http://127.0.0.1:8788", "ada@example.com");
  assert.equal("password" in stored, false);
  assert.equal("accountPassword" in stored, false);
  assert.equal("vaultPassword" in stored, false);
  assert.deepEqual(JSON.stringify(stored).includes("s3cret"), false);
});

test("parsePopupSettings ignores unknown keys and missing objects", () => {
  assert.deepEqual(parsePopupSettings(null), { apiOrigin: DEFAULT_API_ORIGIN, email: "" });
  assert.equal(parsePopupSettings({ apiOrigin: "http://127.0.0.1:8010", email: " a@b.c ", vaultPassword: "nope" }).email, "a@b.c");
  assert.equal(
    JSON.stringify(parsePopupSettings({ apiOrigin: "http://127.0.0.1:8010", vaultPassword: "nope" })).includes("nope"),
    false,
  );
});
