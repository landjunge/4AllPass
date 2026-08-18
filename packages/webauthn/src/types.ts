import type { WireDeviceKeyEnvelope } from "@4allpass/crypto";

/**
 * Fallback ranks of webauthn-prf.md §5, best first.
 *
 * - `prf`: PRF output → HKDF → DWK unwraps the Device-Key Envelope.
 * - `large_blob`: the Device-Key Envelope lives in the authenticator's
 *   largeBlob; its wrapping key lives in local storage. Both are needed.
 * - `uv_gated_local`: envelope and wrapping key are both local. Policy only —
 *   a modified client or XSS after UV can read them.
 */
export type DeviceUnlockMechanism = "prf" | "large_blob" | "uv_gated_local";

export const MECHANISM_RANK: Readonly<Record<DeviceUnlockMechanism, 1 | 2 | 3>> = {
  prf: 1,
  large_blob: 2,
  uv_gated_local: 3,
};

/**
 * Everything this device keeps locally to unlock without the master password.
 * Never contains the Vault Key, the Device Key, or the Master Key.
 */
export interface DeviceUnlockRecord {
  vaultId: string;
  deviceId: string;
  rpId: string;
  /** base64 raw WebAuthn credential id */
  credentialId: string;
  mechanism: DeviceUnlockMechanism;
  /**
   * Device-Key generation this device holds. Kept here rather than read from
   * the envelope: for `large_blob` the envelope comes back from the
   * authenticator, and an envelope may not vouch for its own generation.
   */
  deviceKeyVersion: number;
  /** Absent for `large_blob`: the authenticator holds the envelope. */
  deviceKeyEnvelope?: WireDeviceKeyEnvelope;
  /** base64 32-byte local wrapping key. Absent for `prf`. */
  wrappingKey?: string;
  createdAt: string;
}

export interface DeviceUnlockStore {
  load(vaultId: string, deviceId: string): Promise<DeviceUnlockRecord | null>;
  save(record: DeviceUnlockRecord): Promise<void>;
  remove(vaultId: string, deviceId: string): Promise<void>;
}

/** Browsers hand back ArrayBuffer; the test authenticator uses Uint8Array. */
export type ExtensionBytes = Uint8Array | ArrayBuffer;

export interface PrfExtensionOutput {
  enabled?: boolean;
  results?: { first?: ExtensionBytes; second?: ExtensionBytes };
}

export interface LargeBlobExtensionOutput {
  supported?: boolean;
  blob?: ExtensionBytes;
  written?: boolean;
}

export interface ExtensionResultsLike {
  prf?: PrfExtensionOutput;
  largeBlob?: LargeBlobExtensionOutput;
}

export interface AssertionLike {
  rawId: ArrayBuffer;
  authenticatorData: ArrayBuffer;
  extensionResults: ExtensionResultsLike;
}

export interface AttestationLike {
  rawId: ArrayBuffer;
  extensionResults: ExtensionResultsLike;
}

export interface CreateCredentialRequest {
  rpId: string;
  rpName: string;
  user: { id: Uint8Array; name: string; displayName: string };
  challenge: Uint8Array;
  /** Always "required" for 4AllPass. */
  userVerification: "required";
  /** PRF eval.first, sent so platforms that support it can return results at create time. */
  prfEvalFirst: Uint8Array;
  requestLargeBlob: boolean;
}

export interface GetAssertionRequest {
  rpId: string;
  challenge: Uint8Array;
  credentialId: Uint8Array;
  /** Always "required" for 4AllPass. */
  userVerification: "required";
  /** Omitted for mechanisms that do not use PRF. */
  prfEvalFirst?: Uint8Array;
  largeBlob?: { read: true } | { write: Uint8Array };
}

/**
 * The authenticator boundary. `@4allpass/crypto` never talks to an
 * authenticator, and neither do the unlock flows here: they go through this
 * interface, which the browser implementation and the tests both satisfy.
 */
export interface WebAuthnClient {
  isSupported(): boolean;
  hasPlatformAuthenticator(): Promise<boolean>;
  create(request: CreateCredentialRequest): Promise<AttestationLike>;
  get(request: GetAssertionRequest): Promise<AssertionLike>;
}
