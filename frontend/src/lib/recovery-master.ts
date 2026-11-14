import {
  deriveMasterKey, deriveRecoveryWrappingKey, equalBytes, generateSalt,
  IntegrityError, kdfParamsFrom, parseRecoveryKey, unwrapVaultKey, wrapVaultKey, zeroize,
  type KeyEnvelope,
} from "@4allpass/crypto";
import type { VaultLiveness } from "./vault-liveness.ts";
import type { UnlockedVault } from "./vault-session.ts";
import { assertMasterPassword } from "./master-password.ts";

type Commit = (envelopes: KeyEnvelope[], vaultKey: Uint8Array, masterKey: Uint8Array) => Promise<UnlockedVault>;

/** Recovery proof, not the account session or a caller's unlockedWith tag, authorizes this write. */
export async function replaceMasterAfterRecovery(
  vault: UnlockedVault,
  options: { newMasterPassword: string; recoveryKeyText: string; deferPin?: boolean; liveness?: VaultLiveness },
  commit: Commit,
): Promise<UnlockedVault> {
  options.liveness?.assertLive();
  if (vault.unlockedWith !== "recovery_key") throw new IntegrityError("recovery unlock required");
  // Same floor as the Create form: the library boundary rejects empty/short
  // master passwords even when a direct caller skips the UI.
  assertMasterPassword(options.newMasterPassword);
  const recovery = vault.envelopes.find((env) => env.type === "recovery");
  const master = vault.envelopes.find((env) => env.type === "master");
  if (!recovery || !master?.kdf) throw new IntegrityError("recovery or master envelope missing");
  const kit = parseRecoveryKey(options.recoveryKeyText);
  let rwk: Uint8Array | null = null;
  let opened: Uint8Array | null = null;
  let masterKey: Uint8Array | null = null;
  let nextKey: Uint8Array | null = null;
  let transferred = false;
  try {
    rwk = deriveRecoveryWrappingKey({ recoveryKey: kit, vaultId: vault.vaultId });
    opened = unwrapVaultKey(recovery, {
      wrappingKey: rwk, vaultId: vault.vaultId, expectType: "recovery",
      expectVaultKeyVersion: vault.vaultKeyVersion,
    });
    if (!equalBytes(opened, vault.vaultKey)) throw new IntegrityError("recovery key does not match current vault");
    const { salt: _oldSalt, ...params } = master.kdf;
    const salt = generateSalt(16);
    masterKey = deriveMasterKey(options.newMasterPassword, salt, params);
    // Same VK bytes/version, separate buffer ownership. A stale caller can
    // dispose the result without wiping a different live vault object's key.
    nextKey = new Uint8Array(vault.vaultKey);
    const envelope = wrapVaultKey({
      vaultKey: nextKey, wrappingKey: masterKey, vaultId: vault.vaultId,
      type: "master", vaultKeyVersion: vault.vaultKeyVersion,
      kdf: kdfParamsFrom(params, salt),
    });
    const envelopes = vault.envelopes.map((env) => env.type === "master" ? envelope : env);
    options.liveness?.assertLive();
    const updated = await commit(envelopes, nextKey, masterKey);
    transferred = true;
    zeroize(vault.vaultKey);
    return updated;
  } finally {
    zeroize(kit);
    if (rwk) zeroize(rwk);
    if (opened) zeroize(opened);
    if (masterKey) zeroize(masterKey);
    if (nextKey && !transferred) zeroize(nextKey);
  }
}
