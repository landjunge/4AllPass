import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AuthFailureError,
  ProtocolError,
  RollbackError,
  IntegrityError,
  bytesToHex,
  decryptEntry,
  deriveDeviceWrappingKey,
  deriveMasterKey,
  encryptEntry,
  evaluateRevision,
  generateDeviceKey,
  generateRecoveryKey,
  generateSalt,
  generateVaultKey,
  hexToBytes,
  prfEvalFirst,
  unwrapDeviceKey,
  unwrapVaultKey,
  wrapVaultKey,
  wrapDeviceKey,
  zeroize,
  type VaultRevision,
} from "../src/index.ts";
import { decrypt, encrypt } from "../src/aead/aes-gcm.ts";
import * as index from "../src/index.ts";
import { ARGON2ID_PROFILES } from "../src/kdf/profiles.ts";
import { kdfParamsFrom } from "../src/kdf/argon2id.ts";

/**
 * Adversarial review of `packages/crypto`.
 *
 * This file exercises the public API the way a hostile server, a hostile
 * co-tenant device, or a malformed-message attacker would: by taking a
 * genuinely produced envelope/entry and mutating exactly one field, then
 * checking that the library refuses it. Categories map to the review:
 *
 *   nonce reuse, version confusion, AAD mismatch, cross-vault attacks,
 *   cross-device attacks, key substitution, downgrade, rollback,
 *   malformed input, truncation, credential swapping, PRF misuse,
 *   HKDF misuse, zeroization leaks, test-only API leakage.
 *
 * Each `it()` name states the attack. Passing means the attack is caught.
 */

const vaultA = "vault_A_01HZX4ALLPASS0000000001";
const vaultB = "vault_B_01HZX4ALLPASS0000000002";
const deviceA = "dev_A_macbook_chrome";
const deviceB = "dev_B_iphone_safari";

function freshVaultKey(): Uint8Array {
  return generateVaultKey();
}

describe("Adversarial: cross-vault attacks (AAD mismatch)", () => {
  it("decryptEntry rejects an entry decrypted under a different vaultId", () => {
    const vk = freshVaultKey();
    const plaintext = new TextEncoder().encode('{"title":"secret"}');
    const entry = encryptEntry({
      vaultKey: vk,
      vaultId: vaultA,
      entryId: "entry_1",
      plaintext,
    });
    assert.deepEqual(decryptEntry(entry, vk, vaultA), plaintext);
    assert.throws(() => decryptEntry(entry, vk, vaultB), AuthFailureError);
  });

  it("unwrapVaultKey rejects a master envelope moved to another vaultId", () => {
    const vk = freshVaultKey();
    const mk = generateDeviceKey();
    const env = wrapVaultKey({
      vaultKey: vk,
      wrappingKey: mk,
      vaultId: vaultA,
      type: "master",
      kdf: kdfParamsFrom(ARGON2ID_PROFILES.ci, generateSalt()),
      allowTestProfile: true,
    });
    assert.deepEqual(unwrapVaultKey(env, mk, vaultA), vk);
    assert.throws(() => unwrapVaultKey(env, mk, vaultB), AuthFailureError);
  });

  it("a real server-side attack: relabel an entry's own vault_id field and re-decrypt in its new home", () => {
    // The server cannot forge AAD it never had the key for. Take a genuine
    // entry from vault A, try to smuggle it into vault B's snapshot. Even
    // though the object's own `id`/versions are untouched, the vaultId the
    // client supplies for vault B's context does not match what was sealed.
    const vk = freshVaultKey();
    const entry = encryptEntry({
      vaultKey: vk,
      vaultId: vaultA,
      entryId: "entry_shared_id",
      plaintext: new TextEncoder().encode("vaultA secret"),
    });
    assert.throws(() => decryptEntry(entry, vk, vaultB), AuthFailureError);
  });
});

