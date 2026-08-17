import { argon2id } from "@noble/hashes/argon2.js";
import {
  ARGON2_MAXMEM_BYTES,
  ARGON2_VERSION,
  HASH_LEN,
  SALT_BYTES_MAX,
  SALT_BYTES_MIN,
} from "../constants.ts";
import { ProtocolError } from "../errors.ts";
import { utf8Nfc } from "../encoding/unicode.ts";
import { assertKdfUpperBounds, assertProductionKdf } from "./profiles.ts";
import type { Argon2idParams, KdfParams, KeyEnvelope } from "../types.ts";

export interface DeriveRawOptions {
  password: Uint8Array;
  salt: Uint8Array;
  params: Pick<Argon2idParams, "memory" | "iterations" | "parallelism" | "hashLen" | "version">;
  secret?: Uint8Array;
  associatedData?: Uint8Array;
}

/** Low-level Argon2id. Password is raw bytes (no NFC). Used by tests and RFC vectors. */
export function deriveArgon2idRaw(opts: DeriveRawOptions): Uint8Array {
  const { password, salt, params } = opts;
  if (salt.length < 8) {
    throw new ProtocolError(`salt must be at least 8 bytes (Argon2 minimum)`);
  }
  const dkLen = params.hashLen ?? HASH_LEN;
  const extra: { key?: Uint8Array; personalization?: Uint8Array } = {};
  if (opts.secret && opts.secret.length > 0) extra.key = opts.secret;
  if (opts.associatedData && opts.associatedData.length > 0) {
    extra.personalization = opts.associatedData;
  }
  return argon2id(password, salt, {
    t: params.iterations,
    m: params.memory,
    p: params.parallelism,
    dkLen,
    version: params.version ?? ARGON2_VERSION,
    // Fixed backstop — must never scale with the caller-supplied `memory`,
    // or a malicious value defeats the guard (see ARGON2_MAXMEM_BYTES).
    maxmem: ARGON2_MAXMEM_BYTES,
    ...extra,
  });
}

/** Derive the 256-bit Master Key. Password is NFC-normalized then UTF-8. */
export function deriveMasterKey(
  password: string,
  salt: Uint8Array,
  params: Argon2idParams,
): Uint8Array {
  if (salt.length !== SALT_BYTES_MIN && salt.length !== SALT_BYTES_MAX) {
    throw new ProtocolError(`salt must be ${SALT_BYTES_MIN} or ${SALT_BYTES_MAX} bytes`);
  }
  return deriveArgon2idRaw({
    password: utf8Nfc(password),
    salt,
    params,
  });
}

export interface DeriveMasterKeyFromEnvelopeOptions {
  /** Skip the production-floor check (test profiles only). Upper bounds are always enforced. */
  allowTestProfile?: boolean;
}

export function deriveMasterKeyFromEnvelope(
  password: string,
  envelope: KeyEnvelope,
  options: DeriveMasterKeyFromEnvelopeOptions = {},
): Uint8Array {
  if (envelope.type !== "master" || !envelope.kdf) {
    throw new ProtocolError("master envelope is missing kdf parameters");
  }
  const { salt, ...params } = envelope.kdf;
  // The envelope (and thus its kdf field) is untrusted server-provided data.
  // Always enforce the upper bounds to prevent a resource-exhaustion DoS;
  // enforce the production floor too unless a test profile is explicitly allowed.
  if (options.allowTestProfile) {
    assertKdfUpperBounds(params);
  } else {
    assertProductionKdf(params);
  }
  return deriveMasterKey(password, salt, params);
}

export function kdfParamsFrom(params: Argon2idParams, salt: Uint8Array): KdfParams {
  return {
    algorithm: "argon2id",
    version: params.version,
    memory: params.memory,
    iterations: params.iterations,
    parallelism: params.parallelism,
    hashLen: params.hashLen,
    salt,
  };
}
