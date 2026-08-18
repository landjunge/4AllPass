import {
  ARGON2_VERSION,
  HASH_LEN,
  PRODUCTION_ITERATIONS_MAX,
  PRODUCTION_ITERATIONS_MIN,
  PRODUCTION_MEMORY_KIB_MAX,
  PRODUCTION_MEMORY_KIB_MIN,
  PRODUCTION_PARALLELISM_MAX,
  PRODUCTION_PARALLELISM_MIN,
  SALT_BYTES_MAX,
  SALT_BYTES_MIN,
} from "../constants.ts";
import { ProtocolError } from "../errors.ts";
import { copyBytes } from "../validate.ts";
import type { Argon2idParams, Argon2idProfile, Argon2idProfileName, KdfParams } from "../types.ts";

function profile(
  name: Argon2idProfileName,
  memory: number,
  iterations: number,
  parallelism: number,
  production: boolean,
): Argon2idProfile {
  return {
    name,
    algorithm: "argon2id",
    version: ARGON2_VERSION,
    memory,
    iterations,
    parallelism,
    hashLen: HASH_LEN,
    production,
  };
}

export const ARGON2ID_PROFILES = {
  ci: profile("ci", 32, 3, 4, false),
  mobile_safe: profile("mobile_safe", 32_768, 3, 1, true),
  balanced: profile("balanced", 32_768, 6, 4, true),
  standard: profile("standard", 65_536, 3, 4, true),
  high: profile("high", 131_072, 4, 4, true),
} as const satisfies Record<Argon2idProfileName, Argon2idProfile>;

export const DEFAULT_PROFILE: Argon2idProfileName = "standard";

export function resolveProfile(name: Argon2idProfileName = DEFAULT_PROFILE): Argon2idProfile {
  return ARGON2ID_PROFILES[name];
}

/**
 * Absolute upper bounds on Argon2id parameters. Enforced on every path that
 * reads KDF parameters from an untrusted source (e.g. a Master Envelope served
 * by a possibly-malicious server), independent of the production floor and even
 * for the test profile. Without this, an inflated `memory` value turns unlock
 * into a client-side resource-exhaustion DoS.
 */
export function assertKdfUpperBounds(params: Argon2idParams): void {
  if (!Number.isInteger(params.memory) || params.memory > PRODUCTION_MEMORY_KIB_MAX) {
    throw new ProtocolError(
      `KDF memory ${String(params.memory)} KiB exceeds the maximum (${PRODUCTION_MEMORY_KIB_MAX} KiB)`,
    );
  }
  if (!Number.isInteger(params.iterations) || params.iterations > PRODUCTION_ITERATIONS_MAX) {
    throw new ProtocolError(
      `KDF iterations ${String(params.iterations)} exceeds the maximum (${PRODUCTION_ITERATIONS_MAX})`,
    );
  }
  if (!Number.isInteger(params.parallelism) || params.parallelism > PRODUCTION_PARALLELISM_MAX) {
    throw new ProtocolError(
      `KDF parallelism ${String(params.parallelism)} exceeds the maximum (${PRODUCTION_PARALLELISM_MAX})`,
    );
  }
}

/**
 * Shape and range check for KDF parameters that came back from the server.
 * `kdf.memory` is an allocation instruction: without an upper bound a hostile
 * envelope is a remote out-of-memory primitive, and without a lower bound it is
 * a silent KDF downgrade.
 *
 * This is the weakest acceptable check — it permits the test-only `ci` profile,
 * so it is only reachable behind an explicit `allowTestProfile`.
 */
export function assertKdfParamsWellFormed(params: Argon2idParams): void {
  if (params?.algorithm !== "argon2id") {
    throw new ProtocolError(`unsupported KDF: ${String(params?.algorithm)}`);
  }
  if (params.version !== ARGON2_VERSION) {
    throw new ProtocolError(`unsupported Argon2 version: ${String(params.version)}`);
  }
  if (params.hashLen !== HASH_LEN) {
    throw new ProtocolError(`hashLen must be ${HASH_LEN}, got ${String(params.hashLen)}`);
  }
  for (const [name, value] of [
    ["memory", params.memory],
    ["iterations", params.iterations],
    ["parallelism", params.parallelism],
  ] as const) {
    if (!Number.isInteger(value) || value < 1) {
      throw new ProtocolError(`KDF ${name} must be an integer >= 1, got ${String(value)}`);
    }
  }
  assertKdfUpperBounds(params);
}

export function assertKdfSalt(salt: unknown): Uint8Array {
  const bytes = copyBytes("kdf.salt", salt);
  if (bytes.length !== SALT_BYTES_MIN && bytes.length !== SALT_BYTES_MAX) {
    throw new ProtocolError(`kdf.salt must be ${SALT_BYTES_MIN} or ${SALT_BYTES_MAX} bytes`);
  }
  return bytes;
}

/** Well-formed **and** strong enough for a production vault. */
export function assertProductionKdf(params: Argon2idParams): void {
  assertKdfParamsWellFormed(params);
  if (params.memory < PRODUCTION_MEMORY_KIB_MIN) {
    throw new ProtocolError(
      `KDF memory ${params.memory} KiB is below the production floor (${PRODUCTION_MEMORY_KIB_MIN} KiB). The ci profile is test-only.`,
    );
  }
  if (params.iterations < PRODUCTION_ITERATIONS_MIN) {
    throw new ProtocolError(
      `KDF iterations ${params.iterations} is below the production floor (${PRODUCTION_ITERATIONS_MIN})`,
    );
  }
  if (params.parallelism < PRODUCTION_PARALLELISM_MIN) {
    throw new ProtocolError(
      `KDF parallelism ${params.parallelism} is below the production floor (${PRODUCTION_PARALLELISM_MIN})`,
    );
  }
}

/**
 * Full validation of the `kdf` block of a master envelope, including the salt,
 * returning a plain copy.
 *
 * The copy matters: the block is digested into the envelope AAD, and if the
 * caller's object exposed accessors instead of data properties, validating one
 * value and digesting another would be a time-of-check/time-of-use gap.
 */
export function assertKdfBlock(kdf: KdfParams, allowTestProfile: boolean): KdfParams {
  const block: KdfParams = {
    algorithm: kdf?.algorithm,
    version: kdf?.version,
    memory: kdf?.memory,
    iterations: kdf?.iterations,
    parallelism: kdf?.parallelism,
    hashLen: kdf?.hashLen,
    salt: kdf?.salt,
  };
  if (allowTestProfile) {
    assertKdfParamsWellFormed(block);
  } else {
    assertProductionKdf(block);
  }
  block.salt = assertKdfSalt(block.salt);
  return block;
}
