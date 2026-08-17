import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CryptoError,
  IntegrityError,
  ProtocolError,
  bytesToHex,
  buildManifest,
  decryptEntry,
  deriveDeviceWrappingKey,
  deriveRecoveryWrappingKey,
  encryptEntry,
  entryAad,
  envelopeAad,
  envelopeDigest,
  evaluateRevision,
  manifestAad,
  openManifest,
  revisionFromManifest,
  sealManifest,
  unwrapVaultKey,
  utf8,
  verifySnapshot,
  wrapVaultKey,
  type EncryptedEntry,
  type KeyEnvelope,
} from "../src/index.ts";
import { C, VKV, deviceKey, vaultKey } from "./fixtures.ts";

/**
 * Regressions for the second review pass over the manifest, which found that
 * verification and use could read different values, and that two distinct
 * identifiers could share one cryptographic identity.
 */

const REVISION = 7;

function entryAt(entryId: string, secret: string): EncryptedEntry {
  return encryptEntry({
    vaultKey,
    vaultId: C.vault_id,
    entryId,
    vaultKeyVersion: VKV,
    plaintext: new TextEncoder().encode(secret),
  });
}

function deviceEnvelopeFor(deviceId: string): KeyEnvelope {
  return wrapVaultKey({
    vaultKey,
    wrappingKey: deviceKey,
    vaultId: C.vault_id,
    type: "device",
    vaultKeyVersion: VKV,
    deviceId,
    deviceKeyVersion: 1,
  });
}

/** A record whose fields answer honestly `honestReads` times, then switch. */
function swappingRecord<T extends object>(honest: T, stale: T, honestReads: number): T {
  const counters = new Map<string | symbol, number>();
  return new Proxy(honest, {
    get(target, prop, receiver) {
      const seen = (counters.get(prop) ?? 0) + 1;
      counters.set(prop, seen);
      const source = seen <= honestReads ? target : stale;
      return Reflect.get(source, prop, receiver === target ? source : receiver);
    },
  });
}

describe("attack: time-of-check/time-of-use on the snapshot", () => {
  it("digests the record it validated, not a second read of it", () => {
    const honest = entryAt("entry_bank", "password=NEW-SAFE");
    const stale = entryAt("entry_bank", "password=OLD-LEAKED");
    const envelopes = [deviceEnvelopeFor(C.device_id)];
    const manifest = buildManifest({
      vaultId: C.vault_id,
      revision: REVISION,
      vaultKeyVersion: VKV,
      entries: [honest],
      envelopes,
    });
    const sealed = sealManifest({ vaultKey, manifest });

    // A plain replay of the stale record is caught by the digest set.
    assert.throws(
      () =>
        verifySnapshot(
          sealed,
          { entries: [stale], envelopes },
          { vaultKey, vaultId: C.vault_id, revision: REVISION, vaultKeyVersion: VKV },
        ),
      IntegrityError,
    );

    // The same record behind accessors must not do any better, whatever the
    // number of honest reads the attacker tunes it to.
    for (const honestReads of [0, 1, 2, 3, 4]) {
      const verified = (() => {
        try {
          return verifySnapshot(
            sealed,
            { entries: [swappingRecord(honest, stale, honestReads)], envelopes },
            { vaultKey, vaultId: C.vault_id, revision: REVISION, vaultKeyVersion: VKV },
          );
        } catch (error) {
          assert.ok(error instanceof CryptoError, `honestReads=${honestReads}: ${String(error)}`);
          return null;
        }
      })();
      if (verified === null) continue;
      // If verification passed, the records it returns must be the honest ones:
      // the caller decrypts these, not the object it handed in.
      const record = verified.entries[0];
      assert.ok(record);
      const plaintext = new TextDecoder().decode(
        decryptEntry(record, {
          vaultKey,
          vaultId: C.vault_id,
          entryId: "entry_bank",
          vaultKeyVersion: VKV,
        }),
      );
      assert.equal(plaintext, "password=NEW-SAFE", `honestReads=${honestReads}`);
    }
  });

  it("returns records that are plain data, decoupled from the caller's objects", () => {
    const entry = entryAt("entry_bank", "password=NEW-SAFE");
    const envelopes = [deviceEnvelopeFor(C.device_id)];
    const manifest = buildManifest({
      vaultId: C.vault_id,
      revision: REVISION,
      vaultKeyVersion: VKV,
      entries: [entry],
      envelopes,
    });
    const sealed = sealManifest({ vaultKey, manifest });
    const verified = verifySnapshot(
      sealed,
      { entries: [entry], envelopes },
      { vaultKey, vaultId: C.vault_id, revision: REVISION, vaultKeyVersion: VKV },
    );
    const record = verified.entries[0];
    assert.ok(record);
    assert.notEqual(record, entry);
    assert.notEqual(record.ciphertext, entry.ciphertext);
    assert.equal(bytesToHex(record.ciphertext), bytesToHex(entry.ciphertext));
    const envelope = verified.envelopes[0];
    assert.ok(envelope);
    assert.notEqual(envelope, envelopes[0]);
    assert.deepEqual(
      unwrapVaultKey(envelope, {
        wrappingKey: deviceKey,
        vaultId: C.vault_id,
        expectType: "device",
        expectVaultKeyVersion: VKV,
        expectDeviceId: C.device_id,
        expectDeviceKeyVersion: 1,
      }),
      vaultKey,
    );
  });

  it("refuses a substituted device envelope hidden behind accessors", () => {
    const entries = [entryAt("entry_bank", "password=NEW-SAFE")];
    const trusted = deviceEnvelopeFor(C.device_id);
    const revoked = deviceEnvelopeFor(C.device_id);
    const manifest = buildManifest({
      vaultId: C.vault_id,
      revision: REVISION,
      vaultKeyVersion: VKV,
      entries,
      envelopes: [trusted],
    });
    const sealed = sealManifest({ vaultKey, manifest });
    const trustedDigest = bytesToHex(manifest.envelopes[0]?.digest as Uint8Array);
    for (const honestReads of [0, 1, 2, 3, 4]) {
      let verified;
      try {
        verified = verifySnapshot(
          sealed,
          { entries, envelopes: [swappingRecord(trusted, revoked, honestReads)] },
          { vaultKey, vaultId: C.vault_id, revision: REVISION, vaultKeyVersion: VKV },
        );
      } catch (error) {
        assert.ok(error instanceof CryptoError, `honestReads=${honestReads}: ${String(error)}`);
        continue;
      }
      // Accepting is only allowed when the record it accepted really is the
      // trusted one — and then that is the record it hands back.
      const envelope = verified.envelopes[0];
      assert.ok(envelope);
      assert.equal(
        bytesToHex(envelopeDigest(envelope)),
        trustedDigest,
        `honestReads=${honestReads}`,
      );
      assert.equal(bytesToHex(envelope.ciphertext), bytesToHex(trusted.ciphertext));
    }
  });

  it("digests the KDF block it validated", () => {
    const strong = {
      algorithm: "argon2id" as const,
      version: 0x13 as const,
      memory: 65536,
      iterations: 3,
      parallelism: 4,
      hashLen: 32 as const,
      salt: new Uint8Array(16).fill(1),
    };
    const weak = { ...strong, memory: 8, iterations: 1, parallelism: 1 };
    const envelope = wrapVaultKey({
      vaultKey,
      wrappingKey: new Uint8Array(32).fill(5),
      vaultId: C.vault_id,
      type: "master",
      vaultKeyVersion: VKV,
      kdf: swappingRecord(strong, weak, 7),
    });
    // The stored block is the validated copy, so the envelope cannot end up
    // sealed under a digest of parameters that were never checked.
    assert.deepEqual(envelope.kdf, strong);
  });
});

