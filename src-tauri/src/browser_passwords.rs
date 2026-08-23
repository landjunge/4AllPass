//! Read Chromium Login Data on this device. Never logs passwords. Never talks to FastAPI.

use std::{
    fs,
    path::{Path, PathBuf},
};

#[cfg(target_os = "macos")]
use std::process::Command;

use aes::Aes128;
use aes::cipher::{block_padding::Pkcs7, BlockDecryptMut, KeyIvInit};
use cbc::Decryptor;
use pbkdf2::pbkdf2_hmac;
use rusqlite::Connection;
use serde::Serialize;
use sha1::Sha1;

use crate::browsers::chromium_profile_dir;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserLogin {
    pub url: String,
    pub username: String,
    pub password: String,
    pub title: String,
    pub source: String,
}

fn safe_storage(browser_id: &str) -> Option<(&'static str, &'static str)> {
    match browser_id {
        "chrome" | "chrome-canary" => Some(("Chrome Safe Storage", "Chrome")),
        "brave" => Some(("Brave Safe Storage", "Brave")),
        "edge" => Some(("Microsoft Edge Safe Storage", "Microsoft Edge")),
        "arc" => Some(("Arc Safe Storage", "Arc")),
        "chromium" => Some(("Chromium Safe Storage", "Chromium")),
        "vivaldi" => Some(("Vivaldi Safe Storage", "Vivaldi")),
        "opera" | "opera-gx" => Some(("Opera Safe Storage", "Opera")),
        _ => None,
    }
}

pub fn derive_chrome_key(password: &[u8]) -> [u8; 16] {
    let mut key = [0u8; 16];
    pbkdf2_hmac::<Sha1>(password, b"saltysalt", 1003, &mut key);
    key
}

pub fn decrypt_chrome_v10(key: &[u8; 16], blob: &[u8]) -> Result<String, String> {
    if blob.len() < 4 || &blob[0..3] != b"v10" {
        return Err("Chrome password is not v10 (newer app-bound encryption is not this slice)".into());
    }
    let iv = [0x20u8; 16];
    let mut buf = blob[3..].to_vec();
    let plain = Decryptor::<Aes128>::new(key.into(), &iv.into())
        .decrypt_padded_mut::<Pkcs7>(&mut buf)
        .map_err(|_| "Chrome password decrypt failed".to_string())?;
    String::from_utf8(plain.to_vec()).map_err(|_| "Chrome password was not UTF-8".into())
}

fn keychain_secret(service: &str, account: &str) -> Result<Vec<u8>, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (service, account);
        return Err("Browser password import is macOS first.".into());
    }
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("security")
            .args(["find-generic-password", "-w", "-s", service, "-a", account])
            .output()
            .map_err(|err| err.to_string())?;
        if !output.status.success() {
            return Err(
                "macOS Keychain hat den Chrome-Schlüssel nicht gegeben. Anmeldepasswort erlauben. / Keychain denied Chrome Safe Storage."
                    .into(),
            );
        }
        let mut secret = output.stdout;
        while secret.last().copied() == Some(b'\n') || secret.last().copied() == Some(b'\r') {
            secret.pop();
        }
        if secret.is_empty() {
            return Err("Keychain returned an empty Chrome Safe Storage secret".into());
        }
        Ok(secret)
    }
}

