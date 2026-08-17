import { ID_BYTES_MAX, REVISION_MAX, VERSION_MAX } from "./constants.ts";
import { equalBytes, utf8 } from "./encoding/bytes.ts";
import { IntegrityError, ProtocolError } from "./errors.ts";

/**
 * Input validation for everything that crosses the trust boundary.
 *
 * Two error classes, deliberately different:
 * - `ProtocolError`  — the value is malformed (wrong type, wrong length, out of range).
 * - `IntegrityError` — the value is well-formed but contradicts what the caller asked for.
 *   That is the signature of a substitution attack, not of a bug.
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

export function assertId(name: string, value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ProtocolError(`${name} must be a non-empty string`);
  }
  const bytes = utf8(value).length;
  if (bytes > ID_BYTES_MAX) {
    throw new ProtocolError(`${name} must be at most ${ID_BYTES_MAX} UTF-8 bytes, got ${bytes}`);
  }
  return value;
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
