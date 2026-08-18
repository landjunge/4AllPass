import { ENVELOPE_TYPES, ID_BYTES_MAX, REVISION_MAX, VERSION_MAX } from "./constants.ts";
import { equalBytes, utf8 } from "./encoding/bytes.ts";
import { IntegrityError, ProtocolError } from "./errors.ts";
import type { EnvelopeType } from "./types.ts";

/**
 * Input validation for everything that crosses the trust boundary.
 *
 * Three error classes, deliberately different, split by who can cause them:
 * - `ProtocolError`  — the value is malformed in a way no remote attacker can
 *   cause: wrong type, out of range, non-canonical. That is a local bug (usually
 *   a deserializer handing over arrays instead of `Uint8Array`).
 * - `AuthFailureError` — wrong *length* of AEAD material read from an untrusted
 *   blob. It is attacker-controlled framing and cannot authenticate; see
 *   `assertAeadFraming`.
 * - `IntegrityError` — the value is well-formed but contradicts what the caller
 *   asked for, or a snapshot does not match its manifest. That is the signature
 *   of a substitution attack, not of a bug.
 *
 * All three extend `CryptoError`, so a caller that cannot act on the difference
 * catches that.
 */

export function assertBytes(
  name: string,
  value: unknown,
  bounds: { exact?: number; min?: number; max?: number } = {},
): Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new ProtocolError(`${name} must be a Uint8Array`);
  }
  if (bounds.exact !== undefined && value.length !== bounds.exact) {
    throw new ProtocolError(`${name} must be ${bounds.exact} bytes, got ${value.length}`);
  }
  if (bounds.min !== undefined && value.length < bounds.min) {
    throw new ProtocolError(`${name} must be at least ${bounds.min} bytes, got ${value.length}`);
  }
  if (bounds.max !== undefined && value.length > bounds.max) {
    throw new ProtocolError(`${name} must be at most ${bounds.max} bytes, got ${value.length}`);
  }
  return value;
}

/**
 * Validate and copy, one read per byte.
 *
 * `assertBytes` only proves the value *is* a `Uint8Array` of the right length; a
 * `Proxy` over one satisfies that and can still answer differently every time its
 * bytes are read. Anything that will be both digested and used later must be
 * captured. `Uint8Array.from` is used rather than `slice()` because `slice`
 * requires the typed-array internal slot and throws a bare `TypeError` on a proxy.
 */
export function copyBytes(
  name: string,
  value: unknown,
  bounds: { exact?: number; min?: number; max?: number } = {},
): Uint8Array {
  const copy = Uint8Array.from(assertBytes(name, value, bounds));
  if (bounds.exact !== undefined && copy.length !== bounds.exact) {
    throw new ProtocolError(`${name} changed length while being read`);
  }
  return copy;
}

export function assertUint32(name: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > VERSION_MAX) {
    throw new ProtocolError(`${name} must be an integer in [0, ${VERSION_MAX}], got ${String(value)}`);
  }
  return value;
}

/** Versions are 1-based: 0 is reserved for "not applicable" inside AAD. */
export function assertVersion(name: string, value: unknown): number {
  const n = assertUint32(name, value);
  if (n < 1) {
    throw new ProtocolError(`${name} must be an integer >= 1`);
  }
  return n;
}

export function assertRevision(name: string, value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > REVISION_MAX
  ) {
    throw new ProtocolError(`${name} must be an integer in [1, ${REVISION_MAX}], got ${String(value)}`);
  }
  return value;
}

/**
 * Identifiers must be non-empty, bounded, and well-formed UTF-16 — an unpaired
 * surrogate would be encoded as U+FFFD, so two different ids would share one AAD.
 * `utf8` enforces well-formedness and throws for us.
 */
export function assertId(name: string, value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ProtocolError(`${name} must be a non-empty string`);
  }
  let bytes: number;
  try {
    bytes = utf8(value).length;
  } catch {
    throw new ProtocolError(`${name} contains an unpaired surrogate`);
  }
  if (bytes > ID_BYTES_MAX) {
    throw new ProtocolError(`${name} must be at most ${ID_BYTES_MAX} UTF-8 bytes, got ${bytes}`);
  }
  return value;
}

/**
 * A list of records that arrived from outside: a dense array of objects.
 * Sparse arrays (JSON holes) and array-likes must not reach a loop that would
 * dereference their elements.
 */
export function assertRecordList<T>(name: string, value: unknown): readonly T[] {
  if (!Array.isArray(value)) {
    throw new ProtocolError(`${name} must be an array`);
  }
  for (let i = 0; i < value.length; i++) {
    if (!(i in value)) {
      throw new ProtocolError(`${name}[${i}] is missing`);
    }
    const element: unknown = value[i];
    if (element === null || typeof element !== "object") {
      throw new ProtocolError(`${name}[${i}] must be an object`);
    }
  }
  return value as readonly T[];
}

export function assertEnvelopeType(value: unknown): EnvelopeType {
  if (typeof value !== "string" || !ENVELOPE_TYPES.includes(value as EnvelopeType)) {
    throw new ProtocolError(`unsupported envelope type: ${String(value)}`);
  }
  return value as EnvelopeType;
}

/** Same as `assertId` but allows the empty string (deviceId on non-device envelopes). */
export function assertOptionalId(name: string, value: unknown): string {
  if (value === undefined || value === "") return "";
  return assertId(name, value);
}

export function requireSameString(field: string, expected: string, actual: string): void {
  if (expected !== actual) {
    throw new IntegrityError(`${field} mismatch: expected ${expected}, got ${actual}`);
  }
}

export function requireSameNumber(field: string, expected: number, actual: number): void {
  if (expected !== actual) {
    throw new IntegrityError(`${field} mismatch: expected ${expected}, got ${actual}`);
  }
}

export function requireSameBytes(field: string, expected: Uint8Array, actual: Uint8Array): void {
  if (!equalBytes(expected, actual)) {
    throw new IntegrityError(`${field} mismatch`);
  }
}
