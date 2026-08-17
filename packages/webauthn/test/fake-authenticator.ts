/**
 * A deterministic stand-in for a platform authenticator.
 *
 * It reproduces exactly the parts the unlock flows depend on: the PRF
 * extension (HMAC over the eval input with a per-credential secret), largeBlob
 * storage, the UV flag in authenticatorData, and the rpIdHash. It is not a
 * CTAP implementation and deliberately does not sign anything.
 */
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { concat, randomBytes, utf8 } from "@4allpass/crypto";
import type {
  AssertionLike,
  AttestationLike,
  CreateCredentialRequest,
  ExtensionResultsLike,
  GetAssertionRequest,
  LargeBlobExtensionOutput,
  WebAuthnClient,
} from "../src/index.ts";

export interface FakeAuthenticatorOptions {
  supportsPrf?: boolean;
  supportsLargeBlob?: boolean;
  /** Return PRF results already from `create`, like some platforms do. */
  prfAtCreateTime?: boolean;
  /** Report success but leave the UV flag clear. */
  skipUserVerification?: boolean;
  /** Reject every ceremony, like a user who dismisses the prompt. */
  denyAll?: boolean;
  /** Truncate `prf.results.first`, which must be refused by the caller. */
  shortPrfOutput?: boolean;
  supportsWebAuthn?: boolean;
}

interface Credential {
  id: Uint8Array;
  rpId: string;
  prfSecret: Uint8Array;
  largeBlob: Uint8Array | null;
}

export class FakeAuthenticator implements WebAuthnClient {
  readonly credentials: Credential[] = [];
  createCalls = 0;
  getCalls = 0;
  lastPrfEvalFirst: Uint8Array | null = null;
  lastUserVerification: string | null = null;

  constructor(private readonly options: FakeAuthenticatorOptions = {}) {}

  isSupported(): boolean {
    return this.options.supportsWebAuthn !== false;
  }

  async hasPlatformAuthenticator(): Promise<boolean> {
    return this.isSupported();
  }

  /** Registers a credential without a ceremony, for unlock-only test setups. */
  addCredential(rpId: string): Uint8Array {
    const credential: Credential = {
      id: randomBytes(16),
      rpId,
      prfSecret: randomBytes(32),
      largeBlob: null,
    };
    this.credentials.push(credential);
    return credential.id;
  }

  async create(request: CreateCredentialRequest): Promise<AttestationLike> {
    this.createCalls += 1;
    this.lastUserVerification = request.userVerification;
    this.deny();
    const id = this.addCredential(request.rpId);
    const credential = this.find(id, request.rpId);
    const extensionResults: ExtensionResultsLike = {};
    if (this.options.supportsPrf !== false) {
      extensionResults.prf = { enabled: true };
      if (this.options.prfAtCreateTime) {
        extensionResults.prf.results = { first: this.prf(credential, request.prfEvalFirst) };
      }
    }
    if (request.requestLargeBlob) {
      extensionResults.largeBlob = { supported: this.options.supportsLargeBlob === true };
    }
    return { rawId: toArrayBuffer(id), extensionResults };
  }

  async get(request: GetAssertionRequest): Promise<AssertionLike> {
    this.getCalls += 1;
    this.lastUserVerification = request.userVerification;
    this.deny();
    const credential = this.find(request.credentialId, request.rpId);
    const extensionResults: ExtensionResultsLike = {};

    if (request.prfEvalFirst) {
      this.lastPrfEvalFirst = request.prfEvalFirst;
      if (this.options.supportsPrf === false) {
        // A browser without PRF support simply returns no prf results.
      } else {
        const output = this.prf(credential, request.prfEvalFirst);
        extensionResults.prf = {
          results: { first: this.options.shortPrfOutput ? output.subarray(0, 16) : output },
        };
      }
    }

    if (request.largeBlob) {
      if (this.options.supportsLargeBlob !== true) {
        extensionResults.largeBlob = { supported: false };
      } else if ("write" in request.largeBlob) {
        credential.largeBlob = request.largeBlob.write.slice();
        extensionResults.largeBlob = { written: true };
      } else {
        const read: LargeBlobExtensionOutput = {};
        if (credential.largeBlob) read.blob = credential.largeBlob;
        else read.supported = true;
        extensionResults.largeBlob = read;
      }
    }

    return {
      rawId: toArrayBuffer(credential.id),
      authenticatorData: toArrayBuffer(this.authenticatorData(credential.rpId)),
      extensionResults,
    };
  }

  private deny(): void {
    if (this.options.denyAll) {
      const error = new Error("The operation either timed out or was not allowed.");
      error.name = "NotAllowedError";
      throw error;
    }
  }

  private find(credentialId: Uint8Array, rpId: string): Credential {
    const found = this.credentials.find(
      (candidate) =>
        candidate.rpId === rpId &&
        candidate.id.length === credentialId.length &&
        candidate.id.every((byte, index) => byte === credentialId[index]),
    );
    if (!found) {
      const error = new Error("no credential for this rpId");
      error.name = "NotAllowedError";
      throw error;
    }
    return found;
  }

  /** Mirrors the CTAP hmac-secret idea: PRF output is keyed by the credential. */
  private prf(credential: Credential, evalFirst: Uint8Array): Uint8Array {
    return hmac(sha256, credential.prfSecret, concat(utf8("WebAuthn PRF\u0000"), evalFirst));
  }

  private authenticatorData(rpId: string): Uint8Array {
    const flags = new Uint8Array([this.options.skipUserVerification ? 0x01 : 0x05]);
    const signCount = new Uint8Array([0, 0, 0, 1]);
    return concat(sha256(utf8(rpId)), flags, signCount);
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}
