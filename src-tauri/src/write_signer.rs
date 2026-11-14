//! Narrow Ed25519 signing command for v2 vault writes.
//!
//! The seed is derived in the trusted app session (HKDF(VK), ADR-015) and
//! passed only to this command in the own main window. It is never persisted,
//! logged, exported or accepted from a remote origin.
//!
//! The command is not a bulk signer: it only signs a canonical v2 WriteRequest
//! preimage (SIGNED-WRITE-CONTRACT-v2 §1 + V3-ERRATUM-2 draft layout rev2,
//! `packages/crypto/src/requester.ts` `writeRequestBytesV2`). The framed
//! structure, the domain label and every field constraint are validated here
//! before signing, so a compromised renderer cannot mint a signature over
//! arbitrary bytes under the vault write key. The public key is derived
//! natively from the same seed; it never depends on the webview's broken
//! PKCS#8 import path.

use ed25519_dalek::{Signer as _, SigningKey};
use serde::Serialize;
use zeroize::Zeroizing;

pub const WRITE_SEED_BYTES: usize = 32;
pub const WRITE_SIGNATURE_BYTES: usize = 64;
pub const WRITE_PUBLIC_KEY_BYTES: usize = 32;
/// Backstop only; a valid canonical preimage is far smaller.
pub const WRITE_MESSAGE_MAX: usize = 64 * 1024;

const WRITE_V2_LABEL: &[u8] = b"4allpass-vault-write-v2";
const FIELD_COUNT: usize = 20;
const ID_CHARS_MAX: usize = 128;
const ROUTE_BYTES_MAX: usize = 512;
const DIGEST_BYTES: usize = 32;
const NONCE_BYTES: usize = 16;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteSignature {
    pub public_key: Vec<u8>,
    pub signature: Vec<u8>,
}

#[tauri::command]
pub fn sign_ed25519_v2(seed: Vec<u8>, message: Vec<u8>) -> Result<WriteSignature, String> {
    // Zeroize before any validation so every error path drops the seed safely.
    let seed = Zeroizing::new(seed);
    if seed.len() != WRITE_SEED_BYTES {
        return Err("write_seed_invalid".to_string());
    }
    if message.is_empty() || message.len() > WRITE_MESSAGE_MAX {
        return Err("write_message_invalid".to_string());
    }
    validate_canonical_write_v2(&message)?;
    let mut key_bytes = Zeroizing::new([0u8; WRITE_SEED_BYTES]);
    key_bytes.copy_from_slice(&seed);
    let key = SigningKey::from_bytes(&key_bytes);
    let public_key = key.verifying_key().to_bytes().to_vec();
    let signature = key.sign(&message).to_bytes().to_vec();
    Ok(WriteSignature { public_key, signature })
}

/// Parse and validate the uint32be-framed canonical preimage. Field order and
/// constraints mirror `validateWriteRequestV2` exactly; the bytes signed are
/// the bytes validated, so client and server cannot drift.
fn validate_canonical_write_v2(message: &[u8]) -> Result<(), String> {
    let fields = parse_frames(message)?;
    if fields.len() != FIELD_COUNT {
        return Err("write_preimage_invalid".to_string());
    }
    if fields[0] != WRITE_V2_LABEL {
        return Err("write_preimage_invalid".to_string());
    }
    check_uuid(fields[1])?; // vaultId
    check_id(fields[2], 1)?; // deviceId
    check_method(fields[3])?;
    check_route(fields[4])?;
    check_resource_type(fields[5])?;
    check_id(fields[6], 0)?; // resourceId
    check_id(fields[7], 0)?; // parentId
    for &i in &[8usize, 9, 10, 11] {
        check_u32(fields[i])?; // base/resultRevision, signing/resultKeyVersion
    }
    let has_manifest = check_presence(fields[12])?;
    check_len(fields[13], if has_manifest { DIGEST_BYTES } else { 0 })?;
    check_len(fields[14], DIGEST_BYTES)?; // payloadDigest
    let has_next = check_presence(fields[15])?;
    check_len(fields[16], if has_next { DIGEST_BYTES } else { 0 })?;
    check_uuid(fields[17])?; // operationId
    check_len(fields[18], NONCE_BYTES)?;
    check_u32(fields[19])?; // timestamp
    Ok(())
}

