/**
 * The unlock / commit engine of the web client.
 *
 * Rules this file exists to keep:
 * - The Vault Key is random and only ever appears here after a successful
 *   unwrap. The master password and the derived Master Key are zeroized as soon
 *   as the envelope is open.
 * - Every snapshot is checked for freshness against the local pin *and* for
 *   internal consistency before anything is decrypted into the UI.
 * - WebAuthn only ever produces a Device Wrapping Key; the Vault Key path is
 *   DWK → Device Key → Vault Key.
 * - Master-password unlock is never disabled by anything here.
 */
import {
  ARGON2ID_PROFILES,
  assertFreshSnapshot,
  bytesToBase64,
  decodeDeviceKeyEnvelope,
  decodeVaultSnapshot,
  decryptEntry,
  deriveMasterKey,
  deriveMasterKeyFromEnvelope,
  encodeEncryptedEntry,
  encodeKeyEnvelope,
  encodeDeviceKeyEnvelope,
  encryptEntry,
  generateRecoveryKey,
  generateSalt,
  generateVaultKey,
  kdfParamsFrom,
  unwrapVaultKey,
  verifySnapshotIntegrity,
  wrapVaultKey,
  zeroize,
} from "@4allpass/crypto";
import type {
  Argon2idProfileName,
  KeyEnvelope,
  VaultSnapshot,
} from "@4allpass/crypto";
import {
  browserWebAuthnClient,
  enableDeviceUnlock,
  indexedDbDeviceUnlockStore,
  unlockWithDevice as unlockWithDeviceCredential,
} from "@4allpass/webauthn";
import type { DeviceUnlockMechanism } from "@4allpass/webauthn";
import { api, ApiError } from "./api.ts";
import { describeDevice, deviceId, rpId } from "./device-identity.ts";
import {
  decodeEntryPlaintext,
  encodeEntryPlaintext,
  ENTRY_SCHEMA_VERSION,
  type VaultEntry,
} from "./entries.ts";
import { formatRecoveryKey, parseRecoveryKey } from "./recovery-key.ts";
import { loadPin, savePin } from "./revision-pin.ts";

export type UnlockMethod = "master_password" | "recovery_key" | DeviceUnlockMechanism;

export interface UnlockedVault {
  vaultId: string;
  revision: number;
  vaultKeyVersion: number;
  /** Zeroized by `lock`. Never leaves the client. */
  vaultKey: Uint8Array;
  envelopes: KeyEnvelope[];
  entries: VaultEntry[];
  unlockedWith: UnlockMethod;
}

export class DeviceUnlockNotPossible extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DeviceUnlockNotPossible";
  }
}

export class CommitConflict extends Error {
  readonly currentRevision: number | null;

  constructor(currentRevision: number | null) {
    super("the vault changed on the server; reload and try again");
    this.name = "CommitConflict";
    this.currentRevision = currentRevision;
  }
}

const store = () => indexedDbDeviceUnlockStore();
const client = () => browserWebAuthnClient();

function masterEnvelopeOf(snapshot: VaultSnapshot): KeyEnvelope {
  const envelope = snapshot.envelopes.find((candidate) => candidate.type === "master");
  if (!envelope) throw new Error("snapshot has no master envelope");
  return envelope;
}

function deviceEnvelopeOf(snapshot: VaultSnapshot, id: string): KeyEnvelope | null {
  return (
    snapshot.envelopes.find(
      (candidate) => candidate.type === "device" && candidate.deviceId === id,
    ) ?? null
  );
}

/** Fetch the active snapshot and refuse a rollback before touching any key. */
async function fetchFreshSnapshot(vaultId: string): Promise<VaultSnapshot> {
  const snapshot = decodeVaultSnapshot(await api.getSnapshot(vaultId));
  if (snapshot.vaultId !== vaultId) {
    throw new Error("server returned a snapshot for a different vault");
  }
  assertFreshSnapshot(loadPin(vaultId), {
    vaultId: snapshot.vaultId,
    revision: snapshot.revision,
    vaultKeyVersion: snapshot.vaultKeyVersion,
    cryptoProtocolVersion: snapshot.cryptoProtocolVersion,
  });
  return snapshot;
}

function openSnapshot(
  snapshot: VaultSnapshot,
  vaultKey: Uint8Array,
  unlockedWith: UnlockMethod,
  crossChecks: ReadonlyArray<{ envelope: KeyEnvelope; wrappingKey: Uint8Array }> = [],
): UnlockedVault {
  verifySnapshotIntegrity({ snapshot, vaultKey, crossChecks });
  const entries: VaultEntry[] = snapshot.entries.map((entry) => {
    const plaintext = decryptEntry(entry, vaultKey, snapshot.vaultId);
    try {
      return decodeEntryPlaintext(entry.id, plaintext);
    } finally {
      zeroize(plaintext);
    }
  });
  savePin({
    vaultId: snapshot.vaultId,
    revision: snapshot.revision,
    vaultKeyVersion: snapshot.vaultKeyVersion,
    cryptoProtocolVersion: 1,
  });
  return {
    vaultId: snapshot.vaultId,
    revision: snapshot.revision,
    vaultKeyVersion: snapshot.vaultKeyVersion,
    vaultKey,
    envelopes: snapshot.envelopes,
    entries: entries.sort((a, b) => a.title.localeCompare(b.title)),
    unlockedWith,
  };
}

