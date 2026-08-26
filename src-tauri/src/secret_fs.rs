//! Owner-only temp dirs and best-effort overwrite before unlink.

use std::{
    fs,
    path::{Path, PathBuf},
};

pub fn secret_temp_dir(prefix: &str) -> Result<PathBuf, String> {
    let tmp = std::env::temp_dir().join(format!(
        "{prefix}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    fs::create_dir_all(&tmp).map_err(|err| err.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&tmp, fs::Permissions::from_mode(0o700)).map_err(|err| err.to_string())?;
    }
    Ok(tmp)
}

fn overwrite_file(path: &Path) {
    if let Ok(meta) = fs::metadata(path) {
        if meta.is_file() {
            let len = meta.len() as usize;
            let _ = fs::write(path, vec![0u8; len.max(1)]);
        }
    }
}

pub fn shred_tree(path: &Path) {
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            let child = entry.path();
            if child.is_dir() {
                shred_tree(&child);
            } else {
                overwrite_file(&child);
            }
        }
    }
    overwrite_file(path);
    let _ = fs::remove_dir_all(path);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn secret_temp_dir_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let dir = secret_temp_dir("4ap-test-mode").unwrap();
        let mode = fs::metadata(&dir).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o700);
        shred_tree(&dir);
        assert!(!dir.exists());
    }
}
