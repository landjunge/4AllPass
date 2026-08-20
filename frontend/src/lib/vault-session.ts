/**
 * The unlock / commit engine of the web client.
 *
 * Rules this file exists to keep:
 * - The Vault Key is random and only ever appears here after a successful
 *   unwrap. The master password and the derived Master Key are zeroized as soon
 *   as the envelope is open.
 * - Every snapshot is checked for freshness against the local pin *and* for
 *   internal consistency before anything is decrypted into the UI.
 * - The last verified wire snapshot is cached on-device. Offline unlock uses
 *   that cache; the pin still refuses rollbacks. Never cache plaintext.
 * - WebAuthn only ever produces a Device Wrapping Key; the Vault Key path is
 *   DWK → Device Key → Vault Key.
 * - Master-password unlock is never disabled by anything here.
 */
import {
  ARGON2ID_PROFILES,
  assertFreshSnapshot,
  base64ToBytes,
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
  encodeVaultSnapshot,
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
  unwrapDeviceKey,
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
import type {
  CeremonyArtifact,
  ChallengeProvider,
  DeviceUnlockMechanism,
  DeviceUnlockStore,
} from "@4allpass/webauthn";
import { api, ApiError } from "./api.ts";
import { describeDevice, deviceId, rpId } from "./device-identity.ts";
import {
  decodeEntryPlaintext,
  encodeEntryPlaintext,
  ENTRY_SCHEMA_VERSION,
  type VaultEntry,
} from "./entries.ts";
import { loadPin, savePin } from "./revision-pin.ts";
import { isOfflineError, snapshotCache } from "./snapshot-cache.ts";

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

/** Test-only override so unit tests can seed a local DK without IndexedDB. */
let deviceUnlockStoreOverride: DeviceUnlockStore | null = null;

const store = () => deviceUnlockStoreOverride ?? indexedDbDeviceUnlockStore();
const client = () => browserWebAuthnClient();

/** @internal */
export function setDeviceUnlockStoreForTests(next: DeviceUnlockStore | null): void {
  deviceUnlockStoreOverride = next;
}

function arrayBufferToB64(buffer: ArrayBuffer): string {
  return bytesToBase64(new Uint8Array(buffer));
}

/** One server challenge per create/get; consume after the ceremony batch. */
function serverChallenges(vaultId: string, deviceIdValue: string): {
  provider: ChallengeProvider;
  takeCreate: () =>
    | { challengeId: string; challenge: string; artifact: CeremonyArtifact | undefined }
    | undefined;
  consumeAll: () => Promise<void>;
} {
  const issued: Array<{
    challengeId: string;
    challenge: string;
    purpose: "create" | "assert";
    artifact?: CeremonyArtifact;
  }> = [];
  return {
    provider: {
      async next(purpose) {
        const row = await api.issueWebAuthnChallenge(vaultId, { purpose, deviceId: deviceIdValue });
        issued.push({ challengeId: row.challengeId, challenge: row.challenge, purpose: row.purpose });
        return base64ToBytes(row.challenge);
      },
      report(artifact) {
        const row = [...issued].reverse().find((item) => item.purpose === artifact.purpose && !item.artifact);
        if (row) row.artifact = artifact;
      },
    },
    takeCreate() {
      const index = issued.findIndex((row) => row.purpose === "create");
      if (index < 0) return undefined;
      const [row] = issued.splice(index, 1);
      if (!row) return undefined;
      return { challengeId: row.challengeId, challenge: row.challenge, artifact: row.artifact };
    },
    async consumeAll() {
      const pending = issued.splice(0);
      await Promise.all(
        pending.map((row) => {
          const artifact = row.artifact;
          return api
            .consumeWebAuthnChallenge(vaultId, row.challengeId, {
              purpose: row.purpose,
              challenge: row.challenge,
              ...(row.purpose === "assert" &&
              artifact?.signature &&
              artifact.signature.byteLength > 0 &&
              artifact.authenticatorData
                ? {
                    credentialId: bytesToBase64(artifact.credentialId),
                    clientDataJSON: arrayBufferToB64(artifact.clientDataJSON),
                    authenticatorData: arrayBufferToB64(artifact.authenticatorData),
                    signature: arrayBufferToB64(artifact.signature),
                  }
                : {}),
            })
            .catch(() => undefined);
        }),
      );
    },
  };
}

/** Generations are 1-based. Soft commits keep the version; hard revoke bumps it. */
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
  let raw;
  try {
    raw = await api.getSnapshot(vaultId);
  } catch (error) {
    if (!isOfflineError(error)) throw error;
    const cached = await snapshotCache().load(vaultId);
    if (!cached) throw error;
    raw = cached;
  }
  const snapshot = decodeVaultSnapshot(raw);
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

async function acceptSnapshot(
  snapshot: VaultSnapshot,
  vaultKey: Uint8Array,
  unlockedWith: UnlockMethod,
  crossChecks: readonly CrossCheckEnvelope[] = [],
): Promise<UnlockedVault> {
  const vault = openSnapshot(snapshot, vaultKey, unlockedWith, crossChecks);
  try {
    await snapshotCache().save(snapshot.vaultId, encodeVaultSnapshot(snapshot));
  } catch {
    // Cache is best-effort. Unlock already succeeded.
  }
  return vault;
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
    const vault = await acceptSnapshot(committed, vaultKey, "master_password", [
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
    return acceptSnapshot(snapshot, vaultKey, "master_password", [
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
    return acceptSnapshot(snapshot, vaultKey, "recovery_key", [{ envelope, wrappingKey }]);
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
    const challenges = serverChallenges(vaultId, id);
    try {
      const result = await unlockWithDeviceCredential({
        client: client(),
        store: store(),
        vaultId,
        deviceId: id,
        vaultKeyVersion: snapshot.vaultKeyVersion,
        deviceEnvelope,
        challenges: challenges.provider,
        ...(mirrored ? { mirroredDeviceKeyEnvelope: mirrored } : {}),
      });
      return acceptSnapshot(snapshot, result.vaultKey, result.mechanism);
    } finally {
      await challenges.consumeAll();
    }
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
  options?: {
    vaultKeyVersion?: number;
    vaultKey?: Uint8Array;
  },
): Promise<UnlockedVault> {
  const vaultKey = options?.vaultKey ?? vault.vaultKey;
  const vaultKeyVersion = options?.vaultKeyVersion ?? vault.vaultKeyVersion;
  const encrypted = entries.map((entry) => {
    const plaintext = encodeEntryPlaintext(entry);
    try {
      return encryptEntry({
        vaultKey,
        vaultId: vault.vaultId,
        entryId: entry.id,
        plaintext,
        vaultKeyVersion,
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
    vaultKeyVersion,
    vaultKey,
    envelopes,
    encrypted,
  );

  try {
    const committed = decodeVaultSnapshot(
      await api.commitSnapshot(vault.vaultId, {
        expectedRevision: vault.revision,
        revision: nextRevision,
        vaultKeyVersion,
        cryptoProtocolVersion: 1,
        envelopes: envelopes.map(encodeKeyEnvelope),
        entries: encrypted.map(encodeEncryptedEntry),
        sealedManifest: encodeSealedManifest(sealedManifest),
      }),
    );
    return acceptSnapshot(committed, vaultKey, vault.unlockedWith);
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      throw new CommitConflict(error.currentRevision);
    }
    throw error;
  }
}

/**
 * Recover this device's Device Key only when it is already on disk — no
 * WebAuthn ceremony. That means a local wrapping key plus a stored device-key
 * envelope (typically `uv_gated_local`). PRF / largeBlob need an authenticator
 * `get` and are skipped; the caller omits the device envelope and re-enrols.
 */
async function tryLocalDeviceKey(
  vaultId: string,
  currentDeviceId: string,
): Promise<{ deviceKey: Uint8Array; deviceKeyVersion: number } | null> {
  let record;
  try {
    record = await store().load(vaultId, currentDeviceId);
  } catch {
    return null;
  }
  if (!record?.wrappingKey || !record.deviceKeyEnvelope) return null;
  const wrappingKey = base64ToBytes(record.wrappingKey);
  try {
    const deviceKeyEnvelope = decodeDeviceKeyEnvelope(record.deviceKeyEnvelope);
    const deviceKey = unwrapDeviceKey(deviceKeyEnvelope, {
      deviceWrappingKey: wrappingKey,
      vaultId,
      deviceId: currentDeviceId,
      credentialId: base64ToBytes(record.credentialId),
      deviceKeyVersion: record.deviceKeyVersion,
    });
    return { deviceKey, deviceKeyVersion: record.deviceKeyVersion };
  } catch {
    return null;
  } finally {
    zeroize(wrappingKey);
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

  const challenges = serverChallenges(vault.vaultId, id);
  try {
    const result = await enableDeviceUnlock({
      client: client(),
      store: store(),
      vaultKey: vault.vaultKey,
      vaultId: vault.vaultId,
      deviceId: id,
      vaultKeyVersion: vault.vaultKeyVersion,
      deviceKeyVersion: INITIAL_DEVICE_KEY_VERSION,
      rpId: rpId(),
      challenges: challenges.provider,
      user: {
        id: new TextEncoder().encode(accountEmail),
        name: accountEmail,
        displayName: accountEmail,
      },
    });

    const credentialIdBase64 = bytesToBase64(result.credentialId);
    const create = challenges.takeCreate();
    const attestation = create?.artifact;
    await api.registerCredential(vault.vaultId, id, {
      credentialId: credentialIdBase64,
      rpId: rpId(),
      mechanism: result.mechanism,
      prfSupported: result.mechanism === "prf",
      largeBlobSupported: result.mechanism === "large_blob",
      ...(create &&
      attestation?.attestationObject &&
      attestation.attestationObject.byteLength > 0
        ? {
            challengeId: create.challengeId,
            challenge: create.challenge,
            clientDataJSON: arrayBufferToB64(attestation.clientDataJSON),
            attestationObject: arrayBufferToB64(attestation.attestationObject),
          }
        : {}),
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
  } finally {
    await challenges.consumeAll();
  }
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

/**
 * Hard revocation: rotate the Vault Key so a device that already held VK₁
 * cannot decrypt the next snapshot. Soft DELETE is metadata only; this is the
 * cryptographic step (docs/security-boundary.md §4, vault-revision.md §5).
 *
 * Device envelopes are included only when this client already has a device
 * envelope in the current snapshot *and* can wrap without a new WebAuthn
 * ceremony (local DK). Otherwise the snapshot has master (+ recovery) only and
 * every device re-enrols after master unlock. Leftover IndexedDB after a soft
 * revoke does not re-attach this device.
 *
 * Order is mandatory: CAS commit under VK₂ succeeds before metadata DELETE.
 * On 409, DELETE is not called.
 */
export async function hardRevokeDevice(
  vault: UnlockedVault,
  options: {
    targetDeviceId: string;
    masterPassword: string;
    recoveryKeyText?: string;
  },
): Promise<UnlockedVault> {
  const { targetDeviceId, masterPassword, recoveryKeyText } = options;
  const masterEnvelope = vault.envelopes.find((candidate) => candidate.type === "master");
  if (!masterEnvelope) throw new Error("snapshot has no master envelope");
  if (!masterEnvelope.kdf) throw new Error("master envelope is missing kdf parameters");

  const masterKey = deriveMasterKeyFromEnvelope(masterPassword, masterEnvelope);
  try {
    const verified = unwrapVaultKey(masterEnvelope, {
      wrappingKey: masterKey,
      vaultId: vault.vaultId,
      expectType: "master",
      expectVaultKeyVersion: vault.vaultKeyVersion,
    });
    // Confirms the password opens the same VK we hold unlocked.
    if (
      verified.length !== vault.vaultKey.length ||
      !verified.every((b, i) => b === vault.vaultKey[i])
    ) {
      zeroize(verified);
      throw new Error("master password does not match the unlocked vault key");
    }
    zeroize(verified);
  } catch (error) {
    zeroize(masterKey);
    throw error;
  }

  const recoveryEnvelope = vault.envelopes.find((candidate) => candidate.type === "recovery");
  let recoveryKey: Uint8Array | null = null;
  let recoveryWrappingKey: Uint8Array | null = null;
  if (recoveryEnvelope) {
    if (!recoveryKeyText) {
      zeroize(masterKey);
      throw new Error("recovery key is required because this vault has a recovery envelope");
    }
    recoveryKey = parseRecoveryKey(recoveryKeyText);
    recoveryWrappingKey = deriveRecoveryWrappingKey({
      recoveryKey,
      vaultId: vault.vaultId,
    });
    try {
      const opened = unwrapVaultKey(recoveryEnvelope, {
        wrappingKey: recoveryWrappingKey,
        vaultId: vault.vaultId,
        expectType: "recovery",
        expectVaultKeyVersion: vault.vaultKeyVersion,
      });
      zeroize(opened);
    } catch (error) {
      zeroize(masterKey, recoveryKey, recoveryWrappingKey);
      throw error;
    }
  }

  const nextVaultKeyVersion = vault.vaultKeyVersion + 1;
  const vaultKey2 = generateVaultKey();
  const { salt: _oldSalt, ...kdfParams } = masterEnvelope.kdf;
  const salt2 = generateSalt(16);
  const masterKey2 = deriveMasterKey(masterPassword, salt2, kdfParams);

  const currentId = deviceId();
  let localDevice: { deviceKey: Uint8Array; deviceKeyVersion: number } | null = null;
  // Only continue an existing device enrolment. Leftover IndexedDB after a soft
  // revoke must not re-attach this device (would 422 if revoked_at is set).
  const selfEntitled = vault.envelopes.some(
    (envelope) => envelope.type === "device" && envelope.deviceId === currentId,
  );
  if (targetDeviceId !== currentId && selfEntitled) {
    localDevice = await tryLocalDeviceKey(vault.vaultId, currentId);
  }

  let transferredVaultKey = false;
  try {
    const envelopes: KeyEnvelope[] = [
      wrapVaultKey({
        vaultKey: vaultKey2,
        wrappingKey: masterKey2,
        vaultId: vault.vaultId,
        type: "master",
        vaultKeyVersion: nextVaultKeyVersion,
        kdf: kdfParamsFrom(kdfParams, salt2),
      }),
    ];
    if (recoveryWrappingKey) {
      envelopes.push(
        wrapVaultKey({
          vaultKey: vaultKey2,
          wrappingKey: recoveryWrappingKey,
          vaultId: vault.vaultId,
          type: "recovery",
          vaultKeyVersion: nextVaultKeyVersion,
        }),
      );
    }
    if (localDevice) {
      envelopes.push(
        wrapVaultKey({
          vaultKey: vaultKey2,
          wrappingKey: localDevice.deviceKey,
          vaultId: vault.vaultId,
          type: "device",
          vaultKeyVersion: nextVaultKeyVersion,
          deviceId: currentId,
          deviceKeyVersion: localDevice.deviceKeyVersion,
        }),
      );
    }

    const previousKey = vault.vaultKey;
    // CAS under VK₂. On 409 CommitConflict propagates — DELETE must not run.
    const updated = await commitSnapshot(vault, vault.entries, envelopes, {
      vaultKey: vaultKey2,
      vaultKeyVersion: nextVaultKeyVersion,
    });
    transferredVaultKey = true;

    await api.revokeDevice(vault.vaultId, targetDeviceId);
    zeroize(previousKey);

    if (targetDeviceId === currentId) {
      try {
        await store().remove(vault.vaultId, currentId);
      } catch {
        // Best-effort local clear; server metadata is already revoked.
      }
      lock(updated);
    }
    return updated;
  } finally {
    zeroize(masterKey, masterKey2);
    if (!transferredVaultKey) zeroize(vaultKey2);
    if (recoveryKey) zeroize(recoveryKey);
    if (recoveryWrappingKey) zeroize(recoveryWrappingKey);
    if (localDevice) zeroize(localDevice.deviceKey);
  }
}

export function lock(vault: UnlockedVault | null): void {
  if (!vault) return;
  zeroize(vault.vaultKey);
  for (const entry of vault.entries) {
    entry.password = "";
    entry.notes = "";
  }
}
