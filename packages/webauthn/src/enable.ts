/**
 * Enabling device unlock (webauthn-prf.md §2.1 + §5 ranking).
 *
 * Runs only while the vault is already unlocked with the master password, and
 * only ever *adds* a way in: the master envelope is untouched, so master
 * password unlock stays available on this device no matter what happens here.
 */
import {
  bindDeviceWithPrfOutput,
  bindDeviceWithWrappingKey,
  bytesToBase64,
  encodeDeviceKeyEnvelope,
  generateDeviceKey,
  prfEvalFirst,
  zeroize,
} from "@4allpass/crypto";
import type { DeviceKeyEnvelope, KeyEnvelope } from "@4allpass/crypto";
import { assertUserVerified } from "./authenticator-data.ts";
import { DeviceUnlockUnavailableError, WebAuthnUnavailableError } from "./errors.ts";
import { writeLargeBlob } from "./large-blob.ts";
import { assertPrfOutput, newChallenge, readPrfFirst } from "./prf.ts";
import { MECHANISM_RANK } from "./types.ts";
import type {
  AttestationLike,
  DeviceUnlockMechanism,
  DeviceUnlockRecord,
  DeviceUnlockStore,
  WebAuthnClient,
} from "./types.ts";

export const DEFAULT_MECHANISMS: readonly DeviceUnlockMechanism[] = [
  "prf",
  "large_blob",
  "uv_gated_local",
];

export interface EnableDeviceUnlockOptions {
  client: WebAuthnClient;
  store: DeviceUnlockStore;
  /** Vault Key of the unlocked vault. Stays owned by the caller. */
  vaultKey: Uint8Array;
  vaultId: string;
  deviceId: string;
  /** Vault-Key generation of the unlocked vault. */
  vaultKeyVersion: number;
  /** Device-Key generation being minted: 1 for a first binding. */
  deviceKeyVersion: number;
  rpId: string;
  rpName?: string;
  user: { id: Uint8Array; name: string; displayName: string };
  /** Reuse an existing credential on this device instead of creating one. */
  credentialId?: Uint8Array;
  /** Ranks this deployment permits, highest security first. */
  allowedMechanisms?: readonly DeviceUnlockMechanism[];
}

export interface EnableDeviceUnlockResult {
  mechanism: DeviceUnlockMechanism;
  credentialId: Uint8Array;
  /** Upload this to the server: VK wrapped under the Device Key. */
  deviceEnvelope: KeyEnvelope;
  /**
   * Only set for `prf`: the Device-Key Envelope may be mirrored to the server
   * as an opaque blob, because unwrapping it needs the DWK, which only a live
   * assertion on this authenticator can produce. Ranks 2 and 3 are wrapped
   * under a locally held key and are never uploaded.
   */
  mirrorableDeviceKeyEnvelope?: DeviceKeyEnvelope;
  record: DeviceUnlockRecord;
}

function sortByRank(
  mechanisms: readonly DeviceUnlockMechanism[],
): readonly DeviceUnlockMechanism[] {
  return [...new Set(mechanisms)].sort((a, b) => MECHANISM_RANK[a] - MECHANISM_RANK[b]);
}