fn parse_frames(message: &[u8]) -> Result<Vec<&[u8]>, String> {
    let mut fields = Vec::new();
    let mut rest = message;
    while !rest.is_empty() {
        if rest.len() < 4 {
            return Err("write_preimage_invalid".to_string());
        }
        let len = u32::from_be_bytes([rest[0], rest[1], rest[2], rest[3]]) as usize;
        rest = &rest[4..];
        if len > rest.len() {
            return Err("write_preimage_invalid".to_string());
        }
        fields.push(&rest[..len]);
        rest = &rest[len..];
        if fields.len() > FIELD_COUNT {
            return Err("write_preimage_invalid".to_string());
        }
    }
    Ok(fields)
}

fn invalid() -> String {
    "write_preimage_invalid".to_string()
}

fn check_len(field: &[u8], expected: usize) -> Result<(), String> {
    if field.len() == expected { Ok(()) } else { Err(invalid()) }
}

fn check_u32(field: &[u8]) -> Result<(), String> {
    check_len(field, 4)
}

fn check_presence(field: &[u8]) -> Result<bool, String> {
    check_u32(field)?;
    match u32::from_be_bytes([field[0], field[1], field[2], field[3]]) {
        0 => Ok(false),
        1 => Ok(true),
        _ => Err(invalid()),
    }
}

/// Canonical lowercase hyphenated UUID text; no normalization, exactly 36 bytes.
fn check_uuid(field: &[u8]) -> Result<(), String> {
    if field.len() != 36 {
        return Err(invalid());
    }
    for (i, &b) in field.iter().enumerate() {
        let ok = match i {
            8 | 13 | 18 | 23 => b == b'-',
            _ => b.is_ascii_digit() || (b'a'..=b'f').contains(&b),
        };
        if !ok {
            return Err(invalid());
        }
    }
    Ok(())
}

/// Opaque exact UTF-8 id, `min..=128` Unicode scalars. Rust `&str` already
/// excludes unpaired surrogates; no normalization, no URL decoding.
fn check_id(field: &[u8], min: usize) -> Result<(), String> {
    let text = std::str::from_utf8(field).map_err(|_| invalid())?;
    let count = text.chars().count();
    if count < min || count > ID_CHARS_MAX {
        return Err(invalid());
    }
    Ok(())
}

fn check_method(field: &[u8]) -> Result<(), String> {
    if field.is_empty() || field.len() > 16 || !field.iter().all(|b| b.is_ascii_uppercase()) {
        return Err(invalid());
    }
    Ok(())
}

fn check_route(field: &[u8]) -> Result<(), String> {
    if field.is_empty()
        || field.len() > ROUTE_BYTES_MAX
        || !field.starts_with(b"/api/v1/")
        || !field.iter().all(|&b| (0x21..=0x7e).contains(&b))
        || field.contains(&b'?')
        || field.contains(&b'#')
    {
        return Err(invalid());
    }
    Ok(())
}

