/**
 * Protocol-agnostic requester identity.
 *
 * Not a vault Device envelope. A requester cannot unwrap a Vault Key.
 * The broker never stores a shared secret for this principal.
 *
 * Pattern taken from `unwrapDeviceKey`: the caller passes expectations
 * (`expectedRequesterId`) and we compare before treating a signature as
 * authentic. Private keys never enter this module — the device (secure
 * element) signs. Tests generate keys with SubtleCrypto Ed25519.
 *
 * Transport (HTTP, MCP, a vendor API, …) is out of scope. This module
 * only answers: is this public key the enrolled requester, and did it
 * sign these bytes?
 */
import { sha256 } from "@noble/hashes/sha2.js";
import {
  WRITE_V2_DIGEST_BYTES,
  WRITE_V2_ID_CHARS_MAX,
  WRITE_V2_LABEL,
  WRITE_V2_NONCE_BYTES,
  WRITE_V2_PUBLIC_KEY_LABEL,
} from "./constants.ts";
import { bytesToHex, utf8 } from "./encoding/bytes.ts";
import { frame } from "./encoding/framing.ts";
import { AuthFailureError, IntegrityError, ProtocolError } from "./errors.ts";
import { assertBytes } from "./validate.ts";

export const REQUESTER_PUBLIC_KEY_BYTES = 32;
export const REQUESTER_SIGNATURE_BYTES = 64;
export const REQUESTER_ID_PREFIX = "req:ed25519:";
const MESSAGE_BYTES_MAX = 64 * 1024;

export function requesterIdFromPublicKey(publicKey: Uint8Array): string {
  const key = assertBytes("requesterPublicKey", publicKey, {
    exact: REQUESTER_PUBLIC_KEY_BYTES,
  });
  return REQUESTER_ID_PREFIX + bytesToHex(sha256(key));
}

export interface RequesterEnrollment {
  requesterId: string;
  publicKey: Uint8Array;
}

/** Public half only. The private key stays on the device. */
export function enrollRequester(publicKey: Uint8Array): RequesterEnrollment {
  const key = assertBytes("requesterPublicKey", publicKey, {
    exact: REQUESTER_PUBLIC_KEY_BYTES,
  });
  return { requesterId: requesterIdFromPublicKey(key), publicKey: new Uint8Array(key) };
}

export interface VerifyRequesterSignatureOptions {
  publicKey: Uint8Array;
  signature: Uint8Array;
  message: Uint8Array;
  /** Caller's expected id. Compared before verify — substitution is IntegrityError. */
  expectedRequesterId: string;
}

export async function verifyRequesterSignature(
  opts: VerifyRequesterSignatureOptions,
): Promise<true> {
  const publicKey = assertBytes("requesterPublicKey", opts.publicKey, {
    exact: REQUESTER_PUBLIC_KEY_BYTES,
  });
  const signature = assertBytes("requesterSignature", opts.signature, {
    exact: REQUESTER_SIGNATURE_BYTES,
  });
  const message = assertBytes("requesterMessage", opts.message, {
    min: 1,
    max: MESSAGE_BYTES_MAX,
  });
  const gotId = requesterIdFromPublicKey(publicKey);
  if (gotId !== opts.expectedRequesterId) {
    throw new IntegrityError("requesterId does not match public key");
  }
  const ok = await ed25519Verify(publicKey, message, signature);
  if (!ok) {
    throw new AuthFailureError("requester signature is not valid");
  }
  return true;
}

/**
 * Rotation: the new public key is a new requester id. The old id is not
 * rewritten. Callers revoke the old enrollment separately (policy registry).
 * Vault `deviceKeyVersion` is the wrong tool — that rotates the vault, not
 * the requester.
 */
export function rotateRequester(newPublicKey: Uint8Array): RequesterEnrollment {
  return enrollRequester(newPublicKey);
}

