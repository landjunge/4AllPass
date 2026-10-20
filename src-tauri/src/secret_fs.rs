//! Owner-only temp dirs and best-effort no-follow tree removal.

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
        fs::set_permissions(&tmp, fs::Permissions::from_mode(0o700))
            .map_err(|err| err.to_string())?;
    }
    Ok(tmp)
}

/// Historical name: removal, not a secure-erasure guarantee. Never overwrite
/// through a symlink or hardlink in a temporary browser copy. Use the standard
/// library's no-follow recursive removal rather than a path-based custom walk.
pub fn shred_tree(path: &Path) {
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

    #[test]
    fn ordinary_nested_tree_is_removed() {
        let dir = secret_temp_dir("4ap-test-cleanup-tree").unwrap();
        fs::create_dir(dir.join("nested")).unwrap();
        fs::write(dir.join("nested/copy"), b"synthetic-copy-only").unwrap();
        shred_tree(&dir);
        assert!(!dir.exists());
    }

    #[cfg(unix)]
    fn outside_fixture() -> (PathBuf, PathBuf) {
        let outside = secret_temp_dir("4ap-test-cleanup-outside").unwrap();
        let victim = outside.join("keep");
        fs::write(&victim, b"synthetic-outside-only").unwrap();
        (outside, victim)
    }

    #[cfg(unix)]
    fn assert_outside_unchanged(outside: &Path, victim: &Path) {
        let bytes = fs::read(victim).unwrap();
        fs::remove_dir_all(outside).unwrap();
        assert_eq!(bytes, b"synthetic-outside-only");
    }

    #[cfg(unix)]
    #[test]
    fn file_symlink_does_not_overwrite_its_target() {
        let (outside, victim) = outside_fixture();
        let dir = secret_temp_dir("4ap-test-cleanup-file-link").unwrap();
        std::os::unix::fs::symlink(&victim, dir.join("link")).unwrap();
        shred_tree(&dir);
        assert!(!dir.exists());
        assert_outside_unchanged(&outside, &victim);
    }

    #[cfg(unix)]
    #[test]
    fn directory_symlink_does_not_walk_its_target() {
        let (outside, victim) = outside_fixture();
        let dir = secret_temp_dir("4ap-test-cleanup-dir-link").unwrap();
        std::os::unix::fs::symlink(&outside, dir.join("link")).unwrap();
        shred_tree(&dir);
        assert!(!dir.exists());
        assert_outside_unchanged(&outside, &victim);
    }

    #[cfg(unix)]
    #[test]
    fn hardlink_does_not_overwrite_other_name() {
        let (outside, victim) = outside_fixture();
        let dir = secret_temp_dir("4ap-test-cleanup-hard-link").unwrap();
        fs::hard_link(&victim, dir.join("link")).unwrap();
        shred_tree(&dir);
        assert!(!dir.exists());
        assert_outside_unchanged(&outside, &victim);
    }

    #[cfg(unix)]
    #[test]
    fn root_symlink_does_not_walk_its_target() {
        let (outside, victim) = outside_fixture();
        let parent = secret_temp_dir("4ap-test-cleanup-root-link").unwrap();
        let link = parent.join("link");
        std::os::unix::fs::symlink(&outside, &link).unwrap();
        shred_tree(&link);
        assert!(fs::symlink_metadata(&link).is_err());
        assert_outside_unchanged(&outside, &victim);
        shred_tree(&parent);
    }
}
