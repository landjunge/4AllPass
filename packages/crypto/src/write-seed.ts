import { getPublicKeyAsync } from "@noble/ed25519";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { KEY_BYTES } from "./constants.ts";
import { writeSeedHkdfInfo, writeSeedHkdfSalt } from "./encoding/aad.ts";
import { assertBytes, assertId, assertVersion } from "./validate.ts";

/**
 * Write-signing seed = HKDF-SHA-256(IKM = Vault Key, salt, info, L = 32).
 *
 * ADR-015 step 3: one Ed25519 keypair per vault-key generation, reproducible by
 * anyone who can open the vault, so nothing extra needs storing or recovering.
 * Binding `vaultKeyVersion` into the info makes a rotation derive a fresh seed
 * deterministically. The server only ever sees the public key and cannot verify
 * this derivation; it is a client invariant (SIGNED-WRITE-CONTRACT-v2 §3).
 */
export function deriveWriteSeed(
  vaultKey: Uint8Array,
  vaultId: string,
  vaultKeyVersion: number,
): Uint8Array {
  const vk = assertBytes("vaultKey", vaultKey, { exact: KEY_BYTES });
  const id = assertId("vaultId", vaultId);
  const version = assertVersion("vaultKeyVersion", vaultKeyVersion);
  const salt = sha256(writeSeedHkdfSalt(id));
  const info = writeSeedHkdfInfo(id, version);
  return hkdf(sha256, vk, salt, info, KEY_BYTES);
}

/** Derive the raw Ed25519 public key for a write seed, for WebCrypto runtimes. */
export async function deriveWritePublicKey(seed: Uint8Array): Promise<Uint8Array> {
  const checked = assertBytes("writeSeed", seed, { exact: KEY_BYTES });
  return getPublicKeyAsync(checked);
}