/** Stable request bytes. Not RFC 8785; key order is fixed here. */
export function requesterRequestBytes(fields: {
  requesterId: string;
  nonce: string;
  timestamp: number;
  action: string;
  resource: string;
}): Uint8Array {
  if (!Number.isFinite(fields.timestamp) || !Number.isInteger(fields.timestamp)) {
    throw new ProtocolError("requester timestamp must be an integer");
  }
  return utf8(
    `{"action":${JSON.stringify(fields.action)},"nonce":${JSON.stringify(fields.nonce)},"requesterId":${JSON.stringify(fields.requesterId)},"resource":${JSON.stringify(fields.resource)},"timestamp":${fields.timestamp}}`,
  );
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function ed25519Verify(
  publicKey: Uint8Array,
  message: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new ProtocolError("no SubtleCrypto (Ed25519 verify)");
  }
  const key = await subtle.importKey("raw", toArrayBuffer(publicKey), "Ed25519", false, [
    "verify",
  ]);
  return subtle.verify("Ed25519", key, toArrayBuffer(signature), toArrayBuffer(message));
}

/* ------------------------------------------------------------------------- *
 * Canonical signed vault WriteRequest, v2 (ADR-015 §3, not yet active)
 *
 * Normative source: SIGNED-WRITE-CONTRACT-v2 §1, plus the private
 * V3-ERRATUM-2 device-binding delta. Draft Layout Rev2 inserts `deviceId`
 * immediately after `vaultId` and keeps every other field, the field order and
 * the domain label unchanged. There is no compatibility claim to Draft Rev1:
 * no request, key or route of that draft was ever delivered.
 *
 * `writeRequestBytesV2` is the byte layout only — it does not sign, does not
 * derive keys, and enforces no route policy. Binding the signed `deviceId` to
 * the validated session header (`X-Device-Id` / `session_device_id`) is a
 * server requirement, not something these bytes can prove.
 * ------------------------------------------------------------------------- */

/** Rev 2 adds `deviceId` after `vaultId`; the label itself stays `…-v2`. */
export const WRITE_V2_DRAFT_LAYOUT_REVISION = 2 as const;

export const WRITE_V2_ERROR_CODES = {
  type: "write_request_type_invalid",
  method: "write_request_method_invalid",
  route: "write_request_route_invalid",
  id: "write_request_id_invalid",
  uint32: "write_request_uint32_invalid",
  nonce: "write_request_nonce_invalid",
  digest: "write_request_digest_invalid",
  presence: "write_request_presence_invalid",
  base64: "write_request_base64_invalid",
  unknownField: "write_request_field_unknown",
  resourceType: "write_request_resource_type_invalid",
  uuid: "write_request_uuid_invalid",
} as const;

export type WriteRequestV2ErrorCode =
  (typeof WRITE_V2_ERROR_CODES)[keyof typeof WRITE_V2_ERROR_CODES];

/** Stable, machine-readable failure. The code is the API, the text is for humans. */
export class WriteRequestV2Error extends ProtocolError {
  readonly code: WriteRequestV2ErrorCode;

  constructor(code: WriteRequestV2ErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
  }
}

export type WriteResourceTypeV2 = "vault" | "device" | "credential" | "challenge";

export interface WriteRequestV2 {
  vaultId: string;
  /** Draft Rev2: must equal the validated session `X-Device-Id`; exact UTF-8, no normalization. */
  deviceId: string;
  method: string;
  route: string;
  resourceType: WriteResourceTypeV2;
  /** Exact decoded id; `""` for a vault-level write. */
  resourceId: string;
  /** Exact decoded parent id; `""` where none. */
  parentId: string;
  baseRevision: number;
  resultRevision: number;
  signingKeyVersion: number;
  resultKeyVersion: number;
  hasManifest: 0 | 1;
  /** 32 bytes when `hasManifest = 1`, empty otherwise. */
  manifestDigest: Uint8Array;
  /** SHA-256 over the raw body bytes exactly as received; always 32 bytes. */
  payloadDigest: Uint8Array;
  hasNextKey: 0 | 1;
  /** 32 bytes when `hasNextKey = 1`, empty otherwise. */
  nextPublicKeyDigest: Uint8Array;
  operationId: string;
  /** Exactly 16 bytes. */
  nonce: Uint8Array;
  /** uint32 Unix seconds (bounded to 2106-02-07 by the contract). */
  timestamp: number;
}

const WIRE_V2_KEYS = [
  "vaultId",
  "deviceId",
  "method",
  "route",
  "resourceType",
  "resourceId",
  "parentId",
  "baseRevision",
  "resultRevision",
  "signingKeyVersion",
  "resultKeyVersion",
  "hasManifest",
  "manifestDigest",
  "payloadDigest",
  "hasNextKey",
  "nextPublicKeyDigest",
  "operationId",
  "nonce",
  "timestamp",
] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BASE64URL_RE = /^[A-Za-z0-9_-]*$/;
const BASE64URL_TABLE = (() => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < alphabet.length; i++) table[alphabet.charCodeAt(i)] = i;
  return table;
})();

