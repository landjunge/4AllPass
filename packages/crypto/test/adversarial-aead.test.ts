import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  AuthFailureError,
  IntegrityError,
  ProtocolError,
  bytesToHex,
  decrypt,
  decryptEntry,
  deviceKeyAad,
  encrypt,
  encryptEntry,
  entryAad,
  entryDigest,
  envelopeAad,
  envelopeDigest,
  frame,
  generateVaultKey,
  manifestAad,
  unwrapVaultKey,
  zeroize,
} from "../src/index.ts";
import { encryptWithNonce } from "../src/test-only.ts";
import * as publicApi from "../src/index.ts";
import { C, VKV, fixtureSnapshot, masterKey, vaultKey } from "./fixtures.ts";
import { REPO_ROOT } from "./helpers.ts";

const entryOpts = {
  vaultKey,
  vaultId: C.vault_id,
  entryId: C.entry_id,
  vaultKeyVersion: VKV,
};

function freshEntry(plaintext = '{"title":"secret"}') {
  return encryptEntry({ ...entryOpts, plaintext: new TextEncoder().encode(plaintext) });
}

describe("attack: nonce reuse", () => {
  it("the public seal API cannot be handed a nonce", () => {
    assert.equal(encrypt.length, 3);
    const exported = Object.keys(publicApi);
    assert.deepEqual(
      exported.filter((name) => /WithNonce$/.test(name)),
      [],
    );
  });

  it("issues a distinct nonce for every seal under the same key", () => {
    const key = generateVaultKey();
    const seen = new Set<string>();
    for (let i = 0; i < 512; i++) {
      const box = encrypt(key, new Uint8Array([i & 0xff]), new Uint8Array(0));
      const nonce = bytesToHex(box.nonce);
      assert.equal(seen.has(nonce), false, `nonce repeated at seal ${i}`);
      seen.add(nonce);
    }
  });

  it("re-encrypting the same entry never reuses the nonce", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 256; i++) {
      seen.add(bytesToHex(freshEntry().nonce));
    }
    assert.equal(seen.size, 256);
  });

  it("shows why: a reused key+nonce pair leaks the XOR of both plaintexts", () => {
    const key = generateVaultKey();
    const nonce = new Uint8Array(12).fill(9);
    const a = new TextEncoder().encode("password-one");
    const b = new TextEncoder().encode("password-two");
    const boxA = encryptWithNonce(key, nonce, a, new Uint8Array(0));
    const boxB = encryptWithNonce(key, nonce, b, new Uint8Array(0));
    const leaked = boxA.ciphertext.map((byte, i) => byte ^ (boxB.ciphertext[i] ?? 0));
    const plaintextXor = a.map((byte, i) => byte ^ (b[i] ?? 0));
    assert.deepEqual(leaked, plaintextXor);
  });

  it("copies the caller nonce so a later mutation cannot desynchronize it", () => {
    const key = generateVaultKey();
    const nonce = new Uint8Array(12).fill(1);
    const box = encryptWithNonce(key, nonce, new Uint8Array([1, 2, 3]), new Uint8Array(0));
    nonce.fill(0xff);
    assert.equal(bytesToHex(box.nonce), "010101010101010101010101");
    assert.deepEqual(
      decrypt(key, box.nonce, box.ciphertext, box.tag, new Uint8Array(0)),
      new Uint8Array([1, 2, 3]),
    );
  });
});

describe("attack: AAD mismatch", () => {
  it("refuses an entry decrypted under another vault's AAD", () => {
    const entry = freshEntry();
    assert.throws(
      () => decryptEntry(entry, { ...entryOpts, vaultId: "vault_attacker" }),
      AuthFailureError,
    );
  });

  it("refuses a master envelope relabelled as a recovery envelope", () => {
    const { master } = fixtureSnapshot();
    const relabelled = { ...master, type: "recovery" as const };
    // Step 1: the kdf block no longer belongs to the claimed type.
    assert.throws(
      () =>
        unwrapVaultKey(relabelled, {
          wrappingKey: masterKey,
          vaultId: C.vault_id,
          expectType: "recovery",
          expectVaultKeyVersion: VKV,
          allowTestProfile: true,
        }),
      ProtocolError,
    );
    // Step 2: a well-formed relabelling still fails the tag, because `type` is in the AAD.
    const { kdf, ...withoutKdf } = relabelled;
    assert.ok(kdf);
    assert.throws(
      () =>
        unwrapVaultKey(withoutKdf, {
          wrappingKey: masterKey,
          vaultId: C.vault_id,
          expectType: "recovery",
          expectVaultKeyVersion: VKV,
        }),
      AuthFailureError,
    );
  });

  it("refuses an envelope opened as a different kind than the caller asked for", () => {
    const { master } = fixtureSnapshot();
    assert.throws(
      () =>
        unwrapVaultKey(master, {
          wrappingKey: masterKey,
          vaultId: C.vault_id,
          expectType: "device",
          expectVaultKeyVersion: VKV,
          expectDeviceId: C.device_id,
          expectDeviceKeyVersion: 1,
          allowTestProfile: true,
        }),
      IntegrityError,
    );
  });
});

