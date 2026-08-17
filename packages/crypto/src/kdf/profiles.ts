import {
  ARGON2_VERSION,
  HASH_LEN,
  ITERATIONS_MAX,
  MEMORY_KIB_MAX,
  PARALLELISM_MAX,
  PRODUCTION_MEMORY_KIB_MIN,
} from "../constants.ts";
import { ProtocolError } from "../errors.ts";
import type { Argon2idParams, Argon2idProfile, Argon2idProfileName } from "../types.ts";

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
 * Structural + resource sanity for Argon2id params from any source
 * (including a hostile master envelope). Does NOT enforce the production
 * memory floor — see `assertProductionKdf`.
 */
export function assertSaneKdf(params: Argon2idParams): void {
  if (params.algorithm !== "argon2id") {
    throw new ProtocolError(`unsupported KDF: ${params.algorithm}`);
  }
  if (params.version !== ARGON2_VERSION) {
    throw new ProtocolError(`unsupported Argon2 version: ${params.version}`);
  }
  if (params.hashLen !== HASH_LEN) {
    throw new ProtocolError(`hashLen must be ${HASH_LEN}`);
  }
  if (!Number.isInteger(params.memory) || params.memory < 8 || params.memory > MEMORY_KIB_MAX) {
    throw new ProtocolError(`KDF memory out of bounds: ${params.memory} KiB (max ${MEMORY_KIB_MAX})`);
  }
  if (!Number.isInteger(params.iterations) || params.iterations < 1 || params.iterations > ITERATIONS_MAX) {
    throw new ProtocolError(`KDF iterations out of bounds: ${params.iterations} (max ${ITERATIONS_MAX})`);
  }
  if (!Number.isInteger(params.parallelism) || params.parallelism < 1 || params.parallelism > PARALLELISM_MAX) {
    throw new ProtocolError(`KDF parallelism out of bounds: ${params.parallelism} (max ${PARALLELISM_MAX})`);
  }
}

export function assertProductionKdf(params: Argon2idParams): void {
  assertSaneKdf(params);
  if (params.memory < PRODUCTION_MEMORY_KIB_MIN) {
    throw new ProtocolError(
      `KDF memory ${params.memory} KiB is below the production floor (${PRODUCTION_MEMORY_KIB_MIN} KiB). The ci profile is test-only.`,
    );
  }
}
