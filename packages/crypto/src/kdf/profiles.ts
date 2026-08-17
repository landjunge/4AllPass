import {
  ARGON2_VERSION,
  HASH_LEN,
  PRODUCTION_ITERATIONS_MAX,
  PRODUCTION_ITERATIONS_MIN,
  PRODUCTION_MEMORY_KIB_MAX,
  PRODUCTION_MEMORY_KIB_MIN,
  PRODUCTION_PARALLELISM_MAX,
  PRODUCTION_PARALLELISM_MIN,
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
 * Absolute upper bounds on Argon2id parameters. Enforced on every path that
 * reads KDF parameters from an untrusted source (e.g. a Master Envelope
 * served by a possibly-malicious server), independent of the production
 * floor and even for the test profile. Without this, an inflated `memory`
 * value turns unlock into a client-side resource-exhaustion DoS.
 */
export function assertKdfUpperBounds(params: Argon2idParams): void {
  if (!Number.isInteger(params.memory) || params.memory > PRODUCTION_MEMORY_KIB_MAX) {
    throw new ProtocolError(
      `KDF memory ${params.memory} KiB exceeds the maximum (${PRODUCTION_MEMORY_KIB_MAX} KiB)`,
    );
  }
  if (!Number.isInteger(params.iterations) || params.iterations > PRODUCTION_ITERATIONS_MAX) {
    throw new ProtocolError(
      `KDF iterations ${params.iterations} exceeds the maximum (${PRODUCTION_ITERATIONS_MAX})`,
    );
  }
  if (!Number.isInteger(params.parallelism) || params.parallelism > PRODUCTION_PARALLELISM_MAX) {
    throw new ProtocolError(
      `KDF parallelism ${params.parallelism} exceeds the maximum (${PRODUCTION_PARALLELISM_MAX})`,
    );
  }
}

export function assertProductionKdf(params: Argon2idParams): void {
  if (params.algorithm !== "argon2id") {
    throw new ProtocolError(`unsupported KDF: ${params.algorithm}`);
  }
  if (params.version !== ARGON2_VERSION) {
    throw new ProtocolError(`unsupported Argon2 version: ${params.version}`);
  }
  if (params.hashLen !== HASH_LEN) {
    throw new ProtocolError(`hashLen must be ${HASH_LEN}`);
  }
  if (params.memory < PRODUCTION_MEMORY_KIB_MIN) {
    throw new ProtocolError(
      `KDF memory ${params.memory} KiB is below the production floor (${PRODUCTION_MEMORY_KIB_MIN} KiB). The ci profile is test-only.`,
    );
  }
  if (!Number.isInteger(params.iterations) || params.iterations < PRODUCTION_ITERATIONS_MIN) {
    throw new ProtocolError(
      `KDF iterations ${params.iterations} is below the production floor (${PRODUCTION_ITERATIONS_MIN})`,
    );
  }
  if (!Number.isInteger(params.parallelism) || params.parallelism < PRODUCTION_PARALLELISM_MIN) {
    throw new ProtocolError(
      `KDF parallelism ${params.parallelism} is below the production floor (${PRODUCTION_PARALLELISM_MIN})`,
    );
  }
  assertKdfUpperBounds(params);
}