describe("Adversarial: cross-device attacks (device envelope / device-key envelope)", () => {
  it("unwrapVaultKey rejects a device envelope whose deviceId field was relabeled", () => {
    const vk = freshVaultKey();
    const dk = generateDeviceKey();
    const env = wrapVaultKey({
      vaultKey: vk,
      wrappingKey: dk,
      vaultId: vaultA,
      type: "device",
      deviceId: deviceA,
    });
    const relabeled = { ...env, deviceId: deviceB };
    assert.throws(() => unwrapVaultKey(relabeled, dk, vaultA), AuthFailureError);
  });

  it("a device envelope minted for device A cannot be unwrapped by device B's real DK", () => {
    const vk = freshVaultKey();
    const dkA = generateDeviceKey();
    const dkB = generateDeviceKey();
    const envA = wrapVaultKey({
      vaultKey: vk,
      wrappingKey: dkA,
      vaultId: vaultA,
      type: "device",
      deviceId: deviceA,
    });
    // Server swaps envelope identity fields to claim it belongs to device B,
    // but device B tries to open it with its own real device key.
    const asIfForB = { ...envA, deviceId: deviceB };
    assert.throws(() => unwrapVaultKey(asIfForB, dkB, vaultA), AuthFailureError);
  });

  it("unwrapDeviceKey rejects a Device-Key Envelope with a swapped credentialId", () => {
    const rpId = "pass.example.local";
    const credA = hexToBytes("aa".repeat(32));
    const credB = hexToBytes("bb".repeat(32));
    const prfOutput = hexToBytes("11".repeat(32));
    const dwk = deriveDeviceWrappingKey({
      prfOutput,
      rpId,
      vaultId: vaultA,
      deviceId: deviceA,
      credentialId: credA,
    });
    const dk = generateDeviceKey();
    const env = wrapDeviceKey({
      deviceKey: dk,
      deviceWrappingKey: dwk,
      vaultId: vaultA,
      deviceId: deviceA,
      credentialId: credA,
    });
    const swapped = { ...env, credentialId: credB };
    assert.throws(() => unwrapDeviceKey(swapped, dwk), AuthFailureError);
  });

  it("unwrapDeviceKey rejects a Device-Key Envelope relabeled to a different vaultId", () => {
    const rpId = "pass.example.local";
    const credA = hexToBytes("cc".repeat(32));
    const prfOutput = hexToBytes("22".repeat(32));
    const dwk = deriveDeviceWrappingKey({
      prfOutput,
      rpId,
      vaultId: vaultA,
      deviceId: deviceA,
      credentialId: credA,
    });
    const dk = generateDeviceKey();
    const env = wrapDeviceKey({
      deviceKey: dk,
      deviceWrappingKey: dwk,
      vaultId: vaultA,
      deviceId: deviceA,
      credentialId: credA,
    });
    const relabeled = { ...env, vaultId: vaultB };
    assert.throws(() => unwrapDeviceKey(relabeled, dwk), AuthFailureError);
  });
});

describe("Adversarial: key substitution", () => {
  it("unwrapVaultKey rejects the correct envelope opened with the wrong key", () => {
    const vk = freshVaultKey();
    const mk = generateDeviceKey();
    const wrongKey = generateDeviceKey();
    const env = wrapVaultKey({
      vaultKey: vk,
      wrappingKey: mk,
      vaultId: vaultA,
      type: "recovery",
    });
    assert.throws(() => unwrapVaultKey(env, wrongKey, vaultA), AuthFailureError);
  });

  it("decryptEntry rejects the correct entry opened with the wrong vault key", () => {
    const vk = freshVaultKey();
    const otherVk = freshVaultKey();
    const entry = encryptEntry({
      vaultKey: vk,
      vaultId: vaultA,
      entryId: "entry_1",
      plaintext: new TextEncoder().encode("secret"),
    });
    assert.throws(() => decryptEntry(entry, otherVk, vaultA), AuthFailureError);
  });

  it("unwrapDeviceKey rejects the correct envelope opened with a different device's DWK", () => {
    const credA = hexToBytes("dd".repeat(32));
    const prfOutput = hexToBytes("33".repeat(32));
    const dwkA = deriveDeviceWrappingKey({
      prfOutput,
      rpId: "pass.example.local",
      vaultId: vaultA,
      deviceId: deviceA,
      credentialId: credA,
    });
    const dwkOther = deriveDeviceWrappingKey({
      prfOutput,
      rpId: "pass.example.local",
      vaultId: vaultA,
      deviceId: deviceB, // different device -> different DWK from the same PRF output
      credentialId: credA,
    });
    const env = wrapDeviceKey({
      deviceKey: generateDeviceKey(),
      deviceWrappingKey: dwkA,
      vaultId: vaultA,
      deviceId: deviceA,
      credentialId: credA,
    });
    assert.throws(() => unwrapDeviceKey(env, dwkOther), AuthFailureError);
  });
});