fn copy_login_db(profile_dir: &Path) -> Result<PathBuf, String> {
    let src = profile_dir.join("Login Data");
    if !src.is_file() {
        return Err(format!("no Login Data in {}", profile_dir.display()));
    }
    let tmp = std::env::temp_dir().join(format!(
        "4ap-login-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    fs::create_dir_all(&tmp).map_err(|err| err.to_string())?;
    fs::copy(&src, tmp.join("Login Data")).map_err(|err| err.to_string())?;
    for extra in ["Login Data-wal", "Login Data-shm", "Login Data-journal"] {
        let side = profile_dir.join(extra);
        if side.is_file() {
            let _ = fs::copy(&side, tmp.join(extra));
        }
    }
    Ok(tmp)
}

fn title_from_url(url: &str) -> String {
    url.split("://")
        .nth(1)
        .unwrap_or(url)
        .split('/')
        .next()
        .unwrap_or(url)
        .trim_start_matches("www.")
        .to_string()
}

pub fn read_chromium_logins(db_path: &Path, key: &[u8; 16], source: &str) -> Result<Vec<BrowserLogin>, String> {
    let conn = Connection::open(db_path).map_err(|err| err.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT origin_url, username_value, password_value FROM logins WHERE length(password_value) > 3",
        )
        .map_err(|err| err.to_string())?;
    let mut rows = stmt.query([]).map_err(|err| err.to_string())?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(|err| err.to_string())? {
        let url: String = row.get(0).unwrap_or_default();
        let username: String = row.get(1).unwrap_or_default();
        let blob: Vec<u8> = row.get(2).unwrap_or_default();
        let Ok(password) = decrypt_chrome_v10(key, &blob) else {
            continue;
        };
        if password.is_empty() && username.is_empty() {
            continue;
        }
        out.push(BrowserLogin {
            title: title_from_url(&url),
            url,
            username,
            password,
            source: source.to_string(),
        });
    }
    Ok(out)
}

#[tauri::command]
pub fn import_browser_logins(browser_id: String, profile_id: String) -> Result<Vec<BrowserLogin>, String> {
    let (service, account) = safe_storage(&browser_id).ok_or_else(|| {
        "Passwörter aus diesem Browser kommen als Nächstes. / Password import for this browser is next."
            .to_string()
    })?;
    let secret = keychain_secret(service, account)?;
    let key = derive_chrome_key(&secret);
    let home = crate::browsers::default_home();
    let profile_dir = chromium_profile_dir(&home, &browser_id, &profile_id)?;
    let tmp = copy_login_db(&profile_dir)?;
    let db = tmp.join("Login Data");
    let result = read_chromium_logins(&db, &key, &format!("{browser_id}:{profile_id}"));
    let _ = fs::remove_dir_all(&tmp);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use aes::Aes128;
    use aes::cipher::{block_padding::Pkcs7, BlockEncryptMut, KeyIvInit};
    use cbc::Encryptor;
    use rusqlite::params;

    fn encrypt_v10(key: &[u8; 16], password: &str) -> Vec<u8> {
        let iv = [0x20u8; 16];
        let mut work = password.as_bytes().to_vec();
        work.resize(work.len() + 16, 0);
        let out = Encryptor::<Aes128>::new(key.into(), &iv.into())
            .encrypt_padded_mut::<Pkcs7>(&mut work, password.len())
            .expect("encrypt")
            .to_vec();
        let mut blob = b"v10".to_vec();
        blob.extend_from_slice(&out);
        blob
    }

    #[test]
    fn v10_roundtrip() {
        let key = derive_chrome_key(b"peanuts");
        let blob = encrypt_v10(&key, "hunter2");
        assert_eq!(decrypt_chrome_v10(&key, &blob).unwrap(), "hunter2");
    }

    #[test]
    fn sqlite_fixture_decrypts() {
        let key = derive_chrome_key(b"peanuts");
        let blob = encrypt_v10(&key, "secret-pass");
        let dir = std::env::temp_dir().join(format!("4ap-sql-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let db = dir.join("Login Data");
        let conn = Connection::open(&db).unwrap();
        conn.execute(
            "CREATE TABLE logins (origin_url TEXT, username_value TEXT, password_value BLOB)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO logins (origin_url, username_value, password_value) VALUES (?1, ?2, ?3)",
            params!["https://example.com/login", "ada", blob],
        )
        .unwrap();
        drop(conn);
        let rows = read_chromium_logins(&db, &key, "chrome:Default").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].username, "ada");
        assert_eq!(rows[0].password, "secret-pass");
        assert_eq!(rows[0].title, "example.com");
        fs::remove_dir_all(&dir).ok();
    }
}
