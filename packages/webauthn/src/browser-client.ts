/**
 * Thin adapter over `navigator.credentials`. The only file that touches DOM
 * WebAuthn APIs, so every flow above it stays testable without a browser.
 *
 * `userVerification` is hard-coded to "required" (webauthn-prf.md §7).
 */
import { WebAuthnUnavailableError } from "./errors.ts";
import type {
  AssertionLike,
  AttestationLike,
  CreateCredentialRequest,
  ExtensionResultsLike,
  GetAssertionRequest,
  WebAuthnClient,
} from "./types.ts";

interface PrfEvalInput {
  eval: { first: BufferSource };
}

interface ExtensionInputs {
  prf?: PrfEvalInput;
  largeBlob?: { support?: "required" | "preferred"; read?: boolean; write?: BufferSource };
}

function toBufferSource(bytes: Uint8Array): BufferSource {
  return bytes.slice() as unknown as BufferSource;
}

function extensionResults(credential: PublicKeyCredential): ExtensionResultsLike {
  return credential.getClientExtensionResults() as unknown as ExtensionResultsLike;
}

function wrapDomError(error: unknown): never {
  if (error instanceof Error && (error.name === "NotAllowedError" || error.name === "AbortError")) {
    throw new WebAuthnUnavailableError("the user cancelled or the authenticator timed out", {
      cause: error,
    });
  }
  if (error instanceof Error && error.name === "NotSupportedError") {
    throw new WebAuthnUnavailableError("the authenticator does not support this request", {
      cause: error,
    });
  }
  throw new WebAuthnUnavailableError(`WebAuthn call failed: ${String(error)}`, { cause: error });
}

export function browserWebAuthnClient(): WebAuthnClient {
  return {
    isSupported(): boolean {
      return (
        typeof globalThis.PublicKeyCredential === "function" &&
        typeof globalThis.navigator?.credentials?.create === "function"
      );
    },

    async hasPlatformAuthenticator(): Promise<boolean> {
      const api = globalThis.PublicKeyCredential;
      if (typeof api?.isUserVerifyingPlatformAuthenticatorAvailable !== "function") return false;
      try {
        return await api.isUserVerifyingPlatformAuthenticatorAvailable();
      } catch {
        return false;
      }
    },

    async create(request: CreateCredentialRequest): Promise<AttestationLike> {
      const extensions: ExtensionInputs = {
        prf: { eval: { first: toBufferSource(request.prfEvalFirst) } },
      };
      if (request.requestLargeBlob) {
        extensions.largeBlob = { support: "preferred" };
      }
      let credential: Credential | null;
      try {
        credential = await navigator.credentials.create({
          publicKey: {
            rp: { id: request.rpId, name: request.rpName },
            user: {
              id: toBufferSource(request.user.id),
              name: request.user.name,
              displayName: request.user.displayName,
            },
            challenge: toBufferSource(request.challenge),
            pubKeyCredParams: [
              { type: "public-key", alg: -7 },
              { type: "public-key", alg: -257 },
            ],
            authenticatorSelection: {
              userVerification: request.userVerification,
              residentKey: "required",
              requireResidentKey: true,
            },
            timeout: 120_000,
            attestation: "none",
            extensions: extensions as AuthenticationExtensionsClientInputs,
          },
        });
      } catch (error) {
        wrapDomError(error);
      }
      if (!credential) {
        throw new WebAuthnUnavailableError("credential creation returned nothing");
      }
      const publicKeyCredential = credential as PublicKeyCredential;
      return {
        rawId: publicKeyCredential.rawId,
        extensionResults: extensionResults(publicKeyCredential),
      };
    },

    async get(request: GetAssertionRequest): Promise<AssertionLike> {
      const extensions: ExtensionInputs = {};
      if (request.prfEvalFirst) {
        extensions.prf = { eval: { first: toBufferSource(request.prfEvalFirst) } };
      }
      if (request.largeBlob) {
        extensions.largeBlob =
          "read" in request.largeBlob
            ? { read: true }
            : { write: toBufferSource(request.largeBlob.write) };
      }
      let credential: Credential | null;
      try {
        credential = await navigator.credentials.get({
          publicKey: {
            rpId: request.rpId,
            challenge: toBufferSource(request.challenge),
            allowCredentials: [
              { type: "public-key", id: toBufferSource(request.credentialId) },
            ],
            userVerification: request.userVerification,
            timeout: 120_000,
            extensions: extensions as AuthenticationExtensionsClientInputs,
          },
        });
      } catch (error) {
        wrapDomError(error);
      }
      if (!credential) {
        throw new WebAuthnUnavailableError("assertion returned nothing");
      }
      const publicKeyCredential = credential as PublicKeyCredential;
      const response = publicKeyCredential.response as AuthenticatorAssertionResponse;
      return {
        rawId: publicKeyCredential.rawId,
        authenticatorData: response.authenticatorData,
        extensionResults: extensionResults(publicKeyCredential),
      };
    },
  };
}
