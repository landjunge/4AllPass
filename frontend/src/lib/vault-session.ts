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
  buildManifest,
  bytesToBase64,
  decodeDeviceKeyEnvelope,
  decodeVaultSnapshot,
  deriveMasterKey,
  deriveMasterKeyFromEnvelope,
  deriveRecoveryWrappingKey,
  encodeEncryptedEntry,
  encodeKeyEnvelope,
  encodeDeviceKeyEnvelope,
  encodeSealedManifest,
  encryptEntry,
  formatRecoveryKey,
  generateRecoveryKey,
  generateSalt,
  generateVaultKey,
  kdfParamsFrom,
  parseRecoveryKey,
  revisionFromManifest,
  sealManifest,
  sealedManifestDigest,
  unwrapVaultKey,
  verifySnapshot,
  verifySnapshotManifest,
  wrapVaultKey,
  zeroize,
} from "@4allpass/crypto";
import type {
  Argon2idProfileName,
  CrossCheckEnvelope,
  EncryptedEntry,
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

/** Generations are 1-based; this client does not rotate keys yet. */
const INITIAL_VAULT_KEY_VERSION = 1;
const INITIAL_DEVICE_KEY_VERSION = 1;

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
    ...(snapshot.sealedManifest
      ? { manifestDigest: sealedManifestDigest(snapshot.sealedManifest) }
      : {}),
  });
  return snapshot;
}

function sealSnapshotManifest(
  vaultId: string,
  revision: number,
  vaultKeyVersion: number,
  vaultKey: Uint8Array,
  envelopes: readonly KeyEnvelope[],
  entries: readonly EncryptedEntry[],
) {
  return sealManifest({
    vaultKey,
    manifest: buildManifest({
      vaultId,
      revision,
      vaultKeyVersion,
      envelopes,
      entries,
    }),
  });
}

function openSnapshot(
  snapshot: VaultSnapshot,
  vaultKey: Uint8Array,
  unlockedWith: UnlockMethod,
  crossChecks: readonly CrossCheckEnvelope[] = [],
): UnlockedVault {
  // verifySnapshot returns the plaintext it already had to produce to prove the
  // snapshot is not mixed; decrypting a second time would only widen the window
  // in which entry plaintext exists.
  if (snapshot.sealedManifest) {
    const verified = verifySnapshotManifest(
      snapshot.sealedManifest,
      { entries: snapshot.entries, envelopes: snapshot.envelopes },
      {
        vaultKey,
        vaultId: snapshot.vaultId,
        revision: snapshot.revision,
        vaultKeyVersion: snapshot.vaultKeyVersion,
      },
    );
    savePin(revisionFromManifest(verified));
  } else {
    savePin({
      vaultId: snapshot.vaultId,
      revision: snapshot.revision,
      vaultKeyVersion: snapshot.vaultKeyVersion,
      cryptoProtocolVersion: 1,
    });
  }
  const entries: VaultEntry[] = verifySnapshot({
    vaultId: snapshot.vaultId,
    vaultKey,
    vaultKeyVersion: snapshot.vaultKeyVersion,
    entries: snapshot.entries,
    crossCheckEnvelopes: crossChecks,
  }).map((entry) => {
    try {
      return decodeEntryPlaintext(entry.id, entry.plaintext);
    } finally {
      zeroize(entry.plaintext);
    }
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
  const recoveryWrappingKey = deriveRecoveryWrappingKey({ recoveryKey, vaultId });
  try {
    const masterEnvelope = wrapVaultKey({
      vaultKey,
      wrappingKey: masterKey,
      vaultId,
      type: "master",
      vaultKeyVersion: INITIAL_VAULT_KEY_VERSION,
      kdf: kdfParamsFrom(profile, salt),
    });
    const recoveryEnvelope = wrapVaultKey({
      vaultKey,
      wrappingKey: recoveryWrappingKey,
      vaultId,
      type: "recovery",
      vaultKeyVersion: INITIAL_VAULT_KEY_VERSION,
    });
    const envelopes = [masterEnvelope, recoveryEnvelope];
    const sealedManifest = sealSnapshotManifest(
      vaultId,
      1,
      INITIAL_VAULT_KEY_VERSION,
      vaultKey,
      envelopes,
      [],
    );
    const committed = decodeVaultSnapshot(
      await api.commitSnapshot(vaultId, {
        revision: 1,
        vaultKeyVersion: INITIAL_VAULT_KEY_VERSION,
        cryptoProtocolVersion: 1,
        envelopes: envelopes.map(encodeKeyEnvelope),
        entries: [],
        sealedManifest: encodeSealedManifest(sealedManifest),
      }),
    );
    const vault = openSnapshot(committed, vaultKey, "master_password", [
      { envelope: masterEnvelopeOf(committed), wrappingKey: masterKey },
    ]);
    return { vault, recoveryKey: formatRecoveryKey(recoveryKey) };
  } finally {
    zeroize(masterKey, recoveryKey, recoveryWrappingKey);
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
    const vaultKey = unwrapVaultKey(masterEnvelope, {
      wrappingKey: masterKey,
      vaultId,
      expectType: "master",
      expectVaultKeyVersion: snapshot.vaultKeyVersion,
    });
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
  const wrappingKey = deriveRecoveryWrappingKey({ recoveryKey, vaultId });
  try {
    const vaultKey = unwrapVaultKey(envelope, {
      wrappingKey,
      vaultId,
      expectType: "recovery",
      expectVaultKeyVersion: snapshot.vaultKeyVersion,
    });
    return openSnapshot(snapshot, vaultKey, "recovery_key", [{ envelope, wrappingKey }]);
  } finally {
    zeroize(recoveryKey, wrappingKey);
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
      vaultKeyVersion: snapshot.vaultKeyVersion,
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
  const encrypted = entries.map((entry) => {
    const plaintext = encodeEntryPlaintext(entry);
    try {
      return encryptEntry({
        vaultKey: vault.vaultKey,
        vaultId: vault.vaultId,
        entryId: entry.id,
        plaintext,
        vaultKeyVersion: vault.vaultKeyVersion,
        schemaVersion: ENTRY_SCHEMA_VERSION,
      });
    } finally {
      zeroize(plaintext);
    }
  });
  const nextRevision = vault.revision + 1;
  const sealedManifest = sealSnapshotManifest(
    vault.vaultId,
    nextRevision,
    vault.vaultKeyVersion,
    vault.vaultKey,
    envelopes,
    encrypted,
  );

  try {
    const committed = decodeVaultSnapshot(
      await api.commitSnapshot(vault.vaultId, {
        expectedRevision: vault.revision,
        revision: nextRevision,
        vaultKeyVersion: vault.vaultKeyVersion,
        cryptoProtocolVersion: 1,
        envelopes: envelopes.map(encodeKeyEnvelope),
        entries: encrypted.map(encodeEncryptedEntry),
        sealedManifest: encodeSealedManifest(sealedManifest),
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
    vaultKeyVersion: vault.vaultKeyVersion,
    deviceKeyVersion: INITIAL_DEVICE_KEY_VERSION,
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

  const envelopes = [
    ...vault.envelopes.filter(
      (envelope) => !(envelope.type === "device" && envelope.deviceId === id),
    ),
    result.deviceEnvelope,
  ];
  const updated = await commitSnapshot(vault, vault.entries, envelopes);

  if (result.mirrorableDeviceKeyEnvelope) {
    await api.putDeviceKeyEnvelope(
      vault.vaultId,
      id,
      credentialIdBase64,
      encodeDeviceKeyEnvelope(result.mirrorableDeviceKeyEnvelope),
      updated.revision,
    );
  }

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
