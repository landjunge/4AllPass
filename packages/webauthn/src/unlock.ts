/**
 * Device unlock (webauthn-prf.md §2.2 and §5).
 *
 * Every path ends in `DK → VK` from the Device Envelope the server stored. If
 * none of them works, this throws `DeviceUnlockUnavailableError` so the caller
 * falls back to the master password instead of failing hard — master-password
 * unlock must stay possible on every device.
 */
import {
  base64ToBytes,
  decodeDeviceKeyEnvelope,
  unwrapVaultKeyWithDeviceWrappingKey,
  unwrapVaultKeyWithPrfOutput,
  zeroize,
} from "@4allpass/crypto";
import type { DeviceKeyEnvelope, KeyEnvelope } from "@4allpass/crypto";
import { assertUserVerified } from "./authenticator-data.ts";
import { DeviceUnlockError, DeviceUnlockUnavailableError } from "./errors.ts";
import { readLargeBlob } from "./large-blob.ts";
import { assertPrfOutput, newChallenge } from "./prf.ts";
import type {
  DeviceUnlockMechanism,
  DeviceUnlockRecord,
  DeviceUnlockStore,
  WebAuthnClient,
} from "./types.ts";

export interface UnlockWithDeviceOptions {
  client: WebAuthnClient;
  store: DeviceUnlockStore;
  vaultId: string;
  deviceId: string;
  /** Vault-Key generation of the snapshot being unlocked. */
  vaultKeyVersion: number;
  /** Device-Key generation this device expects to open. */
  deviceKeyVersion: number;
  /** The Device Envelope of the active snapshot, for this deviceId. */
  deviceEnvelope: KeyEnvelope;
  /**
   * Mirror of the PRF Device-Key Envelope from the server, used when this
   * browser lost its local copy. Only useful for the `prf` mechanism.
   */
  mirroredDeviceKeyEnvelope?: DeviceKeyEnvelope;
}

export interface DeviceUnlockResult {
  vaultKey: Uint8Array;
  mechanism: DeviceUnlockMechanism;
}

export async function unlockWithDevice(
  options: UnlockWithDeviceOptions,
): Promise<DeviceUnlockResult> {
  const record = await options.store.load(options.vaultId, options.deviceId);
  if (!record) {
    throw new DeviceUnlockUnavailableError([
      { mechanism: "none", reason: "device unlock is not enabled for this vault on this device" },
    ]);
  }
  if (!options.client.isSupported()) {
    throw new DeviceUnlockUnavailableError([
      { mechanism: record.mechanism, reason: "this browser has no WebAuthn API" },
    ]);
  }
  if (!record.rpId) {
    throw new DeviceUnlockError("stored record has no rpId");
  }
  try {
    return await runMechanism(record, options);
  } catch (error) {
    throw new DeviceUnlockUnavailableError([
      { mechanism: record.mechanism, reason: describe(error) },
    ]);
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function localDeviceKeyEnvelope(record: DeviceUnlockRecord): DeviceKeyEnvelope {
  if (!record.deviceKeyEnvelope) {
    throw new DeviceUnlockError(`record for ${record.mechanism} has no device-key envelope`);
  }
  return decodeDeviceKeyEnvelope(record.deviceKeyEnvelope);
}

function storedWrappingKey(record: DeviceUnlockRecord): Uint8Array {
  if (!record.wrappingKey) {
    throw new DeviceUnlockError(`record for ${record.mechanism} has no wrapping key`);
  }
  return base64ToBytes(record.wrappingKey);
}

async function runMechanism(
  record: DeviceUnlockRecord,
  options: UnlockWithDeviceOptions,
): Promise<DeviceUnlockResult> {
  const credentialId = base64ToBytes(record.credentialId);

  if (record.mechanism === "prf") {
    const deviceKeyEnvelope = record.deviceKeyEnvelope
      ? localDeviceKeyEnvelope(record)
      : requireMirror(options);
    const prfOutput = await assertPrfOutput({
      client: options.client,
      rpId: record.rpId,
      vaultId: options.vaultId,
      credentialId,
    });
    // Zeroizes prfOutput, the DWK, and the Device Key; only VK survives.
    const vaultKey = unwrapVaultKeyWithPrfOutput({
      prfOutput,
      deviceKeyEnvelope,
      deviceEnvelope: options.deviceEnvelope,
      rpId: record.rpId,
      vaultId: options.vaultId,
      vaultKeyVersion: options.vaultKeyVersion,
      deviceKeyVersion: options.deviceKeyVersion,
      credentialId,
    });
    return { vaultKey, mechanism: "prf" };
  }

  if (record.mechanism === "large_blob") {
    const deviceKeyEnvelope = await readLargeBlob({
      client: options.client,
      rpId: record.rpId,
      credentialId,
    });
    const wrappingKey = storedWrappingKey(record);
    try {
      const vaultKey = unwrapVaultKeyWithDeviceWrappingKey({
        deviceKeyEnvelope,
        deviceEnvelope: options.deviceEnvelope,
        wrappingKey,
        vaultId: options.vaultId,
        vaultKeyVersion: options.vaultKeyVersion,
        deviceKeyVersion: options.deviceKeyVersion,
      });
      return { vaultKey, mechanism: "large_blob" };
    } finally {
      zeroize(wrappingKey);
    }
  }

  // Rank 3: the UV assertion is the only gate in front of local key material.
  const assertion = await options.client.get({
    rpId: record.rpId,
    challenge: newChallenge(),
    credentialId,
    userVerification: "required",
  });
  assertUserVerified(assertion.authenticatorData, record.rpId);
  const deviceKeyEnvelope = localDeviceKeyEnvelope(record);
  const wrappingKey = storedWrappingKey(record);
  try {
    const vaultKey = unwrapVaultKeyWithDeviceWrappingKey({
      deviceKeyEnvelope,
      deviceEnvelope: options.deviceEnvelope,
      wrappingKey,
      vaultId: options.vaultId,
      vaultKeyVersion: options.vaultKeyVersion,
      deviceKeyVersion: options.deviceKeyVersion,
    });
    return { vaultKey, mechanism: "uv_gated_local" };
  } finally {
    zeroize(wrappingKey);
  }
}

function requireMirror(options: UnlockWithDeviceOptions): DeviceKeyEnvelope {
  if (!options.mirroredDeviceKeyEnvelope) {
    throw new DeviceUnlockError("no local and no mirrored device-key envelope for this device");
  }
  return options.mirroredDeviceKeyEnvelope;
}
