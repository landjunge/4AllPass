/**
 * v2 signed-write orchestration: derive the seed, sign the canonical request,
 * send it, and bind the answer. Fail-closed — no unsigned or v1 fallback.
 *
 * Receipt replay is bound to operation/vault/route/resource/outcome by the
 * shared classifier; a retry that cannot be proven stays UNKNOWN and must
 * reuse the same operation id/nonce (carried by SignedWriteUnknownError).
 */
import {
  deriveWriteSeed,
  newWriteOperation,
  payloadDigestV2,
  signWriteV2WithSigner,
  writePublicKeyDigestV2,
  zeroize,
  type SignedWriteExpectation,
  type SignedWriteOutcome,
  type SignedWriteBundle,
  type WriteResourceTypeV2,
  type WriteSigner,
} from "@4allpass/crypto";
import { signedWriteRequest } from "./api.ts";
import { createWriteSigner } from "./write-signer.ts";

export class SignedWriteRejectedError extends Error {
  readonly code = "signed_write_rejected";
  readonly status: number;
  readonly reason: string;
  constructor(status: number, reason: string) {
    super(`signed write rejected (${status}): ${reason}`);
    this.name = "SignedWriteRejectedError";
    this.status = status;
    this.reason = reason;
  }
}

export class SignedWriteUnknownError extends Error {
  readonly code = "signed_write_unknown";
  readonly reason: string;
  /** Reuse verbatim on retry; never mint a new operation for the same write. */
  readonly operation: { operationId: string; nonce: Uint8Array };
  constructor(reason: string, operation: { operationId: string; nonce: Uint8Array }) {
    super(`signed write outcome unknown: ${reason}`);
    this.name = "SignedWriteUnknownError";
    this.reason = reason;
    this.operation = operation;
  }
}

export interface WriteSignerPair {
  signer: WriteSigner;
  /** Present only for a rotation: the next key proves possession. */
  nextSigner?: WriteSigner;
}

/** Derive the current (and optional next) write signer from the Vault Key. */
export async function deriveWriteSigners(
  vaultKey: Uint8Array,
  vaultId: string,
  vaultKeyVersion: number,
  nextVaultKey?: Uint8Array,
  nextVaultKeyVersion?: number,
): Promise<WriteSignerPair> {
  const seed = deriveWriteSeed(vaultKey, vaultId, vaultKeyVersion);
  let signer: WriteSigner;
  try {
    signer = await createWriteSigner(seed);
  } finally {
    zeroize(seed);
  }
  if (!nextVaultKey || nextVaultKeyVersion === undefined) return { signer };
  const nextSeed = deriveWriteSeed(nextVaultKey, vaultId, nextVaultKeyVersion);
  try {
    return { signer, nextSigner: await createWriteSigner(nextSeed) };
  } catch (error) {
    signer.dispose?.();
    throw error;
  } finally {
    zeroize(nextSeed);
  }
}

export interface SignedWriteCall {
  method: string;
  /** Route template signed into the preimage, e.g. /api/v1/vaults/{vaultId}/snapshots. */
  route: string;
  /** Concrete transport path without the /api/v1 prefix. */
  path: string;
  resourceType: WriteResourceTypeV2;
  resourceId: string;
  parentId: string;
  baseRevision: number;
  resultRevision: number;
  keyVersion: number;
  resultKeyVersion: number;
  hasManifest: boolean;
  manifestDigest: Uint8Array;
  /** Exact serialized body bytes; the payload digest binds these. */
  bodyString: string;
  vaultId: string;
  deviceId: string;
  creationGrant?: string;
  /** Reuse on a proven retry; omitted mints a fresh operation. */
  operation?: { operationId: string; nonce: Uint8Array };
  /** Revalidate the originating unlocked session across async signing. */
  assertLive?: () => void;
}

/** Sign and send one write; returns the classified outcome (never invents ok). */
export async function performSignedWrite(
  call: SignedWriteCall,
  pair: WriteSignerPair,
): Promise<SignedWriteOutcome> {
  const operation = call.operation ?? newWriteOperation();
  call.assertLive?.();
  const bodyBytes = new TextEncoder().encode(call.bodyString);
  const nextPublicKeyDigest = pair.nextSigner
    ? writePublicKeyDigestV2(pair.nextSigner.publicKey)
    : new Uint8Array(0);
  let bundle: SignedWriteBundle;
  try {
    bundle = await signWriteV2WithSigner(
    {
      vaultId: call.vaultId,
      deviceId: call.deviceId,
      method: call.method,
      route: call.route,
      resourceType: call.resourceType,
      resourceId: call.resourceId,
      parentId: call.parentId,
      baseRevision: call.baseRevision,
      resultRevision: call.resultRevision,
      keyVersion: call.keyVersion,
      resultKeyVersion: call.resultKeyVersion,
      hasManifest: call.hasManifest,
      manifestDigest: call.hasManifest ? call.manifestDigest : new Uint8Array(0),
      payloadDigest: payloadDigestV2(bodyBytes),
      hasNextKey: Boolean(pair.nextSigner),
      nextPublicKeyDigest,
      operationId: operation.operationId,
      nonce: operation.nonce,
      timestamp: Math.floor(Date.now() / 1000),
    },
      pair.signer,
      pair.nextSigner,
    );
  } finally {
    pair.signer.dispose?.();
    pair.nextSigner?.dispose?.();
  }
  call.assertLive?.();
  if (call.creationGrant) {
    bundle.headers["X-4AP-Creation-Grant"] = call.creationGrant;
  }
  const expected: SignedWriteExpectation = {
    operationId: operation.operationId,
    vaultId: call.vaultId,
    route: call.route,
    resourceType: call.resourceType,
    resourceId: call.resourceId,
    parentId: call.parentId,
  };
  return signedWriteRequest(call.method, call.path, bundle, call.bodyString, expected);
}

/**
 * Map an outcome to a committed body or a typed failure. `readBody` fetches the
 * current state when the server replayed a receipt (bodyAvailable=false): the
 * client uses the authorized read route, never a replayed body.
 */
export async function resolveSignedWrite<T>(
  outcome: SignedWriteOutcome,
  operation: { operationId: string; nonce: Uint8Array },
  readBody: () => Promise<T>,
): Promise<T> {
  switch (outcome.kind) {
    case "ok":
      return outcome.body as T;
    case "replayed":
      return readBody();
    case "rejected":
      throw new SignedWriteRejectedError(outcome.status, outcome.code);
    case "unknown":
      throw new SignedWriteUnknownError(outcome.reason, operation);
  }
}