export async function enableDeviceUnlock(
  options: EnableDeviceUnlockOptions,
): Promise<EnableDeviceUnlockResult> {
  const mechanisms = sortByRank(options.allowedMechanisms ?? DEFAULT_MECHANISMS);
  if (mechanisms.length === 0) {
    throw new DeviceUnlockUnavailableError([{ mechanism: "none", reason: "no mechanism allowed" }]);
  }
  if (!options.client.isSupported()) {
    throw new WebAuthnUnavailableError("this browser has no WebAuthn API");
  }

  let credentialId = options.credentialId;
  let createTimePrf: Uint8Array | null = null;
  if (!credentialId) {
    let attestation: AttestationLike;
    try {
      attestation = await options.client.create({
        rpId: options.rpId,
        rpName: options.rpName ?? "4AllPass",
        user: options.user,
        challenge: newChallenge(),
        userVerification: "required",
        prfEvalFirst: prfEvalFirst(options.rpId, options.vaultId),
        requestLargeBlob: mechanisms.includes("large_blob"),
      });
    } catch (error) {
      if (error instanceof WebAuthnUnavailableError) throw error;
      throw new WebAuthnUnavailableError(`credential creation failed: ${describe(error)}`, {
        cause: error,
      });
    }
    credentialId = new Uint8Array(attestation.rawId);
    if (credentialId.length === 0) {
      throw new WebAuthnUnavailableError("authenticator returned an empty credential id");
    }
    // Some platforms already return PRF results at create time (§2.1 step 5).
    try {
      createTimePrf = readPrfFirst(attestation.extensionResults);
    } catch {
      createTimePrf = null;
    }
  }

  const attempted: Array<{ mechanism: DeviceUnlockMechanism | "none"; reason: string }> = [];
  for (const mechanism of mechanisms) {
    try {
      return await provision(mechanism, options, credentialId, createTimePrf);
    } catch (error) {
      attempted.push({ mechanism, reason: describe(error) });
      if (createTimePrf) {
        zeroize(createTimePrf);
        createTimePrf = null;
      }
    }
  }
  throw new DeviceUnlockUnavailableError(attempted);
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

async function provision(
  mechanism: DeviceUnlockMechanism,
  options: EnableDeviceUnlockOptions,
  credentialId: Uint8Array,
  createTimePrf: Uint8Array | null,
): Promise<EnableDeviceUnlockResult> {
  const base = {
    vaultId: options.vaultId,
    deviceId: options.deviceId,
    rpId: options.rpId,
    credentialId: bytesToBase64(credentialId),
    deviceKeyVersion: options.deviceKeyVersion,
    createdAt: new Date().toISOString(),
  };

  if (mechanism === "prf") {
    const prfOutput =
      createTimePrf ??
      (await assertPrfOutput({
        client: options.client,
        rpId: options.rpId,
        vaultId: options.vaultId,
        credentialId,
      }));
    // bindDeviceWithPrfOutput zeroizes prfOutput, the DWK, and the Device Key.
    const binding = bindDeviceWithPrfOutput({
      prfOutput,
      vaultKey: options.vaultKey,
      rpId: options.rpId,
      vaultId: options.vaultId,
      deviceId: options.deviceId,
      credentialId,
      vaultKeyVersion: options.vaultKeyVersion,
      deviceKeyVersion: options.deviceKeyVersion,
    });
    const record: DeviceUnlockRecord = {
      ...base,
      mechanism,
      deviceKeyEnvelope: encodeDeviceKeyEnvelope(binding.deviceKeyEnvelope),
    };
    await options.store.save(record);
    return {
      mechanism,
      credentialId,
      deviceEnvelope: binding.deviceEnvelope,
      mirrorableDeviceKeyEnvelope: binding.deviceKeyEnvelope,
      record,
    };
  }

  const wrappingKey = generateDeviceKey();
  try {
    const binding = bindDeviceWithWrappingKey({
      deviceWrappingKey: wrappingKey,
      vaultKey: options.vaultKey,
      vaultId: options.vaultId,
      deviceId: options.deviceId,
      credentialId,
      vaultKeyVersion: options.vaultKeyVersion,
      deviceKeyVersion: options.deviceKeyVersion,
    });

    if (mechanism === "large_blob") {
      await writeLargeBlob({
        client: options.client,
        rpId: options.rpId,
        credentialId,
        envelope: binding.deviceKeyEnvelope,
      });
      const record: DeviceUnlockRecord = {
        ...base,
        mechanism,
        wrappingKey: bytesToBase64(wrappingKey),
      };
      await options.store.save(record);
      return { mechanism, credentialId, deviceEnvelope: binding.deviceEnvelope, record };
    }

    // Rank 3: prove the authenticator can verify the user before this device
    // starts relying on a locally held wrapping key.
    const assertion = await options.client.get({
      rpId: options.rpId,
      challenge: newChallenge(),
      credentialId,
      userVerification: "required",
    });
    assertUserVerified(assertion.authenticatorData, options.rpId);
    const record: DeviceUnlockRecord = {
      ...base,
      mechanism,
      deviceKeyEnvelope: encodeDeviceKeyEnvelope(binding.deviceKeyEnvelope),
      wrappingKey: bytesToBase64(wrappingKey),
    };
    await options.store.save(record);
    return { mechanism, credentialId, deviceEnvelope: binding.deviceEnvelope, record };
  } finally {
    zeroize(wrappingKey);
  }
}

/** Forget the local unlock material. Master-password unlock is unaffected. */
export async function disableDeviceUnlock(
  store: DeviceUnlockStore,
  vaultId: string,
  deviceId: string,
): Promise<void> {
  await store.remove(vaultId, deviceId);
}
