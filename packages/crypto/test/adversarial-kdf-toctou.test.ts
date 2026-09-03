/**
 * KDF parameters are untrusted input: they normally arrive inside a Master
 * Envelope served by a possibly-malicious server. `assertKdfBlock` therefore
 * returns a flat copy, and every caller must derive from *that* copy.
 *
 * If a caller validates the copy but then reads the original object again, an
 * accessor can answer with a production profile during the check and with a
 * weakened one during derivation. The result is a Master Key derived at, say,
 * 8 KiB of memory while every guard reported 64 MiB — a silent KDF downgrade
 * that leaves no trace in the envelope.
 *
 * These tests count reads, so they fail on the read-twice shape itself rather
 * than on one particular hostile value.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ARGON2ID_PROFILES,
  deriveMasterKey,
  deriveMasterKeyFromEnvelope,
} from "../src/index.ts";
import type { Argon2idParams, KeyEnvelope } from "../src/types.ts";

const SAFE = ARGON2ID_PROFILES.standard;
const SALT = new Uint8Array(16).fill(7);
const PASSWORD = "correct horse battery staple";

/** Params that look like a production profile once, then degrade. */
function decayingParams(): { params: Argon2idParams; reads: () => number } {
  let reads = 0;
  const params = {
    algorithm: "argon2id",
    version: SAFE.version,
    hashLen: SAFE.hashLen,
    parallelism: SAFE.parallelism,
    get memory() {
      reads += 1;
      return reads <= 1 ? SAFE.memory : 8;
    },
    get iterations() {
      return reads <= 1 ? SAFE.iterations : 1;
    },
  } as unknown as Argon2idParams;
  return { params, reads: () => reads };
}

describe("KDF parameters are read exactly once", () => {
  it("deriveMasterKey does not re-read caller-supplied params after validating them", () => {
    const { params, reads } = decayingParams();

    // Either outcome is safe: reject the object, or derive from the validated
    // copy. What must not happen is a second read reaching Argon2id.
    try {
      deriveMasterKey(PASSWORD, SALT, params);
    } catch {
      /* rejecting hostile parameter shapes is an acceptable outcome */
    }

    assert.ok(reads() <= 1, `kdf params were read ${reads()} times; expected at most 1`);
  });

  it("a downgraded second read cannot change the derived key", () => {
    const { params } = decayingParams();
    const fromHostile = deriveMasterKey(PASSWORD, SALT, params);
    const fromHonest = deriveMasterKey(PASSWORD, SALT, {
      algorithm: "argon2id",
      version: SAFE.version,
      memory: SAFE.memory,
      iterations: SAFE.iterations,
      parallelism: SAFE.parallelism,
      hashLen: SAFE.hashLen,
    } as Argon2idParams);

    // The validated values are the production profile, so the key must match
    // the one derived from those values spelled out honestly.
    assert.deepEqual(Array.from(fromHostile), Array.from(fromHonest));
  });

  it("deriveMasterKeyFromEnvelope flattens the envelope kdf block before use", () => {
    const { params, reads } = decayingParams();
    const envelope = {
      type: "master",
      kdf: { ...{ salt: SALT }, ...describeGetters(params) },
    } as unknown as KeyEnvelope;

    try {
      deriveMasterKeyFromEnvelope(PASSWORD, envelope);
    } catch {
      /* shape rejection is acceptable */
    }

    assert.ok(reads() <= 1, `kdf params were read ${reads()} times; expected at most 1`);
  });
});

/** Re-expose the accessors so the envelope carries them rather than plain values. */
function describeGetters(source: object): object {
  return Object.defineProperties({}, Object.getOwnPropertyDescriptors(source));
}