describe("attack: identifier collisions through ill-formed UTF-16", () => {
  const loneHigh = `vault_${"\uD800"}`;
  const loneLow = `vault_${"\uDC00"}`;
  const replacement = `vault_${"\uFFFD"}`;

  it("refuses identifiers that have no UTF-8 encoding", () => {
    for (const id of [loneHigh, loneLow]) {
      assert.throws(
        () => entryAad({ vaultId: id, entryId: "e", schemaVersion: 1, cryptoVersion: 1, vaultKeyVersion: 1 }),
        ProtocolError,
      );
      assert.throws(
        () =>
          envelopeAad({
            vaultId: id,
            type: "master",
            cryptoVersion: 1,
            vaultKeyVersion: 1,
            deviceId: "",
            deviceKeyVersion: 0,
          }),
        ProtocolError,
      );
      assert.throws(
        () => manifestAad({ vaultId: id, cryptoVersion: 1, revision: 1, vaultKeyVersion: 1 }),
        ProtocolError,
      );
      assert.throws(() => utf8(id), ProtocolError);
    }
    // The well-formed replacement character stays perfectly usable.
    assert.equal(bytesToHex(utf8(replacement)).endsWith("efbfbd"), true);
  });

  it("refuses them on every path that takes an identifier", () => {
    assert.throws(
      () =>
        encryptEntry({
          vaultKey,
          vaultId: loneHigh,
          entryId: "entry_x",
          vaultKeyVersion: VKV,
          plaintext: new Uint8Array([1]),
        }),
      ProtocolError,
    );
    assert.throws(
      () =>
        wrapVaultKey({
          vaultKey,
          wrappingKey: deviceKey,
          vaultId: C.vault_id,
          type: "device",
          vaultKeyVersion: VKV,
          deviceId: loneLow,
          deviceKeyVersion: 1,
        }),
      ProtocolError,
    );
    assert.throws(
      () =>
        deriveDeviceWrappingKey({
          prfOutput: new Uint8Array(32).fill(3),
          rpId: loneHigh,
          vaultId: C.vault_id,
          deviceId: C.device_id,
          credentialId: new Uint8Array(16).fill(1),
        }),
      ProtocolError,
    );
    assert.throws(
      () => deriveRecoveryWrappingKey({ recoveryKey: new Uint8Array(32).fill(4), vaultId: loneLow }),
      ProtocolError,
    );
  });
});

