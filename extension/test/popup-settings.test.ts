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
  assert.equal(normalizeApiOrigin("http://localhost:8788"), "http://localhost:8788");
  assert.equal(normalizeApiOrigin("https://vault.example"), "https://vault.example");
});

test("HTTP is refused for non-loopback API origins", () => {
  assert.throws(() => normalizeApiOrigin("http://mein-server.example"), /HTTPS/);
  assert.throws(() => normalizeApiOrigin("http://example.com:8788"), /HTTPS/);
  assert.throws(() => normalizeApiOrigin("ftp://127.0.0.1"), /absolute http\(s\)|HTTPS|http/);
});

test("stored http remote origin is dropped, not reused", () => {
  const parsed = parsePopupSettings({ apiOrigin: "http://evil.example", email: "a@b.c" });
  assert.equal(parsed.apiOrigin, DEFAULT_API_ORIGIN);
});

test("stored settings never include a password field", () => {
  const stored = popupSettingsForStore("http://127.0.0.1:8788", "ada@example.com");
  assert.equal("password" in stored, false);
  assert.equal("accountPassword" in stored, false);
  assert.equal("vaultPassword" in stored, false);
  assert.deepEqual(JSON.stringify(stored).includes("s3cret"), false);
});

test("remembers a vault uuid and drops junk", () => {
  const stored = popupSettingsForStore(
    "http://127.0.0.1:8788",
    "ada@example.com",
    "00000000-0000-4000-8000-000000000001",
  );
  assert.equal(stored.vaultId, "00000000-0000-4000-8000-000000000001");
  assert.equal(popupSettingsForStore("http://127.0.0.1:8788", "ada@example.com", "vault_icloud").vaultId, "");
});

test("parsePopupSettings ignores unknown keys and missing objects", () => {
  assert.deepEqual(parsePopupSettings(null), { apiOrigin: DEFAULT_API_ORIGIN, email: "", vaultId: "" });
  assert.equal(parsePopupSettings({ apiOrigin: "http://127.0.0.1:8010", email: " a@b.c ", vaultPassword: "nope" }).email, "a@b.c");
  assert.equal(
    JSON.stringify(parsePopupSettings({ apiOrigin: "http://127.0.0.1:8010", vaultPassword: "nope" })).includes("nope"),
    false,
  );
});
