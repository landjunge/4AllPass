import { ProtocolError } from "../errors.ts";

export function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export function u16be(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 0 || n > 0xffff) {
    throw new ProtocolError(`uint16 out of range: ${n}`);
  }
  const b = new Uint8Array(2);
  b[0] = (n >>> 8) & 0xff;
  b[1] = n & 0xff;
  return b;
}

export function u32be(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) {
    throw new ProtocolError(`uint32 out of range: ${n}`);
  }
  const b = new Uint8Array(4);
  b[0] = (n >>> 24) & 0xff;
  b[1] = (n >>> 16) & 0xff;
  b[2] = (n >>> 8) & 0xff;
  b[3] = n & 0xff;
  return b;
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function isWellFormed(s: string): boolean {
  const check = (s as { isWellFormed?: () => boolean }).isWellFormed;
  return typeof check === "function" ? check.call(s) : !LONE_SURROGATE.test(s);
}

/**
 * UTF-8 of a string, refusing ill-formed UTF-16.
 *
 * `TextEncoder` replaces every unpaired surrogate with U+FFFD, so `"\uD800"`,
 * `"\uDC00"` and `"\uFFFD"` would all encode to the same three bytes. Since these
 * bytes end up in AAD and in digest preimages, that silent replacement would
 * collapse distinct identifiers into one cryptographic identity.
 */
export function utf8(s: string): Uint8Array {
  if (!isWellFormed(s)) {
    throw new ProtocolError("string contains an unpaired surrogate and has no UTF-8 encoding");
  }
  return new TextEncoder().encode(s);
}

/** Byte-order comparison of the UTF-8 encodings. Canonical ordering is defined on bytes. */
export function compareUtf8(a: string, b: string): number {
  const left = utf8(a);
  const right = utf8(b);
  const shared = Math.min(left.length, right.length);
  for (let i = 0; i < shared; i++) {
    const diff = (left[i] as number) - (right[i] as number);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return left.length === right.length ? 0 : left.length < right.length ? -1 : 1;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new ProtocolError("hex length must be even");
  }
  if (hex.length > 0 && !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new ProtocolError("invalid hex");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

export function assertLength(name: string, bytes: Uint8Array, expected: number): void {
  if (bytes.length !== expected) {
    throw new ProtocolError(`${name} must be ${expected} bytes, got ${bytes.length}`);
  }
}
