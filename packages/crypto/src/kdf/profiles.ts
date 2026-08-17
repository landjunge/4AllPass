import {
  ARGON2_VERSION,
  HASH_LEN,
  KDF_ITERATIONS_MAX,
  KDF_MEMORY_KIB_MAX,
  KDF_PARALLELISM_MAX,
  PRODUCTION_MEMORY_KIB_MIN,
  SALT_BYTES_MAX,
  SALT_BYTES_MIN,
} from "../constants.ts";
import { ProtocolError } from "../errors.ts";
import { assertBytes } from "../validate.ts";
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
 * Shape and range check for KDF parameters that came back from the server.
 * `kdf.memory` is an allocation instruction: without an upper bound a hostile
 * envelope is a remote out-of-memory primitive, and without a lower bound it is
 * a silent KDF downgrade.
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
  for (const [name, value, max] of [
    ["memory", params.memory, KDF_MEMORY_KIB_MAX],
    ["iterations", params.iterations, KDF_ITERATIONS_MAX],
    ["parallelism", params.parallelism, KDF_PARALLELISM_MAX],
  ] as const) {
    if (!Number.isInteger(value) || value < 1 || value > max) {
      throw new ProtocolError(`KDF ${name} must be an integer in [1, ${max}], got ${String(value)}`);
    }
  }
}

export function assertKdfSalt(salt: unknown): Uint8Array {
  const bytes = assertBytes("kdf.salt", salt);
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
}

/** Full validation of the `kdf` block of a master envelope, including the salt. */
export function assertKdfBlock(kdf: KdfParams, allowTestProfile: boolean): void {
  if (allowTestProfile) {
    assertKdfParamsWellFormed(kdf);
  } else {
    assertProductionKdf(kdf);
  }
  assertKdfSalt(kdf.salt);
}
