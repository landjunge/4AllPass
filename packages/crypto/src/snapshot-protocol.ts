import { CRYPTO_PROTOCOL_VERSION, SIGNED_SNAPSHOT_PROTOCOL_VERSION } from "./constants.ts";
import { ProtocolError } from "./errors.ts";

/** A caller expectation, never an instruction inferred from a server header. */
export interface SnapshotProtocolOptions {
  cryptoProtocolVersion?: number;
}

export function assertSnapshotProtocolVersion(value: unknown): 1 | 2 {
  if (value !== CRYPTO_PROTOCOL_VERSION && value !== SIGNED_SNAPSHOT_PROTOCOL_VERSION) {
    throw new ProtocolError("snapshot cryptoProtocolVersion is not supported (expected 1 or 2)");
  }
  return value;
}

/** Existing callers retain their v1 reader, including the extension. */
export function expectedSnapshotProtocolVersion(options: SnapshotProtocolOptions): 1 | 2 {
  const version = options.cryptoProtocolVersion;
  return assertSnapshotProtocolVersion(
    version === undefined ? CRYPTO_PROTOCOL_VERSION : version,
  );
}