function wfail(code: WriteRequestV2ErrorCode, message: string): never {
  throw new WriteRequestV2Error(code, message);
}

/** Counts Unicode scalar values the way Python's `len(str)` does: one per code point. */
function codepointLength(value: string): number {
  let count = 0;
  for (const _ of value) count += 1;
  return count;
}

/**
 * `vaultId` and `operationId` are UUIDs in V2 §1/§1.1. The wire must carry the
 * canonical lowercase hyphenated text; the encoder does not normalize. FastAPI's
 * UUID path parser is lenient (it also accepts uppercase, braces and `urn:uuid:`),
 * so the server must serialize `str(uuid)` for signing. Rejecting a
 * non-canonical spelling here keeps two texts of one UUID from producing two
 * preimages; this is a wire-validation boundary, not a claim that the encoder
 * authorizes the route.
 */
function readUuidV2(name: string, value: unknown): string {
  if (typeof value !== "string") {
    wfail(WRITE_V2_ERROR_CODES.type, `${name} must be a string`);
  }
  if (!UUID_RE.test(value)) {
    wfail(WRITE_V2_ERROR_CODES.uuid, `${name} must be a canonical lowercase UUID`);
  }
  return value;
}

function readIdV2(name: string, value: unknown, minChars: number): string {
  if (typeof value !== "string") {
    wfail(WRITE_V2_ERROR_CODES.type, `${name} must be a string`);
  }
  for (const ch of value) {
    const cp = ch.codePointAt(0) as number;
    if (cp >= 0xd800 && cp <= 0xdfff) {
      wfail(WRITE_V2_ERROR_CODES.id, `${name} contains an unpaired surrogate`);
    }
  }
  const chars = codepointLength(value);
  if (chars < minChars || chars > WRITE_V2_ID_CHARS_MAX) {
    wfail(
      WRITE_V2_ERROR_CODES.id,
      `${name} must be ${minChars}..${WRITE_V2_ID_CHARS_MAX} characters, got ${chars}`,
    );
  }
  try {
    utf8(value);
  } catch {
    wfail(WRITE_V2_ERROR_CODES.id, `${name} has no UTF-8 encoding`);
  }
  return value;
}

/**
 * JSON numbers are compared by value. A number with zero fractional part
 * (`1.0`) is accepted; a fractional one is not. JavaScript cannot tell `1`
 * from `1.0`, and Python must behave identically, so this is the only
 * cross-language-consistent reading of "reject non-integers".
 */
function readUint32V2(name: string, value: unknown): number {
  if (typeof value !== "number") {
    wfail(WRITE_V2_ERROR_CODES.type, `${name} must be a number`);
  }
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    wfail(WRITE_V2_ERROR_CODES.uint32, `${name} must be an integer, got ${String(value)}`);
  }
  if (value < 0 || value > 0xffffffff) {
    wfail(WRITE_V2_ERROR_CODES.uint32, `${name} must be in [0, 4294967295], got ${value}`);
  }
  return value;
}

function readPresenceV2(name: string, value: unknown): 0 | 1 {
  const n = readUint32V2(name, value);
  if (n !== 0 && n !== 1) {
    wfail(WRITE_V2_ERROR_CODES.presence, `${name} must be 0 or 1, got ${n}`);
  }
  return n;
}

function copyDigestV2(name: string, value: unknown, code: WriteRequestV2ErrorCode, length: number): Uint8Array {
  if (!(value instanceof Uint8Array)) {
    wfail(WRITE_V2_ERROR_CODES.type, `${name} must be a Uint8Array`);
  }
  const copy = Uint8Array.from(value);
  if (copy.length !== length) {
    wfail(code, `${name} must be ${length} bytes, got ${copy.length}`);
  }
  return copy;
}

/**
 * Strict unpadded base64url. `+`, `/`, `=`, whitespace and non-zero trailing
 * padding bits are rejected: three encodings of one byte string must not yield
 * three canonical preimages for one request.
 */