export interface CreatedVault {
  vault: UnlockedVault;
  /** Show once, then it only exists on the user's Emergency Kit. */
  recoveryKey: string;
}

export async function createVault(
  masterPassword: string,
  profileName: Argon2idProfileName = "standard",
): Promise<CreatedVault> {
  const profile = ARGON2ID_PROFILES[profileName];
  const summary = await api.createVault();
  const vaultId = summary.vaultId;

  const vaultKey = generateVaultKey();
  const salt = generateSalt(16);
  const masterKey = deriveMasterKey(masterPassword, salt, profile);
  const recoveryKey = generateRecoveryKey();
  try {
    const masterEnvelope = wrapVaultKey({
      vaultKey,
      wrappingKey: masterKey,
      vaultId,
      type: "master",
      kdf: kdfParamsFrom(profile, salt),
    });
    const recoveryEnvelope = wrapVaultKey({
      vaultKey,
      wrappingKey: recoveryKey,
      vaultId,
      type: "recovery",
    });
    const committed = decodeVaultSnapshot(
      await api.commitSnapshot(vaultId, {
        revision: 1,
        vaultKeyVersion: 1,
        cryptoProtocolVersion: 1,
        envelopes: [encodeKeyEnvelope(masterEnvelope), encodeKeyEnvelope(recoveryEnvelope)],
        entries: [],
      }),
    );
    const vault = openSnapshot(committed, vaultKey, "master_password", [
      { envelope: masterEnvelopeOf(committed), wrappingKey: masterKey },
    ]);
    return { vault, recoveryKey: formatRecoveryKey(recoveryKey) };
  } finally {
    zeroize(masterKey, recoveryKey);
  }
}

export async function unlockWithMasterPassword(
  vaultId: string,
  masterPassword: string,
): Promise<UnlockedVault> {
  const snapshot = await fetchFreshSnapshot(vaultId);
  const masterEnvelope = masterEnvelopeOf(snapshot);
  const masterKey = deriveMasterKeyFromEnvelope(masterPassword, masterEnvelope);
  try {
    const vaultKey = unwrapVaultKey(masterEnvelope, masterKey, vaultId);
    return openSnapshot(snapshot, vaultKey, "master_password", [
      { envelope: masterEnvelope, wrappingKey: masterKey },
    ]);
  } finally {
    zeroize(masterKey);
  }
}

export async function unlockWithRecoveryKey(
  vaultId: string,
  recoveryKeyText: string,
): Promise<UnlockedVault> {
  const snapshot = await fetchFreshSnapshot(vaultId);
  const envelope = snapshot.envelopes.find((candidate) => candidate.type === "recovery");
  if (!envelope) throw new Error("this vault has no recovery envelope");
  const recoveryKey = parseRecoveryKey(recoveryKeyText);
  try {
    const vaultKey = unwrapVaultKey(envelope, recoveryKey, vaultId);
    return openSnapshot(snapshot, vaultKey, "recovery_key", [{ envelope, wrappingKey: recoveryKey }]);
  } finally {
    zeroize(recoveryKey);
  }
}

export async function hasDeviceUnlock(vaultId: string): Promise<boolean> {
  try {
    return (await store().load(vaultId, deviceId())) !== null;
  } catch {
    return false;
  }
}

/**
 * Biometric unlock: assertion → PRF (or a fallback rank) → DWK → DK → VK.
 * Any failure raises `DeviceUnlockNotPossible`; the UI then offers the master
 * password, which always stays available.
 */
export async function unlockWithDevice(vaultId: string): Promise<UnlockedVault> {
  const id = deviceId();
  const record = await store().load(vaultId, id);
  if (!record) {
    throw new DeviceUnlockNotPossible("device unlock is not set up in this browser profile");
  }
  const snapshot = await fetchFreshSnapshot(vaultId);
  const deviceEnvelope = deviceEnvelopeOf(snapshot, id);
  if (!deviceEnvelope) {
    throw new DeviceUnlockNotPossible(
      "this device has no envelope in the current revision; it was revoked",
    );
  }

  let mirrored: Parameters<typeof unlockWithDeviceCredential>[0]["mirroredDeviceKeyEnvelope"];
  if (record.mechanism === "prf" && !record.deviceKeyEnvelope) {
    try {
      mirrored = decodeDeviceKeyEnvelope(
        await api.getDeviceKeyEnvelope(vaultId, id, record.credentialId),
      );
    } catch (error) {
      throw new DeviceUnlockNotPossible("no local and no mirrored device-key envelope", {
        cause: error,
      });
    }
  }

  try {
    const result = await unlockWithDeviceCredential({
      client: client(),
      store: store(),
      vaultId,
      deviceId: id,
      deviceEnvelope,
      ...(mirrored ? { mirroredDeviceKeyEnvelope: mirrored } : {}),
    });
    return openSnapshot(snapshot, result.vaultKey, result.mechanism);
  } catch (error) {
    throw new DeviceUnlockNotPossible(
      error instanceof Error ? error.message : "device unlock failed",
      { cause: error },
    );
  }
}