describe("Adversarial: version confusion", () => {
  it("unwrapVaultKey rejects an envelope with a bumped version field it cannot produce", () => {
    const vk = freshVaultKey();
    const mk = generateDeviceKey();
    const env = wrapVaultKey({
      vaultKey: vk,
      wrappingKey: mk,
      vaultId: vaultA,
      type: "recovery",
    });
    const bumped = { ...env, version: 2 as unknown as 1 };
    assert.throws(() => unwrapVaultKey(bumped, mk, vaultA), ProtocolError);
  });

  it("decryptEntry rejects an entry whose cryptoVersion was bumped", () => {
    const vk = freshVaultKey();
    const entry = encryptEntry({
      vaultKey: vk,
      vaultId: vaultA,
      entryId: "entry_1",
      plaintext: new TextEncoder().encode("secret"),
    });
    const bumped = { ...entry, cryptoVersion: 2 };
    assert.throws(() => decryptEntry(bumped, vk, vaultA), ProtocolError);
  });

  it("decryptEntry rejects a downgraded/invalid schemaVersion before ever touching AEAD", () => {
    const vk = freshVaultKey();
    const entry = encryptEntry({
      vaultKey: vk,
      vaultId: vaultA,
      entryId: "entry_1",
      plaintext: new TextEncoder().encode("secret"),
      schemaVersion: 3,
    });
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      const forged = { ...entry, schemaVersion: bad };
      assert.throws(() => decryptEntry(forged, vk, vaultA), ProtocolError);
    }
    // A schemaVersion that is merely a *different valid integer* than what
    // was sealed is still an AAD mismatch (schemaVersion is bound), not a
    // silent accept, because entryAad encodes the version we pass in.
    const rewritten = { ...entry, schemaVersion: 2 };
    assert.throws(() => decryptEntry(rewritten, vk, vaultA), AuthFailureError);
  });

  it("unwrapDeviceKey rejects a Device-Key Envelope with a bumped version", () => {
    const credA = hexToBytes("ee".repeat(32));
    const prfOutput = hexToBytes("44".repeat(32));
    const dwk = deriveDeviceWrappingKey({
      prfOutput,
      rpId: "pass.example.local",
      vaultId: vaultA,
      deviceId: deviceA,
      credentialId: credA,
    });
    const env = wrapDeviceKey({
      deviceKey: generateDeviceKey(),
      deviceWrappingKey: dwk,
      vaultId: vaultA,
      deviceId: deviceA,
      credentialId: credA,
    });
    const bumped = { ...env, version: 2 as unknown as 1 };
    assert.throws(() => unwrapDeviceKey(bumped, dwk), ProtocolError);
  });
});

describe("Adversarial: envelope type confusion", () => {
  it("a master envelope cannot be reopened by relabeling it as a device envelope", () => {
    const vk = freshVaultKey();
    const mk = generateDeviceKey();
    const env = wrapVaultKey({
      vaultKey: vk,
      wrappingKey: mk,
      vaultId: vaultA,
      type: "master",
      kdf: kdfParamsFrom(ARGON2ID_PROFILES.ci, generateSalt()),
      allowTestProfile: true,
    });
    const relabeled = { ...env, type: "device" as const, deviceId: deviceA };
    // Rejected either way: AAD (`type` is bound) never matches, and this
    // implementation additionally validates deviceId bookkeeping first.
    assert.throws(() => unwrapVaultKey(relabeled, mk, vaultA));
  });

  it("a recovery envelope cannot be reopened by relabeling it as master", () => {
    const vk = freshVaultKey();
    const rk = generateRecoveryKey();
    const env = wrapVaultKey({
      vaultKey: vk,
      wrappingKey: rk,
      vaultId: vaultA,
      type: "recovery",
    });
    const relabeled = { ...env, type: "master" as const };
    assert.throws(() => unwrapVaultKey(relabeled, rk, vaultA));
  });
});