export function decodeBase64UrlCanonicalV2(name: string, value: unknown): Uint8Array {
  if (typeof value !== "string") {
    wfail(WRITE_V2_ERROR_CODES.type, `${name} must be a base64url string`);
  }
  if (value.length % 4 === 1) {
    wfail(WRITE_V2_ERROR_CODES.base64, `${name} has an impossible base64url length`);
  }
  if (!BASE64URL_RE.test(value)) {
    wfail(WRITE_V2_ERROR_CODES.base64, `${name} is not unpadded base64url`);
  }
  const out = new Uint8Array(Math.floor((value.length * 6) / 8));
  let buffer = 0;
  let bits = 0;
  let offset = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    const index = code < 128 ? (BASE64URL_TABLE[code] as number) : -1;
    if (index < 0) {
      wfail(WRITE_V2_ERROR_CODES.base64, `${name} contains a non-base64url character`);
    }
    buffer = (buffer << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[offset] = (buffer >> bits) & 0xff;
      offset += 1;
      buffer &= (1 << bits) - 1;
    }
  }
  if (bits > 0 && buffer !== 0) {
    wfail(WRITE_V2_ERROR_CODES.base64, `${name} has non-zero trailing padding bits`);
  }
  return out;
}

/** SHA-256 over the exact raw body bytes; no trimming, no newline normalization. */
export function writePayloadDigestV2(body: Uint8Array): Uint8Array {
  if (!(body instanceof Uint8Array)) {
    wfail(WRITE_V2_ERROR_CODES.type, "body must be a Uint8Array");
  }
  return sha256(body);
}

/** `SHA-256(frame(["4allpass-write-public-key-v1", nextPublicKeyRaw32]))`, per V2 §1. */
export function writePublicKeyDigestV2(nextPublicKeyRaw: Uint8Array): Uint8Array {
  if (!(nextPublicKeyRaw instanceof Uint8Array) || nextPublicKeyRaw.length !== 32) {
    wfail(WRITE_V2_ERROR_CODES.type, "nextPublicKeyRaw must be 32 bytes");
  }
  return sha256(frame([WRITE_V2_PUBLIC_KEY_LABEL, Uint8Array.from(nextPublicKeyRaw)]));
}

function validateWriteRequestV2(input: WriteRequestV2): WriteRequestV2 {
  if (typeof input !== "object" || input === null) {
    wfail(WRITE_V2_ERROR_CODES.type, "write request must be an object");
  }
  const vaultId = readUuidV2("vaultId", input.vaultId);
  const deviceId = readIdV2("deviceId", input.deviceId, 1);
  if (typeof input.method !== "string" || !/^[A-Z]{1,16}$/.test(input.method)) {
    wfail(WRITE_V2_ERROR_CODES.method, "method must be an upper-case ASCII token");
  }
  if (
    typeof input.route !== "string" ||
    input.route.length < 1 ||
    input.route.length > 512 ||
    !input.route.startsWith("/api/v1/") ||
    !/^[\x21-\x7e]+$/.test(input.route) ||
    input.route.includes("?") ||
    input.route.includes("#")
  ) {
    wfail(WRITE_V2_ERROR_CODES.route, "route must be a fixed /api/v1/ path template without query or fragment");
  }
  if (
    input.resourceType !== "vault" &&
    input.resourceType !== "device" &&
    input.resourceType !== "credential" &&
    input.resourceType !== "challenge"
  ) {
    wfail(WRITE_V2_ERROR_CODES.resourceType, `unknown resourceType: ${String(input.resourceType)}`);
  }
  const resourceId = readIdV2("resourceId", input.resourceId, 0);
  const parentId = readIdV2("parentId", input.parentId, 0);
  const baseRevision = readUint32V2("baseRevision", input.baseRevision);
  const resultRevision = readUint32V2("resultRevision", input.resultRevision);
  const signingKeyVersion = readUint32V2("signingKeyVersion", input.signingKeyVersion);
  const resultKeyVersion = readUint32V2("resultKeyVersion", input.resultKeyVersion);
  const hasManifest = readPresenceV2("hasManifest", input.hasManifest);
  const manifestDigest = copyDigestV2(
    "manifestDigest",
    input.manifestDigest,
    WRITE_V2_ERROR_CODES.digest,
    hasManifest === 1 ? WRITE_V2_DIGEST_BYTES : 0,
  );
  const payloadDigest = copyDigestV2(
    "payloadDigest",
    input.payloadDigest,
    WRITE_V2_ERROR_CODES.digest,
    WRITE_V2_DIGEST_BYTES,
  );
  const hasNextKey = readPresenceV2("hasNextKey", input.hasNextKey);
  const nextPublicKeyDigest = copyDigestV2(
    "nextPublicKeyDigest",
    input.nextPublicKeyDigest,
    WRITE_V2_ERROR_CODES.digest,
    hasNextKey === 1 ? WRITE_V2_DIGEST_BYTES : 0,
  );
  const operationId = readUuidV2("operationId", input.operationId);
  const nonce = copyDigestV2("nonce", input.nonce, WRITE_V2_ERROR_CODES.nonce, WRITE_V2_NONCE_BYTES);
  const timestamp = readUint32V2("timestamp", input.timestamp);

  return {
    vaultId,
    deviceId,
    method: input.method,
    route: input.route,
    resourceType: input.resourceType,
    resourceId,
    parentId,
    baseRevision,
    resultRevision,
    signingKeyVersion,
    resultKeyVersion,
    hasManifest,
    manifestDigest,
    payloadDigest,
    hasNextKey,
    nextPublicKeyDigest,
    operationId,
    nonce,
    timestamp,
  };
}

