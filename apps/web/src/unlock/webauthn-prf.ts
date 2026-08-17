/**
 * WebAuthn PRF unlock flow per docs/webauthn-prf.md.
 *
 * WebAuthn is NOT an encryption oracle for the Vault Key:
 *
 *   assertion + PRF → 32-byte PRF output → HKDF-SHA-256 → DWK
 *     → unwrap Device-Key Envelope → DK → unwrap Device Envelope → VK
 *
 * PRF output and DWK are never used as keys directly and are zeroized
 * immediately after use. userVerification is always "required".
 */

import {
  deriveDeviceWrappingKey,
  generateDeviceKey,
  prfEvalFirst,
  unwrapDeviceKey,
  unwrapVaultKey,
  wrapDeviceKey,
  wrapVaultKey,
  zeroize,
  type DeviceKeyEnvelope,
  type KeyEnvelope,
} from "@4allpass/crypto";

export interface UnlockContext {
  /** WebAuthn RP ID; must stay stable for the life of the vault's device credentials. */
  rpId: string;
  vaultId: string;
  deviceId: string;
}

export interface PrfRegistrationResult {
  credentialId: Uint8Array;
  /** DK wrapped under DWK — stored locally, may be mirrored to the server as an opaque blob. */
  deviceKeyEnvelope: DeviceKeyEnvelope;
  /** VK wrapped under DK — uploaded as part of the next snapshot. */
  deviceEnvelope: KeyEnvelope;
}

/** PRF missing or malformed: not an error state, the caller falls back (§5). */
export class PrfUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrfUnavailableError";
  }
}

/** Minimal PRF-extension surface; lib.dom does not model it everywhere yet. */
interface PrfExtensionResults {
  prf?: { enabled?: boolean; results?: { first?: ArrayBuffer | Uint8Array } };
}

export interface AuthenticatorBridge {
  create(options: CredentialCreationOptions): Promise<PublicKeyCredential | null>;
  get(options: CredentialRequestOptions): Promise<PublicKeyCredential | null>;
}

function browserBridge(): AuthenticatorBridge {
  return {
    create: (o) => navigator.credentials.create(o) as Promise<PublicKeyCredential | null>,
    get: (o) => navigator.credentials.get(o) as Promise<PublicKeyCredential | null>,
  };
}

function toBytes(value: ArrayBuffer | Uint8Array): Uint8Array {
  return value instanceof Uint8Array ? new Uint8Array(value) : new Uint8Array(value.slice(0));
}

function prfResultFirst(credential: PublicKeyCredential): Uint8Array {
  const ext = credential.getClientExtensionResults() as PrfExtensionResults;
  const first = ext.prf?.results?.first;
  if (!first) {
    throw new PrfUnavailableError("authenticator returned no prf.results.first");
  }
  const bytes = toBytes(first);
  if (bytes.length !== 32) {
    zeroize(bytes);
    throw new PrfUnavailableError(
      `prf.results.first must be 32 bytes, got ${bytes.length}`,
    );
  }
  return bytes;
}

function bufferSource(bytes: Uint8Array): BufferSource {
  // Structured-clone-safe copy: WebAuthn impls may detach the buffer.
  return new Uint8Array(bytes).buffer;
}

async function assertPrf(
  bridge: AuthenticatorBridge,
  ctx: UnlockContext,
  credentialId: Uint8Array,
  challenge: Uint8Array,
): Promise<Uint8Array> {
  const evalFirst = prfEvalFirst(ctx.rpId, ctx.vaultId);
  const credential = await bridge.get({
    publicKey: {
      rpId: ctx.rpId,
      challenge: bufferSource(challenge),
      allowCredentials: [{ type: "public-key", id: bufferSource(credentialId) }],
      userVerification: "required",
      extensions: {
        prf: { eval: { first: bufferSource(evalFirst) } },
      } as AuthenticationExtensionsClientInputs,
    },
  });
  if (!credential) {
    throw new PrfUnavailableError("assertion returned no credential");
  }
  return prfResultFirst(credential);
}

