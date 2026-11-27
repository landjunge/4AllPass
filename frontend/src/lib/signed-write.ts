/**
 * v2 signed-write orchestration: derive the seed, sign the canonical request,
 * send it, and bind the answer. Fail-closed — no unsigned or v1 fallback.
 *
 * Receipt replay is bound to operation/vault/route/resource/outcome by the
 * shared classifier; a retry that cannot be proven stays UNKNOWN and must
 * reuse the exact signed request (carried by SignedWriteUnknownError).
 */
import {
  deriveWriteSeed,
  newWriteOperation,
  payloadDigestV2,
  SIGNED_WRITE_HEADERS,
  signWriteV2WithSigner,
  writePublicKeyDigestV2,
  zeroize,
  type SignedWriteExpectation,
  type SignedWriteOutcome,
  type SignedWriteBundle,
  type WriteResourceTypeV2,
  type WriteSigner,
} from "@4allpass/crypto";
import {
  captureSignedWriteTarget,
  resumeSignedWriteRequest,
  signedWriteRequest,
  type ExactSignedWriteRequest,
  type SignedWriteTarget,
} from "./api.ts";
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
  /** Original operation identity; exact resend data is held in retryContext. */
  readonly operation: { operationId: string; nonce: Uint8Array };
  /** Exact signed wire request retained only in this in-memory error object. */
  readonly retryContext?: SignedWriteRetryContext;
  constructor(
    reason: string,
    operation: { operationId: string; nonce: Uint8Array },
    retryContext?: SignedWriteRetryContext,
  ) {
    super(`signed write outcome unknown: ${reason}`);
    this.name = "SignedWriteUnknownError";
    this.reason = reason;
    this.operation = Object.freeze({
      operationId: operation.operationId,
      nonce: operation.nonce.slice(),
    });
    if (retryContext) this.retryContext = retryContext;
  }
}

export interface SignedWriteRetryContext extends ExactSignedWriteRequest {
  readonly route: string;
  readonly operationId: string;
  readonly nonce: string;
  readonly timestamp: number;
  readonly assertLive?: () => void;
}

type SignedWriteAttemptOutcome = SignedWriteOutcome & {
  retryContext?: SignedWriteRetryContext;
};

const validRetryContexts = new WeakSet<object>();

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
): Promise<SignedWriteAttemptOutcome> {
  const operation = call.operation ?? newWriteOperation();
  const timestamp = Math.floor(Date.now() / 1000);
  const target = captureSignedWriteTarget();
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
      timestamp,
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
  const headers = Object.freeze({ ...bundle.headers });
  const retryContext: SignedWriteRetryContext = Object.freeze({
    method: call.method,
    path: call.path,
    bodyString: call.bodyString,
    headers,
    deviceId: call.deviceId,
    expected: Object.freeze({ ...expected }),
    target,
    route: call.route,
    operationId: operation.operationId,
    nonce: headers[SIGNED_WRITE_HEADERS.nonce] ?? "",
    timestamp,
    ...(call.assertLive ? { assertLive: call.assertLive } : {}),
  });
  if (!isValidWireRequestContext(retryContext)) {
    return { kind: "unknown", reason: "signed_request_context_invalid" };
  }
  const resumable = typeof retryContext.assertLive === "function";
  if (resumable) validRetryContexts.add(retryContext);
  let outcome: SignedWriteOutcome;
  try {
    outcome = await signedWriteRequest(
      retryContext.method,
      retryContext.path,
      { ...bundle, headers: { ...retryContext.headers } },
      retryContext.bodyString,
      retryContext.expected,
      retryContext.deviceId,
      retryContext.target,
    );
  } catch {
    return withRetryContext(
      { kind: "unknown", reason: "request_transport_unknown" },
      retryContext,
      resumable,
    );
  }
  try {
    call.assertLive?.();
  } catch {
    return withRetryContext(
      { kind: "unknown", reason: "vault_session_changed" },
      retryContext,
      resumable,
    );
  }
  return outcome.kind === "unknown" || outcome.kind === "replayed"
    ? withRetryContext(outcome, retryContext, resumable)
    : outcome;
}

