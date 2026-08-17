import { ProtocolError } from "../errors.ts";

/** Unpadded base64url. Used on the wire and in stored JSONB blobs. */
export function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function base64UrlToBytes(value: string): Uint8Array {
  if (value.length === 0) return new Uint8Array();
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new ProtocolError("invalid base64url");
  }
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  try {
    const bin = atob(padded + pad);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    throw new ProtocolError("invalid base64url");
  }
}