/** Re-seal every entry with a fresh nonce and commit revision N+1. */
export async function commitEntries(
  vault: UnlockedVault,
  entries: VaultEntry[],
): Promise<UnlockedVault> {
  return commitSnapshot(vault, entries, vault.envelopes);
}

async function commitSnapshot(
  vault: UnlockedVault,
  entries: VaultEntry[],
  envelopes: KeyEnvelope[],
): Promise<UnlockedVault> {
  const sealed = entries.map((entry) => {
    const plaintext = encodeEntryPlaintext(entry);
    try {
      return encodeEncryptedEntry(
        encryptEntry({
          vaultKey: vault.vaultKey,
          vaultId: vault.vaultId,
          entryId: entry.id,
          plaintext,
          schemaVersion: ENTRY_SCHEMA_VERSION,
        }),
      );
    } finally {
      zeroize(plaintext);
    }
  });

  try {
    const committed = decodeVaultSnapshot(
      await api.commitSnapshot(vault.vaultId, {
        expectedRevision: vault.revision,
        revision: vault.revision + 1,
        vaultKeyVersion: vault.vaultKeyVersion,
        cryptoProtocolVersion: 1,
        envelopes: envelopes.map(encodeKeyEnvelope),
        entries: sealed,
      }),
    );
    return openSnapshot(committed, vault.vaultKey, vault.unlockedWith);
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      throw new CommitConflict(error.currentRevision);
    }
    throw error;
  }
}

export interface EnabledDeviceUnlock {
  vault: UnlockedVault;
  mechanism: DeviceUnlockMechanism;
}

/**
 * Add this device as a way in (webauthn-prf.md §2.1). Requires an unlocked
 * vault: the Device Key wraps the Vault Key we already hold.
 */
export async function enableDeviceUnlockForVault(
  vault: UnlockedVault,
  accountEmail: string,
): Promise<EnabledDeviceUnlock> {
  const id = deviceId();
  const description = describeDevice();
  await api.registerDevice(vault.vaultId, {
    deviceId: id,
    label: description.label,
    platform: description.platform,
    userAgentSummary: description.userAgentSummary,
  });

  const result = await enableDeviceUnlock({
    client: client(),
    store: store(),
    vaultKey: vault.vaultKey,
    vaultId: vault.vaultId,
    deviceId: id,
    rpId: rpId(),
    user: {
      id: new TextEncoder().encode(accountEmail),
      name: accountEmail,
      displayName: accountEmail,
    },
  });

  const credentialIdBase64 = bytesToBase64(result.credentialId);
  await api.registerCredential(vault.vaultId, id, {
    credentialId: credentialIdBase64,
    rpId: rpId(),
    mechanism: result.mechanism,
    prfSupported: result.mechanism === "prf",
    largeBlobSupported: result.mechanism === "large_blob",
  });

  if (result.mirrorableDeviceKeyEnvelope) {
    await api.putDeviceKeyEnvelope(
      vault.vaultId,
      id,
      credentialIdBase64,
      encodeDeviceKeyEnvelope(result.mirrorableDeviceKeyEnvelope),
    );
  }

  const envelopes = [
    ...vault.envelopes.filter(
      (envelope) => !(envelope.type === "device" && envelope.deviceId === id),
    ),
    result.deviceEnvelope,
  ];
  const updated = await commitSnapshot(vault, vault.entries, envelopes);
  return { vault: updated, mechanism: result.mechanism };
}

/**
 * Soft revocation (crypto-protocol.md §7): drop the device envelope in the next
 * revision. A device that already knows this Vault Key still knows it, so a
 * suspected compromise needs a hard rotation instead.
 */
export async function revokeDevice(
  vault: UnlockedVault,
  targetDeviceId: string,
): Promise<UnlockedVault> {
  await api.revokeDevice(vault.vaultId, targetDeviceId);
  const envelopes = vault.envelopes.filter(
    (envelope) => !(envelope.type === "device" && envelope.deviceId === targetDeviceId),
  );
  return commitSnapshot(vault, vault.entries, envelopes);
}

export function lock(vault: UnlockedVault | null): void {
  if (!vault) return;
  zeroize(vault.vaultKey);
  for (const entry of vault.entries) {
    entry.password = "";
    entry.notes = "";
  }
}
