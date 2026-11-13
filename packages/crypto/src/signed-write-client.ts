import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, equalBytes } from "./encoding/bytes.ts";
import { writeRequestBytesV2, writePublicKeyDigestV2, type WriteRequestV2 } from "./requester.ts";

// Runtime-neutral WebCrypto types: derived from the global so this package
// typechecks under both Node (tests) and the browser/desktop DOM lib without
// importing `node:crypto`, which the frontend project cannot resolve.
type CryptoLike = typeof globalThis.crypto;
type SubtleCryptoLike = NonNullable<CryptoLike["subtle"]>;
type CryptoKeyLike = Awaited<ReturnType<SubtleCryptoLike["importKey"]>>;

/** Copy into a plain ArrayBuffer so the value satisfies the DOM BufferSource. */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

/**
 * Client half of the v2 signed-write path (ADR-015 step 3).
 *
 * This module is deliberately fail-closed: it only signs when the actual
 * runtime exposes Ed25519 with PKCS#8 seed import. There is no unsigned
 * fallback and no v1 downgrade. Transport, vault-session and Vault-Key
 * derivation stay outside; the caller passes the 32-byte seed and the matching
 * public key.
 *
 * A Node or Playwright pass is NOT proof for macOS WKWebView. `probeSigner()`
 * is the runtime check the app must run before offering v2 writes; its result
 * must be recorded on the real target runtime.
 */

export const SIGNED_WRITE_SCHEME = "ed25519-v1";
export const WRITE_NONCE_BYTES = 16;
export const WRITE_SEED_BYTES = 32;
export const WRITE_PUBLIC_KEY_BYTES = 32;
export const WRITE_SIGNATURE_BYTES = 64;

export const SIGNED_WRITE_HEADERS = {
  scheme: "X-4AP-Write-Scheme",
  signature: "X-4AP-Write-Signature",
  nextSignature: "X-4AP-Write-Next-Signature",
  operationId: "X-4AP-Write-Operation-Id",
  nonce: "X-4AP-Write-Nonce",
  timestamp: "X-4AP-Write-Timestamp",
  keyVersion: "X-4AP-Write-Key-Version",
  resultKeyVersion: "X-4AP-Write-Result-Key-Version",
  resourceType: "X-4AP-Write-Resource-Type",
  resourceId: "X-4AP-Write-Resource-Id",
  parentId: "X-4AP-Write-Parent-Id",
  baseRevision: "X-4AP-Write-Base-Revision",
  resultRevision: "X-4AP-Write-Result-Revision",
  nextPublicKey: "X-4AP-Write-Next-Public-Key",
  creationGrant: "X-4AP-Creation-Grant",
} as const;

const PKCS8_PREFIX = Uint8Array.from([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70,
  0x04, 0x22, 0x04, 0x20,
]);

export class SignerUnavailableError extends Error {
  readonly code = "signer_unavailable";
}

export class SignedWriteInputError extends Error {
  readonly code = "signed_write_input_invalid";
}

export interface SignerProbe {
  available: boolean;
  /** Reason when unavailable; never contains key material. */
  reason?: string;
}

function subtleCrypto(): SubtleCryptoLike | undefined {
  return globalThis.crypto?.subtle;
}

function pkcs8FromSeed(seed: Uint8Array): Uint8Array {
  if (seed.length !== WRITE_SEED_BYTES) {
    throw new SignedWriteInputError("seed must be 32 bytes");
  }
  const out = new Uint8Array(PKCS8_PREFIX.length + seed.length);
  out.set(PKCS8_PREFIX);
  out.set(seed, PKCS8_PREFIX.length);
  return out;
}

async function importSeed(
  seed: Uint8Array,
  subtle: SubtleCryptoLike | undefined = subtleCrypto(),
): Promise<CryptoKeyLike> {
  if (!subtle) throw new SignerUnavailableError("no SubtleCrypto");
  const der = pkcs8FromSeed(seed);
  try {
    return await subtle.importKey("pkcs8", toArrayBuffer(der), "Ed25519", false, ["sign"]);
  } catch {
    throw new SignerUnavailableError("Ed25519 PKCS#8 import is unavailable");
  } finally {
    der.fill(0);
  }
}

/**
 * Runtime capability probe: imports a PKCS#8 seed and reproduces the RFC 8032
 * §7.1 TEST 1 signature. A user agent that cannot sign the known vector cannot
 * produce a v2 write either.
 */
export async function probeSigner(
  options: { subtle?: SubtleCryptoLike | null } = {},
): Promise<SignerProbe> {
  const subtle = options.subtle === undefined ? subtleCrypto() : options.subtle ?? undefined;
  if (!subtle) return { available: false, reason: "no SubtleCrypto" };
  const seed = Uint8Array.from(
    "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60"
      .match(/.{2}/g)!
      .map((pair) => Number.parseInt(pair, 16)),
  );
  const publicKey = Uint8Array.from(
    "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a"
      .match(/.{2}/g)!
      .map((pair) => Number.parseInt(pair, 16)),
  );
  const expected =
    "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b";
  try {
    const privateKey = await importSeed(seed, subtle);
    const signature = new Uint8Array(await subtle.sign("Ed25519", privateKey, new Uint8Array(0)));
    if (bytesToHex(signature) !== expected) {
      return { available: false, reason: "Ed25519 sign does not match RFC 8032" };
    }
    const verifyKey = await subtle.importKey("raw", publicKey, "Ed25519", false, ["verify"]);
    const verified = await subtle.verify("Ed25519", verifyKey, signature, new Uint8Array(0));
    return verified ? { available: true } : { available: false, reason: "Ed25519 verify failed" };
  } catch {
    // Never echo an underlying error object: it can carry runtime internals.
    return { available: false, reason: "Ed25519 probe failed" };
  }
}

