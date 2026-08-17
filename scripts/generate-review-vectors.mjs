import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bytesToHex, deriveManifestKey, deriveRecoveryWrappingKey, formatRecoveryKey, hexToBytes } from "../packages/crypto/src/index.ts";
import {
  encryptEntryWithNonce,
  sealManifestWithNonce,
  wrapDeviceKeyWithNonce,
  wrapRecoveryEnvelopeWithNonce,
  wrapVaultKeyWithNonce,
} from "../packages/crypto/src/test-only.ts";
import { deviceKeyAad } from "../packages/crypto/src/encoding/aad.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vectors = join(root, "docs", "test-vectors");

const vaultId = "vault_01HZX4ALLPASS000000000001";
const entryId = "entry_01HZX4ALLPASS0000000000A1";
const deviceId = "dev_macbook_chrome_profile_1";
const vaultKey = hexToBytes("00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff");
const masterKey = hexToBytes("0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0");
const recoveryKey = hexToBytes("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
const deviceKey = hexToBytes("cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc");
const credentialId = hexToBytes("cafebabecafebabecafebabecafebabe");
const dwk = hexToBytes("01b7fb49d6f146ecb0bfed501bd6d64c349fa87ae9a257ad7da6209c7be4a5aa");

const dke = wrapDeviceKeyWithNonce({
  deviceKey,
  deviceWrappingKey: dwk,
  vaultId,
  deviceId,
  credentialId,
  deviceKeyVersion: 1,
  nonce: hexToBytes("0102030405060708090a0b0c"),
});
const dkeAad = deviceKeyAad(vaultId, deviceId, credentialId, 1, 1);

const envelope = wrapVaultKeyWithNonce({
  vaultKey,
  wrappingKey: masterKey,
  vaultId,
  type: "master",
  kdf: {
    algorithm: "argon2id",
    version: 0x13,
    memory: 32,
    iterations: 3,
    parallelism: 4,
    hashLen: 32,
    salt: hexToBytes("00112233445566778899aabbccddeeff"),
  },
  allowTestProfile: true,
  nonce: hexToBytes("0102030405060708090a0b0c"),
});
const entry = encryptEntryWithNonce({
  vaultKey,
  vaultId,
  entryId,
  plaintext: new TextEncoder().encode('{"title":"Example"}'),
  nonce: hexToBytes("111111111111111111111111"),
});
const sealed = sealManifestWithNonce({
  vaultKey,
  vaultId,
  revision: 7,
  vaultKeyVersion: 2,
  envelopes: [envelope],
  entries: [entry],
  nonce: hexToBytes("222222222222222222222222"),
});
const manifestKey = deriveManifestKey(vaultKey, vaultId, 7, 2);

const rwk = deriveRecoveryWrappingKey({ recoveryKey, vaultId });
const recoveryEnv = wrapRecoveryEnvelopeWithNonce({
  vaultKey,
  recoveryKey,
  vaultId,
  nonce: hexToBytes("deadbeefdeadbeefdeadbeef"),
});

writeFileSync(
  join(vectors, "manifest-v1.json"),
  `${JSON.stringify(
    {
      protocol: "4AllPass Crypto Protocol v1",
      primitive: "Authenticated vault manifest (HKDF-SHA-256 + AES-256-GCM)",
      generated: "2026-08-17T22:30:00Z",
      constants: {
        vault_id: vaultId,
        entry_id: entryId,
        vault_key: bytesToHex(vaultKey),
        master_key: bytesToHex(masterKey),
        revision: 7,
        vault_key_version: 2,
      },
      success: [
        {
          id: "TV-MANIFEST-KEY",
          purpose: "HKDF snapshot key from VK, bound to vault + revision + vaultKeyVersion",
          manifest_key: bytesToHex(manifestKey),
        },
        {
          id: "TV-MANIFEST-01",
          purpose: "Seal a one-envelope / one-entry snapshot",
          nonce: "222222222222222222222222",
          ciphertext: bytesToHex(sealed.ciphertext),
          tag: bytesToHex(sealed.tag),
        },
      ],
    },
    null,
    2,
  )}\n`,
);

writeFileSync(
  join(vectors, "recovery-v1.json"),
  `${JSON.stringify(
    {
      protocol: "4AllPass Crypto Protocol v1",
      primitive: "Recovery key encoding + HKDF wrapping key + recovery envelope",
      generated: "2026-08-17T22:30:00Z",
      constants: {
        vault_id: vaultId,
        recovery_key: bytesToHex(recoveryKey),
        vault_key: bytesToHex(vaultKey),
      },
      success: [
        {
          id: "TV-RECOVERY-ENCODE",
          purpose: "Emergency Kit encoding with SHA-256 checksum",
          encoded: formatRecoveryKey(recoveryKey),
        },
        {
          id: "TV-RECOVERY-RWK",
          purpose: "HKDF recovery wrapping key; raw RK is never the AES key",
          recovery_wrapping_key: bytesToHex(rwk),
        },
        {
          id: "TV-RECOVERY-WRAP",
          purpose: "Wrap VK under RWK + recovery envelope AAD",
          nonce: "deadbeefdeadbeefdeadbeef",
          ciphertext: bytesToHex(recoveryEnv.ciphertext),
          tag: bytesToHex(recoveryEnv.tag),
        },
      ],
    },
    null,
    2,
  )}\n`,
);

console.log("device-key AAD", bytesToHex(dkeAad));
console.log("device-key CT", bytesToHex(dke.ciphertext));
console.log("device-key tag", bytesToHex(dke.tag));
console.log("wrote manifest-v1.json and recovery-v1.json");
