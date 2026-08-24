//! Read Firefox logins.json + key4.db. Empty master password first. Never logs secrets.

use std::{fs, path::Path};

use aes::Aes256;
use aes::cipher::{block_padding::Pkcs7, BlockDecryptMut, KeyIvInit};
use base64::Engine;
use cbc::Decryptor;
use pbkdf2::pbkdf2_hmac;
use rusqlite::Connection;
use sha1::Sha1;
use sha2::{Digest, Sha256};

use crate::browser_passwords::BrowserLogin;

enum Der<'a> {
    Seq(Vec<Der<'a>>),
    Octet(&'a [u8]),
    Int(i64),
    Other,
}

fn take_len(data: &[u8]) -> Result<(usize, usize), String> {
    if data.is_empty() {
        return Err("truncated DER length".into());
    }
    let first = data[0];
    if first & 0x80 == 0 {
        return Ok((1, first as usize));
    }
    let n = (first & 0x7f) as usize;
    if n == 0 || n > 4 || data.len() < 1 + n {
        return Err("bad DER length".into());
    }
    let mut len = 0usize;
    for b in &data[1..1 + n] {
        len = (len << 8) | usize::from(*b);
    }
    Ok((1 + n, len))
}

fn parse_der(data: &[u8]) -> Result<(Der<'_>, &[u8]), String> {
    if data.is_empty() {
        return Err("empty DER".into());
    }
    let tag = data[0];
    let (lh, len) = take_len(&data[1..])?;
    let start = 1 + lh;
    let end = start
        .checked_add(len)
        .ok_or_else(|| "DER overflow".to_string())?;
    if data.len() < end {
        return Err("truncated DER value".into());
    }
    let body = &data[start..end];
    let rest = &data[end..];
    let node = match tag {
        0x30 => {
            let mut items = Vec::new();
            let mut cur = body;
            while !cur.is_empty() {
                let (item, next) = parse_der(cur)?;
                items.push(item);
                cur = next;
            }
            Der::Seq(items)
        }
        0x04 => Der::Octet(body),
        0x02 => {
            let mut n: i64 = 0;
            for b in body {
                n = (n << 8) | i64::from(*b);
            }
            Der::Int(n)
        }
        _ => Der::Other,
    };
    Ok((node, rest))
}

fn seq<'a>(node: &'a Der<'a>) -> Result<&'a [Der<'a>], String> {
    match node {
        Der::Seq(items) => Ok(items),
        _ => Err("expected SEQUENCE".into()),
    }
}

fn octet<'a>(node: &'a Der<'a>) -> Result<&'a [u8], String> {
    match node {
        Der::Octet(b) => Ok(b),
        _ => Err("expected OCTET STRING".into()),
    }
}

fn int(node: &Der<'_>) -> Result<u32, String> {
    match node {
        Der::Int(n) if *n > 0 && *n < i64::from(u32::MAX) => Ok(*n as u32),
        _ => Err("expected INTEGER".into()),
    }
}

fn der_octet_encoding(value: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(2 + value.len());
    out.push(0x04);
    if value.len() < 128 {
        out.push(value.len() as u8);
    } else {
        out.push(0x81);
        out.push(value.len() as u8);
    }
    out.extend_from_slice(value);
    out
}

fn aes256_cbc_unpad(key: &[u8], iv: &[u8], encrypted: &[u8]) -> Result<Vec<u8>, String> {
    if key.len() != 32 || iv.len() != 16 {
        return Err("Firefox AES key/IV size".into());
    }
    let mut buf = encrypted.to_vec();
    let key: [u8; 32] = key.try_into().unwrap();
    let iv: [u8; 16] = iv.try_into().unwrap();
    Decryptor::<Aes256>::new(&key.into(), &iv.into())
        .decrypt_padded_mut::<Pkcs7>(&mut buf)
        .map(|p| p.to_vec())
        .map_err(|_| "Firefox AES decrypt failed".into())
}

fn pbes2_decrypt(global_salt: &[u8], master_pwd: &[u8], raw: &[u8]) -> Result<Vec<u8>, String> {
    let (top, _) = parse_der(raw)?;
    let items = seq(&top)?;
    if items.len() < 2 {
        return Err("PBES2 envelope too short".into());
    }
    let alg = seq(&items[0])?;
    if alg.len() < 2 {
        return Err("PBES2 alg too short".into());
    }
    let params = seq(&alg[1])?;
    if params.len() < 2 {
        return Err("PBES2 params too short".into());
    }
    let kdf_seq = seq(&params[0])?;
    if kdf_seq.len() < 2 {
        return Err("PBKDF2 seq too short".into());
    }
    let kdf_params = seq(&kdf_seq[1])?;
    if kdf_params.len() < 3 {
        return Err("PBKDF2 params too short".into());
    }
    let entry_salt = octet(&kdf_params[0])?;
    let iterations = int(&kdf_params[1])?;
    let key_length = int(&kdf_params[2])? as usize;
    if key_length == 0 || key_length > 64 {
        return Err("PBKDF2 key length".into());
    }
    let enc_seq = seq(&params[1])?;
    if enc_seq.len() < 2 {
        return Err("AES params too short".into());
    }
    let iv_node = &enc_seq[1];
    let iv_value = octet(iv_node)?;
    let iv = if iv_value.len() == 16 {
        iv_value.to_vec()
    } else {
        der_octet_encoding(iv_value)
    };
    if iv.len() != 16 {
        return Err("Firefox IV is not 16 bytes".into());
    }
    let encrypted = octet(&items[1])?;
    let hp = Sha1::digest([global_salt, master_pwd].concat());
    let mut key = vec![0u8; key_length];
    pbkdf2_hmac::<Sha256>(&hp, entry_salt, iterations, &mut key);
    aes256_cbc_unpad(&key, &iv, encrypted)
}

fn firefox_master_key(key4: &Path, master_pwd: &[u8]) -> Result<Vec<u8>, String> {
    let conn = Connection::open(key4).map_err(|err| err.to_string())?;
    let (global_salt, item2): (Vec<u8>, Vec<u8>) = conn
        .query_row(
            "SELECT item1, item2 FROM metaData WHERE id = 'password'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .or_else(|_| {
            conn.query_row(
                "SELECT item1, item2 FROM metadata WHERE id = 'password'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
        })
        .map_err(|_| "Firefox key4.db has no password metadata".to_string())?;
    let check = pbes2_decrypt(&global_salt, master_pwd, &item2)?;
    if !check.windows(b"password-check".len()).any(|w| w == b"password-check") {
        return Err(
            "Firefox-Master-Passwort gesetzt oder falsch. Leeres Passwort versucht. / Firefox primary password is set."
                .into(),
        );
    }
    let mut stmt = conn
        .prepare("SELECT a11 FROM nssPrivate")
        .map_err(|err| err.to_string())?;
    let mut rows = stmt.query([]).map_err(|err| err.to_string())?;
    while let Some(row) = rows.next().map_err(|err| err.to_string())? {
        let a11: Vec<u8> = row.get(0).unwrap_or_default();
        if a11.is_empty() {
            continue;
        }
        if let Ok(dk) = pbes2_decrypt(&global_salt, master_pwd, &a11) {
            if dk.len() == 32 {
                return Ok(dk);
            }
        }
    }
    Err("Could not extract Firefox AES key from key4.db".into())
}

fn decrypt_login_field(b64: &str, master_key: &[u8]) -> Result<String, String> {
    let raw = base64::engine::general_purpose::STANDARD
        .decode(b64.trim())
        .map_err(|_| "Firefox login field is not base64".to_string())?;
    let (top, _) = parse_der(&raw)?;
    let items = seq(&top)?;
    if items.len() < 3 {
        return Err("Firefox login ASN.1 too short".into());
    }
    let iv_seq = seq(&items[1])?;
    if iv_seq.len() < 2 {
        return Err("Firefox login IV missing".into());
    }
    let iv_value = octet(&iv_seq[1])?;
    let iv = if iv_value.len() == 16 {
        iv_value.to_vec()
    } else {
        der_octet_encoding(iv_value)
    };
    let encrypted = octet(&items[2])?;
    let plain = aes256_cbc_unpad(master_key, &iv, encrypted)?;
    String::from_utf8(plain).map_err(|_| "Firefox login was not UTF-8".into())
}

fn title_from_host(host: &str) -> String {
    host.split("://")
        .nth(1)
        .unwrap_or(host)
        .split('/')
        .next()
        .unwrap_or(host)
        .trim_start_matches("www.")
        .to_string()
}

pub fn read_firefox_logins(profile_dir: &Path, source: &str) -> Result<Vec<BrowserLogin>, String> {
    let key4 = profile_dir.join("key4.db");
    let logins = profile_dir.join("logins.json");
    if !key4.is_file() || !logins.is_file() {
        return Err(format!("no key4.db/logins.json in {}", profile_dir.display()));
    }
    let tmp = std::env::temp_dir().join(format!(
        "4ap-ff-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    fs::create_dir_all(&tmp).map_err(|err| err.to_string())?;
    fs::copy(&key4, tmp.join("key4.db")).map_err(|err| err.to_string())?;
    fs::copy(&logins, tmp.join("logins.json")).map_err(|err| err.to_string())?;
    for extra in ["key4.db-wal", "key4.db-shm", "key4.db-journal"] {
        let side = profile_dir.join(extra);
        if side.is_file() {
            let _ = fs::copy(&side, tmp.join(extra));
        }
    }
    let result = (|| {
        let master = firefox_master_key(&tmp.join("key4.db"), b"")?;
        let text = fs::read_to_string(tmp.join("logins.json")).map_err(|err| err.to_string())?;
        let json: serde_json::Value = serde_json::from_str(&text).map_err(|err| err.to_string())?;
        let Some(list) = json.get("logins").and_then(|v| v.as_array()) else {
            return Ok(Vec::new());
        };
        let mut out = Vec::new();
        for item in list {
            let host = item
                .get("hostname")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let enc_user = item
                .get("encryptedUsername")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let enc_pass = item
                .get("encryptedPassword")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let username = decrypt_login_field(enc_user, &master).unwrap_or_default();
            let password = match decrypt_login_field(enc_pass, &master) {
                Ok(p) => p,
                Err(_) => continue,
            };
            if username.is_empty() && password.is_empty() {
                continue;
            }
            out.push(BrowserLogin {
                title: title_from_host(&host),
                url: host,
                username,
                password,
                source: source.to_string(),
            });
        }
        Ok(out)
    })();
    let _ = fs::remove_dir_all(&tmp);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn der_octet_roundtrip_header() {
        let raw = [0x04, 0x03, b'a', b'b', b'c'];
        let (node, rest) = parse_der(&raw).unwrap();
        assert!(rest.is_empty());
        assert_eq!(octet(&node).unwrap(), b"abc");
    }

    #[test]
    fn der_seq_of_int() {
        // SEQUENCE { INTEGER 1003 }
        let raw = [0x30, 0x04, 0x02, 0x02, 0x03, 0xeb];
        let (node, _) = parse_der(&raw).unwrap();
        let items = seq(&node).unwrap();
        assert_eq!(int(&items[0]).unwrap(), 1003);
    }
}
