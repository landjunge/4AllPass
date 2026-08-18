/**
 * 4AllPass — WebAuthn / PRF device unlock (docs/webauthn-prf.md).
 *
 * WebAuthn is **not** an encryption oracle for the Vault Key. This module
 * implements exactly the construction from docs/webauthn-prf.md:
 *
 *   assertion + PRF -> 32-byte PRF output -> HKDF-SHA-256 -> DWK
 *     -> unwrap Device-Key Envelope -> DK -> unwrap Device Envelope -> VK
 *
 * The "core" functions below (`buildDeviceRegistration`, `unlockVaultKey`)
 * are pure: they take an already-obtained PRF output and never touch
 * `navigator.credentials`, which keeps them unit-testable without a real
 * authenticator (see `webauthnPrf.test.ts`, mirroring the fixed 32-byte
 * stand-in approach used for `device-prf-v1.json`). The thin
 * `navigator.credentials` glue lives at the bottom and is intentionally not
 * unit tested here.
 *
 * PRF output and the Device Wrapping Key are zeroized immediately after use
 * and are never returned to callers (webauthn-prf.md §1, §2.2 step 7).
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
} from '@4allpass/crypto'

export interface DeviceIdentity {
  rpId: string
  vaultId: string
  deviceId: string
  credentialId: Uint8Array
}

/**
 * The key generations this device is operating on. Crypto Protocol v1 never
 * defaults them: `vaultKeyVersion` comes from the snapshot being unlocked and
 * `deviceKeyVersion` from this device's own Device-Key generation
 * (webauthn-prf.md §4.1).
 */
export interface KeyGenerations {
  vaultKeyVersion: number
  deviceKeyVersion: number
}

export interface DeviceRegistrationResult {
  /** Wraps DK under DWK — kept locally, optionally mirrored to the server as an opaque blob. */
  deviceKeyEnvelope: DeviceKeyEnvelope
  /** Wraps VK under DK — uploaded to the server (crypto-protocol.md §3, type = "device"). */
  deviceEnvelope: KeyEnvelope
}

/**
 * §2.1 Registration, steps 4–8 — must run after a successful Master
 * Password unlock (the caller already holds `vaultKey` in memory).
 *
 * `prfOutput` is the raw 32 bytes from
 * `clientExtensionResults.prf.results.first`, obtained by the caller via
 * `getPrfOutputFromAssertion` (or the create-time PRF results, if the
 * platform returned them).
 */
export function buildDeviceRegistration(
  identity: DeviceIdentity,
  generations: KeyGenerations,
  vaultKey: Uint8Array,
  prfOutput: Uint8Array,
): DeviceRegistrationResult {
  const deviceWrappingKey = deriveDeviceWrappingKey({ prfOutput, ...identity })
  const deviceKey = generateDeviceKey()

  try {
    const deviceKeyEnvelope = wrapDeviceKey({
      deviceKey,
      deviceWrappingKey,
      vaultId: identity.vaultId,
      deviceId: identity.deviceId,
      credentialId: identity.credentialId,
      deviceKeyVersion: generations.deviceKeyVersion,
    })

    const deviceEnvelope = wrapVaultKey({
      vaultKey,
      wrappingKey: deviceKey,
      vaultId: identity.vaultId,
      type: 'device',
      vaultKeyVersion: generations.vaultKeyVersion,
      deviceId: identity.deviceId,
      deviceKeyVersion: generations.deviceKeyVersion,
    })

    return { deviceKeyEnvelope, deviceEnvelope }
  } finally {
    zeroize(deviceWrappingKey)
    zeroize(deviceKey)
    zeroize(prfOutput)
  }
}

/**
 * §2.2 Unlock, steps 4–7. Returns the Vault Key; the caller is responsible
 * for zeroizing it on lock (crypto-protocol.md §10).
 */
export function unlockVaultKey(
  identity: DeviceIdentity,
  generations: KeyGenerations,
  envelopes: DeviceRegistrationResult,
  prfOutput: Uint8Array,
): Uint8Array {
  const deviceWrappingKey = deriveDeviceWrappingKey({ prfOutput, ...identity })
  let deviceKey: Uint8Array | undefined
  try {
    // Both open calls state what this device expects: an envelope for another
    // vault, device, credential or key generation is refused rather than opened.
    deviceKey = unwrapDeviceKey(envelopes.deviceKeyEnvelope, {
      deviceWrappingKey,
      vaultId: identity.vaultId,
      deviceId: identity.deviceId,
      credentialId: identity.credentialId,
      deviceKeyVersion: generations.deviceKeyVersion,
    })
    return unwrapVaultKey(envelopes.deviceEnvelope, {
      wrappingKey: deviceKey,
      vaultId: identity.vaultId,
      expectType: 'device',
      expectVaultKeyVersion: generations.vaultKeyVersion,
      expectDeviceId: identity.deviceId,
      expectDeviceKeyVersion: generations.deviceKeyVersion,
    })
  } finally {
    zeroize(deviceWrappingKey)
    if (deviceKey) zeroize(deviceKey)
    zeroize(prfOutput)
  }
}

// --- Browser glue (not unit-testable without a real authenticator) -------

/**
 * PRF extension types. Not yet part of TypeScript's lib.dom.d.ts, so we
 * declare the minimal shape used here rather than widening global types.
 */
interface PrfExtensionInput {
  eval: { first: BufferSource; second?: BufferSource }
}
interface PrfExtensionOutput {
  enabled?: boolean
  results?: { first?: ArrayBuffer; second?: ArrayBuffer }
}
type AuthenticationExtensionsWithPrf = AuthenticationExtensionsClientInputs & {
  prf?: PrfExtensionInput
}
type AuthenticationExtensionsResultsWithPrf = AuthenticationExtensionsClientOutputs & {
  prf?: PrfExtensionOutput
}

/**
 * webauthn-prf.md §2.2 step 1–2: request an assertion with the PRF eval
 * input. `challenge` must come from the server (anti-replay). Callers
 * supply it; a dedicated WebAuthn-ceremony endpoint is not wired yet.
 */
export function buildAssertionRequestOptions(
  identity: Pick<DeviceIdentity, 'rpId' | 'vaultId' | 'credentialId'>,
  challenge: Uint8Array<ArrayBuffer>,
): PublicKeyCredentialRequestOptions {
  // Cast to ArrayBuffer-backed views: `prfEvalFirst`/`credentialId` are
  // always plain `new Uint8Array(...)` values, never SharedArrayBuffer-backed.
  const first = prfEvalFirst(identity.rpId, identity.vaultId) as Uint8Array<ArrayBuffer>
  const credentialId = identity.credentialId as Uint8Array<ArrayBuffer>
  const extensions: AuthenticationExtensionsWithPrf = {
    prf: { eval: { first } },
  }
  return {
    challenge,
    rpId: identity.rpId,
    userVerification: 'required',
    allowCredentials: [{ id: credentialId, type: 'public-key' }],
    extensions,
  }
}

/**
 * webauthn-prf.md §2.2 step 3: read the 32-byte PRF output, or `null` if
 * PRF is unavailable — the caller must then fall back per §5 (largeBlob,
 * then UV-gated local store, and Master Password unlock always remains).
 */
export function getPrfOutputFromAssertion(
  assertion: PublicKeyCredential,
): Uint8Array | null {
  const results = assertion.getClientExtensionResults() as AuthenticationExtensionsResultsWithPrf
  const first = results.prf?.results?.first
  if (!first || first.byteLength !== 32) return null
  return new Uint8Array(first)
}