describe("Adversarial: malformed input / truncation", () => {
  it("decrypt rejects a truncated tag before touching the AEAD primitive", () => {
    const key = generateVaultKey();
    const box = encrypt(key, new TextEncoder().encode("hi"), new Uint8Array(0));
    assert.throws(
      () => decrypt(key, box.nonce, box.ciphertext, box.tag.subarray(0, 15), new Uint8Array(0)),
      ProtocolError,
    );
  });

  it("decrypt rejects a wrong-length key", () => {
    const key = generateVaultKey();
    const box = encrypt(key, new TextEncoder().encode("hi"), new Uint8Array(0));
    assert.throws(
      () => decrypt(key.subarray(0, 16), box.nonce, box.ciphertext, box.tag, new Uint8Array(0)),
      ProtocolError,
    );
  });

  it("decrypt rejects a wrong-length nonce", () => {
    const key = generateVaultKey();
    const box = encrypt(key, new TextEncoder().encode("hi"), new Uint8Array(0));
    assert.throws(
      () => decrypt(key, box.nonce.subarray(0, 8), box.ciphertext, box.tag, new Uint8Array(0)),
      ProtocolError,
    );
  });

  it("decrypt rejects a truncated ciphertext as an authentication failure, not a crash", () => {
    const key = generateVaultKey();
    const box = encrypt(key, new TextEncoder().encode("hello world"), new Uint8Array(0));
    assert.throws(
      () =>
        decrypt(
          key,
          box.nonce,
          box.ciphertext.subarray(0, Math.max(0, box.ciphertext.length - 3)),
          box.tag,
          new Uint8Array(0),
        ),
      AuthFailureError,
    );
  });

  it("decrypt rejects ciphertext with extra appended bytes", () => {
    const key = generateVaultKey();
    const box = encrypt(key, new TextEncoder().encode("hello world"), new Uint8Array(0));
    const extended = new Uint8Array(box.ciphertext.length + 4);
    extended.set(box.ciphertext, 0);
    assert.throws(
      () => decrypt(key, box.nonce, extended, box.tag, new Uint8Array(0)),
      AuthFailureError,
    );
  });

  it("wrapDeviceKey / unwrapDeviceKey reject an empty credentialId", () => {
    const dwk = generateDeviceKey();
    assert.throws(
      () =>
        wrapDeviceKey({
          deviceKey: generateDeviceKey(),
          deviceWrappingKey: dwk,
          vaultId: vaultA,
          deviceId: deviceA,
          credentialId: new Uint8Array(0),
        }),
      ProtocolError,
    );
  });

  it("deriveDeviceWrappingKey rejects a wrong-length PRF output (PRF misuse)", () => {
    for (const len of [0, 16, 31, 33, 64]) {
      assert.throws(
        () =>
          deriveDeviceWrappingKey({
            prfOutput: new Uint8Array(len),
            rpId: "pass.example.local",
            vaultId: vaultA,
            deviceId: deviceA,
            credentialId: hexToBytes("ff".repeat(16)),
          }),
        ProtocolError,
      );
    }
  });
});

