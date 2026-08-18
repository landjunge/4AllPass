import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { bytesToBase64, randomBytes } from "@4allpass/crypto";

import { loadPin, savePin } from "./revision-pin.ts";

const memory = new Map<string, string>();

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem(key: string) {
      return memory.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      memory.set(key, value);
    },
    removeItem(key: string) {
      memory.delete(key);
    },
  },
});

afterEach(() => memory.clear());

test("round-trips a pin including the verified manifest digest", () => {
  const digest = randomBytes(32);
  savePin({
    vaultId: "vault-1",
    revision: 4,
    vaultKeyVersion: 1,
    cryptoProtocolVersion: 1,
    manifestDigest: digest,
  });
  const loaded = loadPin("vault-1");
  assert.ok(loaded);
  assert.equal(loaded.revision, 4);
  assert.deepEqual(loaded.manifestDigest, digest);
  const raw = JSON.parse(memory.get("4allpass.pin.vault-1") ?? "{}") as { manifestDigest?: string };
  assert.equal(raw.manifestDigest, bytesToBase64(digest));
});

test("loads a legacy pin that has no manifest digest", () => {
  memory.set(
    "4allpass.pin.vault-2",
    JSON.stringify({ vaultId: "vault-2", revision: 1, vaultKeyVersion: 1 }),
  );
  const loaded = loadPin("vault-2");
  assert.ok(loaded);
  assert.equal(loaded.revision, 1);
  assert.equal(loaded.manifestDigest, undefined);
});