fn check_resource_type(field: &[u8]) -> Result<(), String> {
    match field {
        b"vault" | b"device" | b"credential" | b"challenge" => Ok(()),
        _ => Err(invalid()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex(value: &str) -> Vec<u8> {
        (0..value.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&value[i..i + 2], 16).unwrap())
            .collect()
    }

    enum Field<'a> {
        Bytes(&'a [u8]),
        U32(u32),
    }

    /// Same uint32be framing as `packages/crypto/src/encoding/framing.ts`.
    fn frame(fields: &[Field<'_>]) -> Vec<u8> {
        let mut out = Vec::new();
        for field in fields {
            let bytes: Vec<u8> = match field {
                Field::Bytes(b) => b.to_vec(),
                Field::U32(n) => n.to_be_bytes().to_vec(),
            };
            out.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
            out.extend_from_slice(&bytes);
        }
        out
    }

    fn s(value: &str) -> Field<'_> {
        Field::Bytes(value.as_bytes())
    }

    const SEED1: &str = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
    const PUB1: &str = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";
    const VAULT: &str = "11111111-2222-3333-4444-555555555555";
    const OP: &str = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const LONG_ID: [u8; 129] = [b'x'; 129];

    fn valid_fields() -> Vec<Field<'static>> {
        vec![
            Field::Bytes(WRITE_V2_LABEL),
            s(VAULT),
            s("dev_test_0001"),
            s("POST"),
            s("/api/v1/vaults/{vaultId}/snapshots"),
            s("vault"),
            s(""),
            s(""),
            Field::U32(0),
            Field::U32(1),
            Field::U32(1),
            Field::U32(1),
            Field::U32(1),
            Field::Bytes(&[0x11; 32]),
            Field::Bytes(&[0x22; 32]),
            Field::U32(0),
            Field::Bytes(&[]),
            s(OP),
            Field::Bytes(&[0x33; 16]),
            Field::U32(1_800_000_000),
        ]
    }

    fn valid_preimage() -> Vec<u8> {
        frame(&valid_fields())
    }

    /// RFC 8032 §7.1 vectors at the signing layer, exact equality. TEST 1 has
    /// an empty message, which the command deliberately rejects; the command
    /// path is covered by the canonical-preimage tests below.
    #[test]
    fn rfc8032_vectors_match_exactly() {
        let cases = [
            (SEED1, PUB1, "", "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b"),
            ("4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb", "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c", "72", "92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00"),
        ];
        for (seed, public, msg, expected) in cases {
            let key = SigningKey::from_bytes(&hex(seed).try_into().unwrap());
            assert_eq!(key.verifying_key().to_bytes().to_vec(), hex(public));
            let signature = key.sign(&hex(msg)).to_bytes().to_vec();
            assert_eq!(signature, hex(expected));
        }
    }

    #[test]
    fn command_signs_canonical_preimage_and_derives_pubkey_from_seed() {
        let preimage = valid_preimage();
        let out = sign_ed25519_v2(hex(SEED1), preimage.clone()).expect("canonical preimage");
        assert_eq!(out.public_key, hex(PUB1));
        let key = SigningKey::from_bytes(&hex(SEED1).try_into().unwrap());
        assert_eq!(out.signature, key.sign(&preimage).to_bytes().to_vec());
        assert_eq!(out.signature.len(), WRITE_SIGNATURE_BYTES);
    }

    /// Cross-language vector: the exact canonical preimage produced by the TS
    /// encoder (`writeRequestBytesV2`, fixture write-request-vectors.json[0])
    /// must be accepted and signed byte-identically by the native command.
    #[test]
    fn matches_typescript_canonical_vector() {
        let preimage = hex("0000001734616c6c706173732d7661756c742d77726974652d76320000002436663063316331612d336634652d346331642d396137652d326238643066356131633333000000066465762d303100000004504f5354000000222f6170692f76312f7661756c74732f7b7661756c7449647d2f736e617073686f7473000000057661756c740000000000000000000000040000000000000004000000010000000400000001000000040000000100000004000000000000000000000020d801aa1fb7ddcc330a5e3173372ea6af4a3d08ec58074478e85aa5603e9266580000000400000000000000000000002430623964326237652d356134312d346338662d386630652d36643163326133623463356400000010000102030405060708090a0b0c0d0e0f0000000469153ec0");
        let out = sign_ed25519_v2(hex(SEED1), preimage).expect("ts canonical vector");
        assert_eq!(out.public_key, hex(PUB1));
        assert_eq!(
            out.signature,
            hex("c57996b4770b6b7d7886edb4887b6dc3db7e9a83c24681a3d2abed1c78b28173810353409d77a1b09d87bee23002ee89942a8c12ef6d6e0b73b8699c9289c50f")
        );
    }

    #[test]
    fn command_rejects_arbitrary_bytes() {
        assert_eq!(
            sign_ed25519_v2(hex(SEED1), vec![0x41; WRITE_MESSAGE_MAX + 1]).unwrap_err(),
            "write_message_invalid"
        );
        assert_eq!(
            sign_ed25519_v2(hex(SEED1), b"please sign this arbitrary text".to_vec()).unwrap_err(),
            "write_preimage_invalid"
        );
    }

    #[test]
    fn command_rejects_malformed_preimages() {
        let mut mutations: Vec<Vec<Field<'static>>> = Vec::new();

        let mut wrong_label = valid_fields();
        wrong_label[0] = s("4allpass-vault-write-v1");
        mutations.push(wrong_label);

        let mut short = valid_fields();
        short.pop();
        mutations.push(short);

        let mut long = valid_fields();
        long.push(Field::U32(0));
        mutations.push(long);

        let mut bad_uuid = valid_fields();
        bad_uuid[1] = s("11111111-2222-3333-4444-55555555555X");
        mutations.push(bad_uuid);

        let mut upper_uuid = valid_fields();
        upper_uuid[17] = s("AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE");
        mutations.push(upper_uuid);

        let mut empty_device = valid_fields();
        empty_device[2] = s("");
        mutations.push(empty_device);

        let mut long_id = valid_fields();
        long_id[6] = Field::Bytes(&LONG_ID);
        mutations.push(long_id);

        let mut lower_method = valid_fields();
        lower_method[3] = s("post");
        mutations.push(lower_method);

        let mut query_route = valid_fields();
        query_route[4] = s("/api/v1/vaults/{vaultId}/snapshots?x=1");
        mutations.push(query_route);

        let mut wrong_prefix = valid_fields();
        wrong_prefix[4] = s("/api/v2/vaults/{vaultId}/snapshots");
        mutations.push(wrong_prefix);

        let mut bad_type = valid_fields();
        bad_type[5] = s("entry");
        mutations.push(bad_type);

        let mut bad_presence = valid_fields();
        bad_presence[12] = Field::U32(2);
        mutations.push(bad_presence);

        let mut manifest_mismatch = valid_fields();
        manifest_mismatch[13] = Field::Bytes(&[]);
        mutations.push(manifest_mismatch);

        let mut short_payload = valid_fields();
        short_payload[14] = Field::Bytes(&[0x22; 31]);
        mutations.push(short_payload);

        let mut next_mismatch = valid_fields();
        next_mismatch[15] = Field::U32(1);
        mutations.push(next_mismatch);

        let mut short_nonce = valid_fields();
        short_nonce[18] = Field::Bytes(&[0x33; 15]);
        mutations.push(short_nonce);

        let mut short_uint = valid_fields();
        short_uint[8] = Field::Bytes(&[0, 0, 0]);
        mutations.push(short_uint);

        for fields in mutations {
            let preimage = frame(&fields);
            assert_eq!(
                sign_ed25519_v2(hex(SEED1), preimage).unwrap_err(),
                "write_preimage_invalid"
            );
        }

        let mut trailing = valid_preimage();
        trailing.push(0);
        assert_eq!(
            sign_ed25519_v2(hex(SEED1), trailing).unwrap_err(),
            "write_preimage_invalid"
        );
        assert_eq!(
            sign_ed25519_v2(hex(SEED1), Vec::new()).unwrap_err(),
            "write_message_invalid"
        );
    }

    #[test]
    fn rejects_wrong_seed_lengths() {
        assert_eq!(
            sign_ed25519_v2(vec![0u8; 31], valid_preimage()).unwrap_err(),
            "write_seed_invalid"
        );
        assert_eq!(
            sign_ed25519_v2(vec![0u8; 33], valid_preimage()).unwrap_err(),
            "write_seed_invalid"
        );
    }
}
