import { ARGON2_VERSION, HASH_LEN, PRODUCTION_MEMORY_KIB_MIN } from "../constants.ts";
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
}