describe("attack: desynchronizing the pinned manifest digest", () => {
  it("pins the digest of the blob that was actually verified", () => {
    const entries = [entryAt("entry_bank", "password=NEW-SAFE")];
    const envelopes = [deviceEnvelopeFor(C.device_id)];
    const manifest = buildManifest({
      vaultId: C.vault_id,
      revision: REVISION,
      vaultKeyVersion: VKV,
      entries,
      envelopes,
    });
    const opts = { vaultKey, vaultId: C.vault_id, revision: REVISION, vaultKeyVersion: VKV };
    // Two seals of the same manifest differ only in their nonce.
    const blobA = sealManifest({ vaultKey, manifest });
    const blobB = sealManifest({ vaultKey, manifest });
    assert.notEqual(bytesToHex(blobA.nonce), bytesToHex(blobB.nonce));

    const verifiedA = openManifest(blobA, opts);
    const pinA = revisionFromManifest(verifiedA);
    assert.equal(bytesToHex(pinA.manifestDigest as Uint8Array), bytesToHex(verifiedA.sealedDigest));

    // Re-serving the very blob that was pinned is accepted…
    assert.equal(evaluateRevision(pinA, revisionFromManifest(openManifest(blobA, opts))).ok, true);
    // …and a different blob for the same revision is equivocation.
    const decision = evaluateRevision(pinA, revisionFromManifest(openManifest(blobB, opts)));
    assert.equal(decision.ok, false);
    if (!decision.ok) assert.match(decision.error.message, /equivocation/);
  });
});

describe("attack: hostile container shapes", () => {
  const entries = [entryAt("entry_bank", "password=NEW-SAFE")];
  const envelopes = [deviceEnvelopeFor(C.device_id)];
  const manifest = buildManifest({
    vaultId: C.vault_id,
    revision: REVISION,
    vaultKeyVersion: VKV,
    entries,
    envelopes,
  });
  const sealed = sealManifest({ vaultKey, manifest });
  const opts = { vaultKey, vaultId: C.vault_id, revision: REVISION, vaultKeyVersion: VKV };

  const sparse: EncryptedEntry[] = [];
  sparse[1] = entries[0] as EncryptedEntry;

  for (const [label, hostile] of [
    ["a sparse array (JSON hole)", sparse],
    ["an array-like object", { 0: entries[0], length: 1 } as unknown as EncryptedEntry[]],
    ["null", null as unknown as EncryptedEntry[]],
    ["a null element", [null as unknown as EncryptedEntry]],
    ["a string", "entries" as unknown as EncryptedEntry[]],
  ] as const) {
    it(`reports ${label} as an integrity failure, not a raw TypeError`, () => {
      assert.throws(
        () => verifySnapshot(sealed, { entries: hostile, envelopes }, opts),
        (error: unknown) => error instanceof IntegrityError,
      );
    });
  }
});

describe("error taxonomy on the snapshot path", () => {
  const entries = [entryAt("entry_bank", "one"), entryAt("entry_mail", "two")];
  const envelopes = [deviceEnvelopeFor(C.device_id)];
  const manifest = buildManifest({
    vaultId: C.vault_id,
    revision: REVISION,
    vaultKeyVersion: VKV,
    entries,
    envelopes,
  });
  const sealed = sealManifest({ vaultKey, manifest });
  const opts = { vaultKey, vaultId: C.vault_id, revision: REVISION, vaultKeyVersion: VKV };
  const first = entries[0] as EncryptedEntry;

  const cases: Array<[string, () => unknown]> = [
    ["an entry served twice", () => verifySnapshot(sealed, { entries: [first, first], envelopes }, opts)],
    [
      "a corrupted envelope type",
      () =>
        verifySnapshot(
          sealed,
          { entries, envelopes: [{ ...(envelopes[0] as KeyEnvelope), type: "bogus" as never }] },
          opts,
        ),
    ],
    [
      "a truncated envelope ciphertext",
      () =>
        verifySnapshot(
          sealed,
          {
            entries,
            envelopes: [
              {
                ...(envelopes[0] as KeyEnvelope),
                ciphertext: (envelopes[0] as KeyEnvelope).ciphertext.slice(0, 16),
              },
            ],
          },
          opts,
        ),
    ],
    [
      "an entry ciphertext that is a JSON array",
      () =>
        verifySnapshot(
          sealed,
          { entries: [{ ...first, ciphertext: [...first.ciphertext] as never }, entries[1] as EncryptedEntry], envelopes },
          opts,
        ),
    ],
  ];

  for (const [label, run] of cases) {
    it(`reports ${label} as an integrity failure`, () => {
      assert.throws(run, (error: unknown) => error instanceof IntegrityError, label);
    });
  }
});
