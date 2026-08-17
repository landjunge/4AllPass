/**
 * Human transcription format for the 256-bit Recovery Key (crypto-protocol.md §6).
 * Base32 without padding, grouped in blocks of four, so it can be read off a
 * printed Emergency Kit.
 */
import { ProtocolError } from "@4allpass/crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function formatRecoveryKey(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(value >>> bits) & 31];
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return (out.match(/.{1,4}/g) ?? []).join("-");
}

export function parseRecoveryKey(text: string): Uint8Array {
  const cleaned = text.toUpperCase().replace(/[^A-Z2-7]/g, "");
  if (cleaned.length !== 52) {
    throw new ProtocolError("a recovery key has 52 characters");
  }
  const out = new Uint8Array(32);
  let bits = 0;
  let value = 0;
  let index = 0;
  for (const character of cleaned) {
    const digit = ALPHABET.indexOf(character);
    if (digit < 0) throw new ProtocolError("invalid recovery key character");
    value = (value << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out[index++] = (value >>> bits) & 0xff;
    }
  }
  if (index !== out.length) throw new ProtocolError("recovery key is incomplete");
  return out;
}
