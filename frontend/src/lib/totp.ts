/**
 * RFC 6238 TOTP (HMAC-SHA-1). Not vault-envelope crypto.
 * The secret stays on the client; FastAPI never sees it.
 */

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function decodeBase32(input: string): Uint8Array {
  const normalized = input.toUpperCase().replace(/[\s=-]/g, "");
  if (!normalized) return new Uint8Array(0);
  let bits = 0;
  let buffer = 0;
  const out: number[] = [];
  for (const char of normalized) {
    const value = BASE32.indexOf(char);
    if (value < 0) throw new Error("totp secret is not base32");
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >>> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

export async function hmacSha1(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, data as BufferSource);
  return new Uint8Array(sig);
}

export async function hotp(secret: Uint8Array, counter: number, digits = 6): Promise<string> {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setUint32(0, Math.floor(counter / 0x1_0000_0000));
  view.setUint32(4, counter >>> 0);
  const hash = await hmacSha1(secret, new Uint8Array(buf));
  const offset = hash[hash.length - 1]! & 0x0f;
  const bin =
    ((hash[offset]! & 0x7f) << 24) |
    ((hash[offset + 1]! & 0xff) << 16) |
    ((hash[offset + 2]! & 0xff) << 8) |
    (hash[offset + 3]! & 0xff);
  const mod = 10 ** digits;
  return String(bin % mod).padStart(digits, "0");
}

export async function totp(
  secret: Uint8Array,
  unixSeconds = Date.now() / 1000,
  digits = 6,
  period = 30,
): Promise<string> {
  return hotp(secret, Math.floor(unixSeconds / period), digits);
}

export async function totpFromBase32(
  secret: string,
  unixSeconds = Date.now() / 1000,
  digits = 6,
  period = 30,
): Promise<string> {
  return totp(decodeBase32(secret), unixSeconds, digits, period);
}

export function totpRemaining(unixSeconds = Date.now() / 1000, period = 30): number {
  const t = Math.floor(unixSeconds);
  return period - (t % period);
}

export interface Otpauth {
  secret: string;
  issuer: string;
  account: string;
  digits: number;
  period: number;
}

export function parseOtpauth(uri: string): Otpauth | null {
  const raw = uri.trim();
  if (!/^otpauth:\/\/totp\//i.test(raw)) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  const secret = parsed.searchParams.get("secret")?.trim() ?? "";
  if (!secret) return null;
  const label = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  const colon = label.indexOf(":");
  const issuerParam = parsed.searchParams.get("issuer")?.trim() ?? "";
  const issuer = issuerParam || (colon > 0 ? label.slice(0, colon) : "");
  const account = colon > 0 ? label.slice(colon + 1) : label;
  const digits = Number(parsed.searchParams.get("digits") ?? "6");
  const period = Number(parsed.searchParams.get("period") ?? "30");
  return {
    secret: secret.toUpperCase().replace(/[\s=-]/g, ""),
    issuer,
    account,
    digits: digits === 8 ? 8 : 6,
    period: period > 0 ? period : 30,
  };
}