function isValidWireRequestContext(value: SignedWriteRetryContext): boolean {
  return (
    typeof value.method === "string" &&
    typeof value.path === "string" &&
    typeof value.bodyString === "string" &&
    typeof value.deviceId === "string" &&
    isSignedWriteTarget(value.target) &&
    typeof value.route === "string" &&
    typeof value.operationId === "string" &&
    typeof value.nonce === "string" &&
    Number.isSafeInteger(value.timestamp) &&
    value.expected.operationId === value.operationId &&
    value.expected.route === value.route &&
    value.headers[SIGNED_WRITE_HEADERS.operationId] === value.operationId &&
    value.headers[SIGNED_WRITE_HEADERS.nonce] === value.nonce &&
    value.headers[SIGNED_WRITE_HEADERS.timestamp] === String(value.timestamp)
  );
}

function isSignedWriteTarget(value: SignedWriteTarget): boolean {
  return (
    (value.transport === "sidecar" || value.transport === "fetch") &&
    typeof value.origin === "string" &&
    value.origin.length > 0
  );
}

function isValidRetryContext(value: SignedWriteRetryContext): boolean {
  return isValidWireRequestContext(value) && typeof value.assertLive === "function";
}

function withRetryContext<T extends SignedWriteOutcome>(
  outcome: T,
  context: SignedWriteRetryContext,
  resumable: boolean,
): SignedWriteAttemptOutcome {
  return resumable ? { ...outcome, retryContext: context } : outcome;
}

/** Explicitly resume one UNKNOWN using its immutable wire request; never sign again. */
export async function resumeSignedWrite(
  error: SignedWriteUnknownError,
): Promise<SignedWriteAttemptOutcome> {
  const context = error.retryContext;
  if (
    !context ||
    !validRetryContexts.has(context) ||
    !isValidRetryContext(context) ||
    context.operationId !== error.operation.operationId ||
    context.nonce !== encodeBase64Url(error.operation.nonce)
  ) {
    return { kind: "unknown", reason: "retry_context_missing_or_invalid" };
  }
  try {
    context.assertLive!();
  } catch {
    return { kind: "unknown", reason: "vault_session_changed", retryContext: context };
  }
  let outcome: SignedWriteOutcome;
  try {
    outcome = await resumeSignedWriteRequest(context);
  } catch {
    return { kind: "unknown", reason: "request_transport_unknown", retryContext: context };
  }
  try {
    context.assertLive!();
  } catch {
    return { kind: "unknown", reason: "vault_session_changed", retryContext: context };
  }
  return outcome.kind === "unknown" || outcome.kind === "replayed"
    ? { ...outcome, retryContext: context }
    : outcome;
}

/**
 * Map an outcome to a committed body or a typed failure. `readBody` fetches the
 * current state when the server replayed a receipt (bodyAvailable=false): the
 * client uses the authorized read route, never a replayed body.
 */
export async function resolveSignedWrite<T>(
  outcome: SignedWriteAttemptOutcome,
  operation: { operationId: string; nonce: Uint8Array },
  readBody: () => Promise<T>,
): Promise<T> {
  switch (outcome.kind) {
    case "ok":
      return outcome.body as T;
    case "replayed": {
      try {
        outcome.retryContext?.assertLive?.();
      } catch {
        throw new SignedWriteUnknownError(
          "vault_session_changed",
          operation,
          outcome.retryContext,
        );
      }
      let body: T;
      try {
        body = await readBody();
      } catch {
        throw new SignedWriteUnknownError(
          "replayed_write_body_unavailable",
          operation,
          outcome.retryContext,
        );
      }
      try {
        outcome.retryContext?.assertLive?.();
      } catch {
        throw new SignedWriteUnknownError(
          "vault_session_changed",
          operation,
          outcome.retryContext,
        );
      }
      return body;
    }
    case "rejected":
      throw new SignedWriteRejectedError(outcome.status, outcome.code);
    case "unknown":
      throw new SignedWriteUnknownError(
        outcome.reason,
        operation,
        outcome.retryContext &&
            outcome.retryContext.operationId === operation.operationId &&
            outcome.retryContext.nonce === encodeBase64Url(operation.nonce)
          ? outcome.retryContext
          : undefined,
      );
  }
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