export interface SignedWriteKey {
  seed: Uint8Array;
  /** Raw 32-byte public key, supplied by the key-derivation owner (C). */
  publicKey: Uint8Array;
}

export interface SignedWriteFields {
  vaultId: string;
  deviceId: string;
  method: string;
  route: string;
  resourceType: WriteRequestV2["resourceType"];
  resourceId: string;
  parentId: string;
  baseRevision: number;
  resultRevision: number;
  keyVersion: number;
  resultKeyVersion: number;
  hasManifest: boolean;
  manifestDigest: Uint8Array;
  payloadDigest: Uint8Array;
  hasNextKey: boolean;
  nextPublicKeyDigest: Uint8Array;
  operationId: string;
  nonce: Uint8Array;
  timestamp: number;
}

export interface SignedWriteBundle {
  request: WriteRequestV2;
  canonical: Uint8Array;
  signature: Uint8Array;
  headers: Record<string, string>;
}

function b64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function utf8b64url(value: string): string {
  return b64url(new TextEncoder().encode(value));
}

/**
 * A signing backend. The canonical bytes are produced by the shared encoder;
 * a backend only signs them and exposes the matching public key. The desktop
 * app uses the native Tauri signer (the webview's PKCS#8 import is broken on
 * the shipped WK runtime); Node/tests use WebCrypto. Neither falls back to
 * unsigned.
 */
export interface WriteSigner {
  /** Raw 32-byte public key belonging to the signing seed. */
  readonly publicKey: Uint8Array;
  sign(canonical: Uint8Array): Promise<Uint8Array>;
  /** Drop backend references and wipe any owned seed buffer after one operation. */
  dispose?(): void;
}

/** WebCrypto backend: import the PKCS#8 seed once, sign with Ed25519. */
export async function webCryptoWriteSigner(key: SignedWriteKey): Promise<WriteSigner> {
  const privateKey = await importSeed(key.seed);
  const subtle = subtleCrypto()!;
  return {
    publicKey: key.publicKey,
    sign: async (canonical) => new Uint8Array(await subtle.sign("Ed25519", privateKey, toArrayBuffer(canonical))),
  };
}

/**
 * Build and sign one write with an explicit backend. The canonical bytes are
 * produced by the shared encoder, so client and server cannot drift; nothing
 * here falls back to unsigned when signing fails.
 */
export async function signWriteV2WithSigner(
  fields: SignedWriteFields,
  signer: WriteSigner,
  next?: WriteSigner,
): Promise<SignedWriteBundle> {
  if (signer.publicKey.length !== WRITE_PUBLIC_KEY_BYTES) {
    throw new SignedWriteInputError("publicKey must be 32 bytes");
  }
  if (fields.nonce.length !== WRITE_NONCE_BYTES) {
    throw new SignedWriteInputError("nonce must be 16 bytes");
  }
  if (fields.hasNextKey !== Boolean(next)) {
    throw new SignedWriteInputError("hasNextKey and next key must agree");
  }
  if (fields.hasNextKey && next) {
    if (next.publicKey.length !== WRITE_PUBLIC_KEY_BYTES) {
      throw new SignedWriteInputError("next publicKey must be 32 bytes");
    }
    if (!equalBytes(writePublicKeyDigestV2(next.publicKey), fields.nextPublicKeyDigest)) {
      throw new SignedWriteInputError("nextPublicKeyDigest does not match next key");
    }
  }
  const request: WriteRequestV2 = {
    vaultId: fields.vaultId,
    deviceId: fields.deviceId,
    method: fields.method,
    route: fields.route,
    resourceType: fields.resourceType,
    resourceId: fields.resourceId,
    parentId: fields.parentId,
    baseRevision: fields.baseRevision,
    resultRevision: fields.resultRevision,
    signingKeyVersion: fields.keyVersion,
    resultKeyVersion: fields.resultKeyVersion,
    hasManifest: fields.hasManifest ? 1 : 0,
    manifestDigest: fields.hasManifest ? fields.manifestDigest : new Uint8Array(0),
    payloadDigest: fields.payloadDigest,
    hasNextKey: fields.hasNextKey ? 1 : 0,
    nextPublicKeyDigest: fields.hasNextKey ? fields.nextPublicKeyDigest : new Uint8Array(0),
    operationId: fields.operationId,
    nonce: fields.nonce,
    timestamp: fields.timestamp,
  };
  const canonical = writeRequestBytesV2(request);
  const signature = await signer.sign(canonical);
  const headers: Record<string, string> = {
    [SIGNED_WRITE_HEADERS.scheme]: SIGNED_WRITE_SCHEME,
    [SIGNED_WRITE_HEADERS.signature]: b64url(signature),
    [SIGNED_WRITE_HEADERS.operationId]: fields.operationId,
    [SIGNED_WRITE_HEADERS.nonce]: b64url(fields.nonce),
    [SIGNED_WRITE_HEADERS.timestamp]: String(fields.timestamp),
    [SIGNED_WRITE_HEADERS.keyVersion]: String(fields.keyVersion),
    [SIGNED_WRITE_HEADERS.resultKeyVersion]: String(fields.resultKeyVersion),
    [SIGNED_WRITE_HEADERS.resourceType]: fields.resourceType,
    [SIGNED_WRITE_HEADERS.resourceId]: utf8b64url(fields.resourceId),
    [SIGNED_WRITE_HEADERS.parentId]: utf8b64url(fields.parentId),
    [SIGNED_WRITE_HEADERS.baseRevision]: String(fields.baseRevision),
    [SIGNED_WRITE_HEADERS.resultRevision]: String(fields.resultRevision),
  };
  if (fields.hasNextKey && next) {
    headers[SIGNED_WRITE_HEADERS.nextPublicKey] = b64url(next.publicKey);
    headers[SIGNED_WRITE_HEADERS.nextSignature] = b64url(await next.sign(canonical));
  }
  return { request, canonical, signature, headers };
}

