/**
 * The extension reads the same server-controlled snapshot as the PWA, so it
 * needs the same two guards. Before this, `unlockVault` ran only the content
 * pass: a malicious server could replay a pre-rotation snapshot and the
 * extension would autofill a password the user had already changed.
 */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  ARGON2ID_PROFILES,
  IntegrityError,
  RollbackError,
  buildManifest,
  deriveMasterKey,
  encodeVaultSnapshot,
  encryptEntry,
  generateSalt,
  generateVaultKey,
  kdfParamsFrom,
  sealManifest,
  wrapVaultKey,
  type EncryptedEntry,
  type KeyEnvelope,
} from "@4allpass/crypto";

import { memoryPinStore } from "../src/revision-pin.ts";
import { unlockVault } from "../src/unlock.ts";

const PASSWORD = "extension-master-password";
const VAULT_ID = "vault-extension-freshness";
const profile = ARGON2ID_PROFILES.mobile_safe;
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const vaultKey = generateVaultKey();
const salt = generateSalt(16);
const masterKey = deriveMasterKey(PASSWORD, salt, profile);
const master: KeyEnvelope = wrapVaultKey({
  vaultKey,
  wrappingKey: masterKey,
  vaultId: VAULT_ID,
  type: "master",
  vaultKeyVersion: 1,
  kdf: kdfParamsFrom(profile, salt),
});

function seal(password: string): EncryptedEntry {
  return encryptEntry({
    vaultKey,
    vaultId: VAULT_ID,
    entryId: "entry_0001",
    plaintext: new TextEncoder().encode(
      JSON.stringify({ title: "GitHub", username: "alice", password, url: "https://github.com" }),
    ),
    vaultKeyVersion: 1,
    schemaVersion: 1,
  });
}

function wire(revision: number, entries: EncryptedEntry[], sealed = true) {
  return encodeVaultSnapshot({
    vaultId: VAULT_ID,
    revision,
    vaultKeyVersion: 1,
    cryptoProtocolVersion: 1,
    envelopes: [master],
    entries,
    ...(sealed
      ? {
          sealedManifest: sealManifest({
            vaultKey,
            manifest: buildManifest({
              vaultId: VAULT_ID,
              revision,
              vaultKeyVersion: 1,
              envelopes: [master],
              entries,
            }),
          }),
        }
      : {}),
  });
}

/** Minimal stand-in for the three calls `unlockVault` makes. */
function serveSnapshot(snapshot: unknown): void {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    const body = url.endsWith("/snapshot")
      ? snapshot
      : url.includes("/vaults")
        ? [{ vaultId: VAULT_ID }]
        : { token: "session-token" };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof globalThis.fetch;
}

function unlock(pins: ReturnType<typeof memoryPinStore>) {
  return unlockVault({
    apiOrigin: "http://127.0.0.1:8788",
    deviceId: "dev_extension_test_aaaa",
    email: "",
    accountPassword: "",
    vaultPassword: PASSWORD,
    pins,
  });
}

test("pins the verified revision and then refuses a replayed older snapshot", async () => {
  const pins = memoryPinStore();

  serveSnapshot(wire(9, [seal("ROTATED")]));
  const first = await unlock(pins);
  assert.equal(first.entries[0]?.password, "ROTATED");
  const pinned = await pins.load(VAULT_ID);
  assert.equal(pinned?.revision, 9);
  assert.ok(pinned?.manifestDigest, "pin was written from the verified manifest");

  // Same vault, same VK, older authentic snapshot with the pre-rotation password.
  serveSnapshot(wire(4, [seal("LEAKED")]));
  await assert.rejects(() => unlock(pins), RollbackError);
});

test("refuses a snapshot whose manifest was stripped after one was pinned", async () => {
  const pins = memoryPinStore();
  serveSnapshot(wire(9, [seal("ROTATED")]));
  await unlock(pins);

  serveSnapshot(wire(10, [seal("LEAKED")], false));
  await assert.rejects(() => unlock(pins), IntegrityError);
});

test("refuses a snapshot whose entry set does not match the manifest", async () => {
  const pins = memoryPinStore();
  const honest = wire(3, [seal("ROTATED")]);
  // Right manifest, substituted entry record.
  const tampered = { ...honest, entries: wire(3, [seal("LEAKED")]).entries };
  serveSnapshot(tampered);
  await assert.rejects(() => unlock(pins), IntegrityError);
});
