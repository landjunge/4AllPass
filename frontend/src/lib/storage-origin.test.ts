import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeStorageOrigin } from "./storage-origin.ts";

describe("normalizeStorageOrigin", () => {
  it("accepts https hosts without a path", () => {
    assert.equal(normalizeStorageOrigin("https://vault.netzwerkpunkt.de/"), "https://vault.netzwerkpunkt.de");
  });

  it("allows http only on loopback", () => {
    assert.equal(normalizeStorageOrigin("http://127.0.0.1:8000"), "http://127.0.0.1:8000");
    assert.throws(() => normalizeStorageOrigin("http://vault.example.com"), /HTTPS/);
  });

  it("refuses credentials and paths", () => {
    assert.throws(() => normalizeStorageOrigin("https://u:p@vault.example.com"), /credentials/);
    assert.throws(() => normalizeStorageOrigin("https://vault.example.com/app"), /path/);
  });

  it("treats blank as this-device", () => {
    assert.equal(normalizeStorageOrigin("  "), "");
  });
});