describe("Adversarial: PRF / HKDF domain separation (credential & origin swapping)", () => {
  const rpId = "pass.example.local";
  const credentialId = hexToBytes("a1".repeat(20));
  const prfOutput = hexToBytes("5a".repeat(32));

  function dwk(overrides: Partial<Parameters<typeof deriveDeviceWrappingKey>[0]>): Uint8Array {
    return deriveDeviceWrappingKey({
      prfOutput,
      rpId,
      vaultId: vaultA,
      deviceId: deviceA,
      credentialId,
      ...overrides,
    });
  }

  it("changing rpId (origin) changes the DWK — a cross-origin PRF output cannot be reused", () => {
    assert.notEqual(bytesToHex(dwk({})), bytesToHex(dwk({ rpId: "evil.example.com" })));
  });

  it("changing vaultId changes the DWK", () => {
    assert.notEqual(bytesToHex(dwk({})), bytesToHex(dwk({ vaultId: vaultB })));
  });

  it("changing deviceId changes the DWK", () => {
    assert.notEqual(bytesToHex(dwk({})), bytesToHex(dwk({ deviceId: deviceB })));
  });

  it("changing credentialId changes the DWK — swapping in another credential does not work", () => {
    assert.notEqual(bytesToHex(dwk({})), bytesToHex(dwk({ credentialId: hexToBytes("b2".repeat(20)) })));
  });

  it("changing cryptoVersion changes the DWK", () => {
    // deriveDeviceWrappingKey is a low-level derivation and does not itself
    // enforce CRYPTO_PROTOCOL_VERSION (that check lives at wrapDeviceKey's
    // writing boundary). It still must fold the version into HKDF info so a
    // future protocol bump cannot collide with a v1 DWK.
    assert.notEqual(bytesToHex(dwk({ cryptoVersion: 1 })), bytesToHex(dwk({ cryptoVersion: 2 })));
  });

  it("prfEvalFirst is origin+vault bound and always 32 bytes", () => {
    const a = prfEvalFirst(rpId, vaultA);
    const b = prfEvalFirst("evil.example.com", vaultA);
    const c = prfEvalFirst(rpId, vaultB);
    assert.equal(a.length, 32);
    assert.notEqual(bytesToHex(a), bytesToHex(b));
    assert.notEqual(bytesToHex(a), bytesToHex(c));
  });
});

describe("Adversarial: downgrade & rollback (evaluateRevision)", () => {
  const pinned: VaultRevision = {
    vaultId: vaultA,
    revision: 10,
    vaultKeyVersion: 2,
    cryptoProtocolVersion: 1,
  };

  it("rejects a replayed older snapshot even if the crypto layer would decrypt it fine", () => {
    const decision = evaluateRevision(pinned, { ...pinned, revision: 3 });
    assert.equal(decision.ok, false);
    if (!decision.ok) assert.ok(decision.error instanceof RollbackError);
  });

  it("rejects a vaultKeyVersion downgrade even when revision advances", () => {
    const decision = evaluateRevision(pinned, { ...pinned, revision: 20, vaultKeyVersion: 1 });
    assert.equal(decision.ok, false);
    if (!decision.ok) assert.ok(decision.error instanceof IntegrityError);
  });

  it("CONFIRMED GAP — evaluateRevision only inspects the metadata tuple; it does not by", () => {
    // itself prove that entries served alongside this revision were sealed
    // for *this* revision. entryAad/envelopeAad do not include `revision` or
    // `vaultKeyVersion` (see docs/crypto-protocol.md §3.1 / §8). So, within a
    // single vaultKeyVersion epoch, a malicious server can report an
    // advanced revision while silently continuing to serve one entry's
    // *stale* ciphertext from an earlier revision. `evaluateRevision`
    // accepts the metadata transition ("advance"), and `decryptEntry`
    // authenticates fine because nothing in its AAD changed between the two
    // revisions. This reproduces the review's point:
    //   "was bindet 50 kryptografisch an den tatsächlichen Snapshot?"
    // See docs/security-review-adversarial-crypto-core.md #1 for the
    // recommended fix (bind revision + vaultKeyVersion into entryAad, or
    // authenticate a snapshot manifest).
    const vk = freshVaultKey();
    const entryAtRevision5 = encryptEntry({
      vaultKey: vk,
      vaultId: vaultA,
      entryId: "entry_balance_note",
      plaintext: new TextEncoder().encode('{"note":"old value"}'),
    });
    // ... the user edits the entry; a well-behaved server would now be at
    // revision 6 serving the *new* ciphertext for this entry.
    const entryAtRevision6 = encryptEntry({
      vaultKey: vk,
      vaultId: vaultA,
      entryId: "entry_balance_note",
      plaintext: new TextEncoder().encode('{"note":"new value"}'),
    });
    assert.notEqual(bytesToHex(entryAtRevision6.ciphertext), bytesToHex(entryAtRevision5.ciphertext));

    const lastSeen: VaultRevision = { vaultId: vaultA, revision: 5, vaultKeyVersion: 1, cryptoProtocolVersion: 1 };
    const incoming: VaultRevision = { vaultId: vaultA, revision: 6, vaultKeyVersion: 1, cryptoProtocolVersion: 1 };

    // The freshness check passes: revision advanced, key version unchanged.
    const decision = evaluateRevision(lastSeen, incoming);
    assert.equal(decision.ok, true);

    // A malicious server claims revision 6 but actually serves entryAtRevision5's
    // ciphertext for this one entry. Nothing in the crypto core catches this:
    // decryptEntry happily authenticates the stale blob because vault_id,
    // entry_id, schemaVersion and cryptoVersion are all unchanged.
    const plaintext = decryptEntry(entryAtRevision5, vk, vaultA);
    assert.equal(new TextDecoder().decode(plaintext), '{"note":"old value"}');
    // ^ This is the vulnerability: the client believes it is at revision 6
    // (a fresh, "advance"-accepted snapshot) yet is silently holding
    // revision-5 data for this entry, with no error and no signal to the
    // application layer. Per-entry rollback within one vaultKeyVersion
    // epoch is currently undetectable by this library.
  });
});