describe("attack: AAD and digest ambiguity", () => {
  it("cannot be made to collide by shifting bytes between adjacent fields", () => {
    const a = entryAad({
      vaultId: "vault_a",
      entryId: "bc",
      schemaVersion: 1,
      cryptoVersion: 1,
      vaultKeyVersion: 1,
    });
    const b = entryAad({
      vaultId: "vault_ab",
      entryId: "c",
      schemaVersion: 1,
      cryptoVersion: 1,
      vaultKeyVersion: 1,
    });
    assert.notEqual(bytesToHex(a), bytesToHex(b));
    assert.notEqual(bytesToHex(frame(["a", "bc"])), bytesToHex(frame(["ab", "c"])));
  });

  it("gives every AAD role its own byte space", () => {
    const shared = { vaultId: C.vault_id, cryptoVersion: 1, vaultKeyVersion: VKV };
    const aads = [
      envelopeAad({ ...shared, type: "master", deviceId: "", deviceKeyVersion: 0 }),
      envelopeAad({ ...shared, type: "recovery", deviceId: "", deviceKeyVersion: 0 }),
      envelopeAad({ ...shared, type: "device", deviceId: C.device_id, deviceKeyVersion: 1 }),
      entryAad({
        vaultId: C.vault_id,
        entryId: C.entry_id,
        schemaVersion: 1,
        cryptoVersion: 1,
        vaultKeyVersion: VKV,
      }),
      deviceKeyAad({
        vaultId: C.vault_id,
        deviceId: C.device_id,
        credentialId: new Uint8Array(16).fill(1),
        cryptoVersion: 1,
        deviceKeyVersion: 1,
      }),
      manifestAad({ vaultId: C.vault_id, cryptoVersion: 1, revision: 1, vaultKeyVersion: VKV }),
    ].map(bytesToHex);
    assert.equal(new Set(aads).size, aads.length);
  });

  it("keeps entry and envelope digests in separate spaces", () => {
    const { entry, master } = fixtureSnapshot();
    const digests = new Set([bytesToHex(entryDigest(entry)), bytesToHex(envelopeDigest(master))]);
    assert.equal(digests.size, 2);
    // Same sealed bytes under a different role must not produce the same digest.
    const asEnvelope = { ...master, nonce: entry.nonce, ciphertext: entry.ciphertext, tag: entry.tag };
    assert.notEqual(bytesToHex(envelopeDigest(asEnvelope)), bytesToHex(entryDigest(entry)));
  });
});

describe("attack: truncation", () => {
  it("refuses a truncated GCM tag instead of treating it as authentic", () => {
    const entry = freshEntry();
    assert.throws(
      () => decryptEntry({ ...entry, tag: entry.tag.slice(0, 8) }, entryOpts),
      ProtocolError,
    );
  });

  it("refuses a truncated ciphertext", () => {
    const entry = freshEntry();
    assert.throws(
      () => decryptEntry({ ...entry, ciphertext: entry.ciphertext.slice(0, 4) }, entryOpts),
      AuthFailureError,
    );
  });

  it("refuses a key envelope whose ciphertext is not a wrapped 32-byte key", () => {
    const { master } = fixtureSnapshot();
    assert.throws(
      () =>
        unwrapVaultKey(
          { ...master, ciphertext: master.ciphertext.slice(0, 16) },
          {
            wrappingKey: masterKey,
            vaultId: C.vault_id,
            expectType: "master",
            expectVaultKeyVersion: VKV,
            allowTestProfile: true,
          },
        ),
      ProtocolError,
    );
  });

  it("refuses a sealed blob shorter than the tag", () => {
    assert.throws(
      () => decrypt(vaultKey, new Uint8Array(12), new Uint8Array(0), new Uint8Array(8), new Uint8Array(0)),
      ProtocolError,
    );
  });
});