/**
 * Build and sign one write with the WebCrypto backend. The canonical bytes are
 * produced by the shared encoder, so client and server cannot drift; nothing
 * here falls back to unsigned when signing fails.
 */
export async function signWriteV2(
  fields: SignedWriteFields,
  key: SignedWriteKey,
  next?: SignedWriteKey,
): Promise<SignedWriteBundle> {
  const signer = await webCryptoWriteSigner(key);
  const nextSigner = next ? await webCryptoWriteSigner(next) : undefined;
  return signWriteV2WithSigner(fields, signer, nextSigner);
}

export interface SignedWriteExpectation {
  operationId: string;
  vaultId: string;
  route: string;
  resourceType: string;
  resourceId: string;
  parentId: string;
}

function validReceipt(payload: unknown, expected: SignedWriteExpectation): boolean {
  if (typeof payload !== "object" || payload === null) return false;
  const receipt = payload as Record<string, unknown>;
  const resource = receipt.resource as Record<string, unknown> | undefined;
  const outcome = receipt.outcome as Record<string, unknown> | undefined;
  return (
    receipt.schema === "4allpass-write-receipt-v1" &&
    receipt.bodyAvailable === false &&
    receipt.operationId === expected.operationId &&
    receipt.vaultId === expected.vaultId &&
    receipt.route === expected.route &&
    resource?.type === expected.resourceType &&
    resource?.id === expected.resourceId &&
    resource?.parentId === expected.parentId &&
    typeof outcome?.status === "number" &&
    outcome.status >= 200 &&
    outcome.status < 300
  );
}

export type SignedWriteOutcome =
  | { kind: "ok"; status: number; body: unknown }
  | { kind: "replayed"; status: number; receipt: unknown }
  | { kind: "rejected"; status: number; code: string }
  | { kind: "unknown"; reason: string };

/**
 * Map the server's answer without inventing success. A retry that cannot be
 * proven is UNKNOWN; it must reuse the same operation id/nonce, never mint a
 * new one.
 */
export function classifySignedWriteResponse(
  status: number,
  headers: Headers,
  payload: unknown,
  expected?: SignedWriteExpectation,
): SignedWriteOutcome {
  const replayHeader = headers.get("X-4AP-Write-Replayed") === "true";
  const success = status >= 200 && status < 300;
  if (success && replayHeader) {
    if (!expected) {
      return { kind: "unknown", reason: "missing_receipt_expectation" };
    }
    if (!validReceipt(payload, expected)) {
      return { kind: "unknown", reason: "invalid_replay_receipt" };
    }
    return { kind: "replayed", status, receipt: payload };
  }
  if (success) {
    return { kind: "ok", status, body: payload };
  }
  if (replayHeader) {
    return { kind: "unknown", reason: "replay_header_on_error" };
  }
  const detail =
    typeof payload === "object" && payload !== null && "detail" in payload
      ? String((payload as { detail: unknown }).detail)
      : "";
  if (status === 401 || status === 403 || status === 404 || status === 409 || status === 422) {
    return { kind: "rejected", status, code: detail || `http_${status}` };
  }
  return { kind: "unknown", reason: `http_${status}` };
}

/** Operation id + nonce for a destructive retry: reuse them verbatim. */
export function newWriteOperation(random: CryptoLike = globalThis.crypto): {
  operationId: string;
  nonce: Uint8Array;
} {
  return { operationId: random.randomUUID(), nonce: random.getRandomValues(new Uint8Array(WRITE_NONCE_BYTES)) };
}

/** Payload digest over the exact bytes that will be sent. */
export function payloadDigestV2(body: Uint8Array): Uint8Array {
  return sha256(body);
}