describe("Adversarial: zeroization", () => {
  it("zeroize() scrubs every buffer passed to it in place", () => {
    const a = hexToBytes("aaaaaaaaaaaaaaaa");
    const b = hexToBytes("bbbbbbbbbbbbbbbb");
    zeroize(a, undefined, b);
    assert.ok(a.every((byte) => byte === 0));
    assert.ok(b.every((byte) => byte === 0));
  });

  it("deriveMasterKey scrubs its internal UTF-8 password buffer before returning (Hard Invariant #4)", () => {
    const originalEncode = TextEncoder.prototype.encode;
    let captured: Uint8Array | undefined;
    // deriveMasterKey -> utf8Nfc -> utf8 -> `new TextEncoder().encode(s)`.
    // Capture that exact buffer so we can assert it was scrubbed afterwards,
    // without needing to export any internal buffer from the module.
    TextEncoder.prototype.encode = function (this: unknown, ...args: [string?]) {
      const out = originalEncode.apply(this, args);
      if (args[0] === "correct-horse-battery-staple") {
        captured = out;
      }
      return out;
    } as typeof originalEncode;
    try {
      const salt = generateSalt();
      const key = deriveMasterKey("correct-horse-battery-staple", salt, ARGON2ID_PROFILES.ci);
      assert.equal(key.length, 32);
    } finally {
      TextEncoder.prototype.encode = originalEncode;
    }
    assert.ok(captured, "expected to capture the intermediate password buffer");
    const bytes: Uint8Array = captured as Uint8Array;
    assert.ok(
      Array.from(bytes).every((byte) => byte === 0),
      "deriveMasterKey must zeroize its intermediate UTF-8 password buffer before returning",
    );
  });
});

describe("Adversarial: test-only API leakage", () => {
  it("the production entry point does not export any caller-controlled-nonce primitive", () => {
    const forbidden = [
      "encryptWithNonce",
      "wrapVaultKeyWithNonce",
      "encryptEntryWithNonce",
      "wrapDeviceKeyWithNonce",
      "deriveArgon2idRaw",
    ];
    for (const name of forbidden) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(index, name),
        false,
        `@4allpass/crypto must not export ${name} from its production entry point`,
      );
    }
  });

  it("the public encrypt() has no nonce parameter to accidentally pass", () => {
    // encrypt(key, plaintext, aad) — arity 3. If a fourth (nonce) parameter
    // were ever added to the public signature by mistake, this catches it.
    assert.equal(encrypt.length, 3);
  });
});