describe("attack: malformed input", () => {
  it("reports JSON-decoded byte arrays as malformed, not as authentication failures", () => {
    const entry = freshEntry();
    const roundTripped = JSON.parse(
      JSON.stringify({
        ...entry,
        nonce: [...entry.nonce],
        ciphertext: [...entry.ciphertext],
        tag: [...entry.tag],
      }),
    );
    assert.throws(() => decryptEntry(roundTripped, entryOpts), ProtocolError);
  });

  for (const [label, value] of [
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["negative", -1],
    ["fractional", 1.5],
    ["zero", 0],
    ["string", "1"],
    ["null", null],
  ] as const) {
    it(`refuses ${label} as an entry version`, () => {
      const entry = freshEntry();
      assert.throws(
        () => decryptEntry({ ...entry, schemaVersion: value as number }, entryOpts),
        ProtocolError,
      );
    });
  }

  it("refuses an empty or oversized identifier", () => {
    assert.throws(() => freshEntryWithId(""), ProtocolError);
    assert.throws(() => freshEntryWithId("x".repeat(257)), ProtocolError);
  });

  it("refuses a non-object entry or envelope", () => {
    assert.throws(() => decryptEntry(null as never, entryOpts), ProtocolError);
    assert.throws(
      () =>
        unwrapVaultKey(undefined as never, {
          wrappingKey: masterKey,
          vaultId: C.vault_id,
          expectType: "master",
          expectVaultKeyVersion: VKV,
        }),
      ProtocolError,
    );
  });

  it("refuses an envelope type that is not one of the three kinds", () => {
    const { master } = fixtureSnapshot();
    for (const type of ["__proto__", "constructor", "Master", ""]) {
      assert.throws(
        () =>
          unwrapVaultKey({ ...master, type: type as never }, {
            wrappingKey: masterKey,
            vaultId: C.vault_id,
            expectType: "master",
            expectVaultKeyVersion: VKV,
            allowTestProfile: true,
          }),
        ProtocolError,
      );
    }
  });

  it("reads each byte field exactly once, so a getter cannot swap it after validation", () => {
    const entry = freshEntry();
    let nonceReads = 0;
    const swapping = {
      ...entry,
      get nonce() {
        nonceReads += 1;
        return nonceReads === 1 ? entry.nonce : new Uint8Array(12).fill(0xff);
      },
    };
    const plaintext = decryptEntry(swapping, entryOpts);
    assert.equal(nonceReads, 1);
    assert.deepEqual(plaintext, decryptEntry(entry, entryOpts));
  });

  it("refuses an unsupported AEAD name", () => {
    const { master } = fixtureSnapshot();
    assert.throws(
      () =>
        unwrapVaultKey({ ...master, encryption: "AES-128-CBC" as never }, {
          wrappingKey: masterKey,
          vaultId: C.vault_id,
          expectType: "master",
          expectVaultKeyVersion: VKV,
          allowTestProfile: true,
        }),
      ProtocolError,
    );
  });
});

function freshEntryWithId(entryId: string) {
  return encryptEntry({
    vaultKey,
    vaultId: C.vault_id,
    entryId,
    vaultKeyVersion: VKV,
    plaintext: new Uint8Array([1]),
  });
}

describe("attack: zeroization leaks", () => {
  it("hands out independent buffers for nonce, ciphertext and tag", () => {
    const entry = freshEntry();
    assert.notEqual(entry.ciphertext.buffer, entry.tag.buffer);
    assert.notEqual(entry.ciphertext.buffer, entry.nonce.buffer);
    assert.equal(entry.ciphertext.byteOffset, 0);
    assert.equal(entry.tag.byteOffset, 0);
    assert.equal(entry.ciphertext.buffer.byteLength, entry.ciphertext.length);
    assert.equal(entry.tag.buffer.byteLength, entry.tag.length);
  });

  it("zeroizing the ciphertext does not silently rewrite the tag", () => {
    const entry = freshEntry();
    const tagBefore = bytesToHex(entry.tag);
    zeroize(entry.ciphertext);
    assert.equal(bytesToHex(entry.tag), tagBefore);
    assert.equal(bytesToHex(entry.ciphertext), "00".repeat(entry.ciphertext.length));
  });

  it("returns plaintext the caller can wipe without touching the record", () => {
    const entry = freshEntry();
    const plaintext = decryptEntry(entry, entryOpts);
    const ciphertextBefore = bytesToHex(entry.ciphertext);
    zeroize(plaintext);
    assert.equal(bytesToHex(plaintext), "00".repeat(plaintext.length));
    assert.equal(bytesToHex(entry.ciphertext), ciphertextBefore);
    assert.deepEqual(decryptEntry(entry, entryOpts).length > 0, true);
  });

  it("zeroize accepts absent buffers", () => {
    const key = generateVaultKey();
    zeroize(key, undefined);
    assert.equal(bytesToHex(key), "00".repeat(32));
  });
});

describe("attack: test-only API leakage", () => {
  it("keeps nonce-accepting helpers out of the package entry point", () => {
    const pkg = JSON.parse(
      readFileSync(join(REPO_ROOT, "packages", "crypto", "package.json"), "utf8"),
    ) as { exports: Record<string, string> };
    assert.deepEqual(Object.keys(pkg.exports), [".", "./test-only"]);
  });

  it("refuses to be imported in a production build", () => {
    const url = new URL("../src/test-only.ts", import.meta.url).href;
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", `await import(${JSON.stringify(url)})`],
      {
        encoding: "utf8",
        env: { ...process.env, NODE_ENV: "production" },
        cwd: join(REPO_ROOT, "packages", "crypto"),
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /production build/);
  });
});
