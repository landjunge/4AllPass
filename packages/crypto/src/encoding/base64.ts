import { ProtocolError } from "../errors.ts";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const REVERSE: Int16Array = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) {
    table[ALPHABET.charCodeAt(i)] = i;
  }
  return table;
})();

/** Standard base64 with padding. Wire format for every binary field. */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] as number;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += ALPHABET[b0 >>> 2];
    if (b1 === undefined) {
      out += ALPHABET[(b0 << 4) & 0x3f];
      out += "==";
      break;
    }
    out += ALPHABET[((b0 << 4) | (b1 >>> 4)) & 0x3f];
    if (b2 === undefined) {
      out += ALPHABET[(b1 << 2) & 0x3f];
      out += "=";
      break;
    }
    out += ALPHABET[((b1 << 2) | (b2 >>> 6)) & 0x3f];
    out += ALPHABET[b2 & 0x3f];
  }
  return out;
}

/**
 * Strict base64 decode. Rejects whitespace, base64url characters, and bad
 * padding: envelope bytes arrive from an untrusted server, so a lenient
 * decoder would let two different strings map to the same envelope.
 */
export function base64ToBytes(text: string): Uint8Array {
  if (text.length % 4 !== 0) {
    throw new ProtocolError("base64 length must be a multiple of 4");
  }
  let padding = 0;
  if (text.endsWith("==")) padding = 2;
  else if (text.endsWith("=")) padding = 1;
  const body = text.length - padding;
  const out = new Uint8Array((text.length / 4) * 3 - padding);
  let outIndex = 0;
  let accumulator = 0;
  let bits = 0;
  for (let i = 0; i < body; i++) {
    const code = text.charCodeAt(i);
    const value = code < 128 ? (REVERSE[code] as number) : -1;
    if (value < 0) {
      throw new ProtocolError(`invalid base64 character at index ${i}`);
    }
    accumulator = (accumulator << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[outIndex++] = (accumulator >>> bits) & 0xff;
    }
  }
  if (bits > 0 && (accumulator & ((1 << bits) - 1)) !== 0) {
    throw new ProtocolError("base64 has non-zero padding bits");
  }
  if (outIndex !== out.length) {
    throw new ProtocolError("base64 decoded to an unexpected length");
  }
  return out;
}
