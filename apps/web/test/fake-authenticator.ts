/**
 * Software stand-in for a PRF-capable authenticator (tests only).
 *
 * The crypto library never talks to an authenticator (webauthn-prf.md §8);
 * this fake exercises the browser-side flow deterministically:
 * PRF output = HMAC-SHA-256(per-credential secret, eval.first).
 */

import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import type { AuthenticatorBridge } from "../src/unlock/webauthn-prf";

interface FakeCredential {
  id: Uint8Array;
  prfSecret: Uint8Array;
  rpId: string;
}

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

function toBytes(value: BufferSource): Uint8Array {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
}

function credentialResponse(
  cred: FakeCredential,
  prfFirst: Uint8Array | undefined,
  prfEnabled: boolean,
): PublicKeyCredential {
  const extensionResults: Record<string, unknown> = {};
  if (prfEnabled) {
    extensionResults.prf = prfFirst
      ? { results: { first: prfFirst.buffer } }
      : { enabled: true };
  }
  const idBuffer = new Uint8Array(cred.id).buffer;
  return {
    id: btoa(String.fromCharCode(...cred.id)),
    rawId: idBuffer,
    type: "public-key",
    authenticatorAttachment: "platform",
    getClientExtensionResults: () => extensionResults,
    response: {} as AuthenticatorResponse,
  } as unknown as PublicKeyCredential;
}

export class FakePrfAuthenticator implements AuthenticatorBridge {
  private credentials: FakeCredential[] = [];

  /** Set to false to simulate an authenticator without PRF support. */
  prfSupported = true;
  /** Set to true to simulate a UV failure / user cancel. */
  failUserVerification = false;

  async create(options: CredentialCreationOptions): Promise<PublicKeyCredential | null> {
    const pk = options.publicKey;
    if (!pk) throw new Error("publicKey options required");
    if (pk.authenticatorSelection?.userVerification !== "required") {
      throw new Error("test invariant: userVerification must be 'required'");
    }
    if (this.failUserVerification) throw new DOMException("UV failed", "NotAllowedError");
    const cred: FakeCredential = {
      id: randomBytes(16),
      prfSecret: randomBytes(32),
      rpId: pk.rp.id ?? "localhost",
    };
    this.credentials.push(cred);
    // Like many platforms: PRF is only *enabled* at create time; results
    // require an assertion.
    return credentialResponse(cred, undefined, this.prfSupported);
  }

  async get(options: CredentialRequestOptions): Promise<PublicKeyCredential | null> {
    const pk = options.publicKey;
    if (!pk) throw new Error("publicKey options required");
    if (pk.userVerification !== "required") {
      throw new Error("test invariant: userVerification must be 'required'");
    }
    if (this.failUserVerification) throw new DOMException("UV failed", "NotAllowedError");

    const allowed = (pk.allowCredentials ?? []).map((d) => toBytes(d.id));
    const cred = this.credentials.find(
      (c) =>
        c.rpId === (pk.rpId ?? "localhost") &&
        (allowed.length === 0 || allowed.some((a) => indexedDbEqual(a, c.id))),
    );
    if (!cred) throw new DOMException("no matching credential", "NotAllowedError");

    let prfFirst: Uint8Array | undefined;
    const evalFirst = (pk.extensions as { prf?: { eval?: { first?: BufferSource } } } | undefined)
      ?.prf?.eval?.first;
    if (this.prfSupported && evalFirst) {
      prfFirst = hmac(sha256, cred.prfSecret, toBytes(evalFirst));
    }
    return credentialResponse(cred, prfFirst, this.prfSupported && !!evalFirst);
  }
}

function indexedDbEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