/**
 * Canonical preimage for one signed v2 write.
 *
 * `frame([...])` is the existing uint32be framing; the presence flags are
 * framed uint32 `0|1`, and the optional digests are framed empty arrays when
 * absent. There is no separate marker convention.
 */
export function writeRequestBytesV2(input: WriteRequestV2): Uint8Array {
  const v = validateWriteRequestV2(input);
  return frame([
    WRITE_V2_LABEL,
    v.vaultId,
    v.deviceId,
    v.method,
    v.route,
    v.resourceType,
    v.resourceId,
    v.parentId,
    v.baseRevision,
    v.resultRevision,
    v.signingKeyVersion,
    v.resultKeyVersion,
    v.hasManifest,
    v.manifestDigest,
    v.payloadDigest,
    v.hasNextKey,
    v.nextPublicKeyDigest,
    v.operationId,
    v.nonce,
    v.timestamp,
  ]);
}

export function writeRequestV2Hex(input: WriteRequestV2): string {
  return bytesToHex(writeRequestBytesV2(input));
}

/**
 * Parse the untrusted JSON wire shape into a fully validated request.
 *
 * Every field is required and validated here before anything is returned:
 * unknown and missing fields are errors. A field this build does not
 * authenticate must never be silently dropped, or an older writer and a newer
 * reader would sign different bytes while both believing they agree.
 */
export function parseWriteRequestV2Wire(value: unknown): WriteRequestV2 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    wfail(WRITE_V2_ERROR_CODES.type, "write request wire value must be an object");
  }
  const wire = value as Record<string, unknown>;
  for (const key of Object.keys(wire)) {
    if (!(WIRE_V2_KEYS as readonly string[]).includes(key)) {
      wfail(WRITE_V2_ERROR_CODES.unknownField, `unknown write request field: ${key}`);
    }
  }
  for (const key of WIRE_V2_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(wire, key)) {
      wfail(WRITE_V2_ERROR_CODES.type, `missing write request field: ${key}`);
    }
  }
  const nonce = decodeBase64UrlCanonicalV2("nonce", wire.nonce);
  const manifestDigest = decodeBase64UrlCanonicalV2("manifestDigest", wire.manifestDigest);
  const payloadDigest = decodeBase64UrlCanonicalV2("payloadDigest", wire.payloadDigest);
  const nextPublicKeyDigest = decodeBase64UrlCanonicalV2("nextPublicKeyDigest", wire.nextPublicKeyDigest);
  return validateWriteRequestV2({
    vaultId: wire.vaultId as string,
    deviceId: wire.deviceId as string,
    method: wire.method as string,
    route: wire.route as string,
    resourceType: wire.resourceType as WriteResourceTypeV2,
    resourceId: wire.resourceId as string,
    parentId: wire.parentId as string,
    baseRevision: wire.baseRevision as number,
    resultRevision: wire.resultRevision as number,
    signingKeyVersion: wire.signingKeyVersion as number,
    resultKeyVersion: wire.resultKeyVersion as number,
    hasManifest: wire.hasManifest as 0 | 1,
    manifestDigest,
    payloadDigest,
    hasNextKey: wire.hasNextKey as 0 | 1,
    nextPublicKeyDigest,
    operationId: wire.operationId as string,
    nonce,
    timestamp: wire.timestamp as number,
  });
}