/**
 * Registration (§2.1): create the credential, run one assertion to obtain the
 * PRF output, then build the Device-Key Envelope (DK under DWK) and the
 * Device Envelope (VK under DK).
 *
 * The caller provides the already-unlocked Vault Key (registration is only
 * offered after a successful Master-Password unlock) and remains responsible
 * for zeroizing it.
 */
export async function registerPrfUnlock(opts: {
  ctx: UnlockContext;
  rpName: string;
  vaultKey: Uint8Array;
  challenge: Uint8Array;
  userHandle: Uint8Array;
  userName: string;
  bridge?: AuthenticatorBridge;
}): Promise<PrfRegistrationResult> {
  const bridge = opts.bridge ?? browserBridge();
  const { ctx } = opts;

  const created = await bridge.create({
    publicKey: {
      rp: { id: ctx.rpId, name: opts.rpName },
      user: {
        id: bufferSource(opts.userHandle),
        name: opts.userName,
        displayName: opts.userName,
      },
      challenge: bufferSource(opts.challenge),
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },   // ES256
        { type: "public-key", alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        userVerification: "required",
        residentKey: "preferred",
      },
      extensions: { prf: {} } as AuthenticationExtensionsClientInputs,
    },
  });
  if (!created) {
    throw new PrfUnavailableError("credential creation returned null");
  }
  const credentialId = toBytes(created.rawId);

  // Some platforms return PRF results at create time; otherwise run one assertion.
  let prfOutput: Uint8Array;
  try {
    prfOutput = prfResultFirst(created);
  } catch {
    prfOutput = await assertPrf(bridge, ctx, credentialId, opts.challenge);
  }

  const dwk = deriveDeviceWrappingKey({
    prfOutput,
    rpId: ctx.rpId,
    vaultId: ctx.vaultId,
    deviceId: ctx.deviceId,
    credentialId,
  });
  zeroize(prfOutput);

  const deviceKey = generateDeviceKey();
  try {
    const deviceKeyEnvelope = wrapDeviceKey({
      deviceKey,
      deviceWrappingKey: dwk,
      vaultId: ctx.vaultId,
      deviceId: ctx.deviceId,
      credentialId,
    });
    const deviceEnvelope = wrapVaultKey({
      vaultKey: opts.vaultKey,
      wrappingKey: deviceKey,
      vaultId: ctx.vaultId,
      type: "device",
      deviceId: ctx.deviceId,
    });
    return { credentialId, deviceKeyEnvelope, deviceEnvelope };
  } finally {
    zeroize(dwk, deviceKey);
  }
}

/**
 * Unlock (§2.2): assertion → PRF output → DWK → DK → VK.
 * Throws PrfUnavailableError when the caller must fall back (largeBlob,
 * UV-gated local store, or always-available Master Password).
 */
export async function unlockWithPrf(opts: {
  ctx: UnlockContext;
  credentialId: Uint8Array;
  challenge: Uint8Array;
  deviceKeyEnvelope: DeviceKeyEnvelope;
  deviceEnvelope: KeyEnvelope;
  bridge?: AuthenticatorBridge;
}): Promise<Uint8Array> {
  const bridge = opts.bridge ?? browserBridge();
  const { ctx } = opts;

  const prfOutput = await assertPrf(bridge, ctx, opts.credentialId, opts.challenge);
  const dwk = deriveDeviceWrappingKey({
    prfOutput,
    rpId: ctx.rpId,
    vaultId: ctx.vaultId,
    deviceId: ctx.deviceId,
    credentialId: opts.credentialId,
  });
  zeroize(prfOutput);

  let deviceKey: Uint8Array | undefined;
  try {
    deviceKey = unwrapDeviceKey(opts.deviceKeyEnvelope, dwk);
    return unwrapVaultKey(opts.deviceEnvelope, deviceKey, ctx.vaultId);
  } finally {
    zeroize(dwk, deviceKey);
  }
}
