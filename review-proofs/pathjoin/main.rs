// Adversarial review proof — chromium_profile_dir / firefox_profile_dir join a
// caller-supplied string with no containment check.
// src-tauri/src/browsers.rs:224  Ok(user_data_dir(spec, home).join(profile_dir))
// src-tauri/src/browsers.rs:210  if given.is_absolute() { return Ok(given.to_path_buf()); }
use std::path::{Path, PathBuf};

fn chromium_like(home: &Path, profile_dir: &str) -> PathBuf {
    home.join("Library/Application Support/Google/Chrome").join(profile_dir)
}

fn firefox_like(home: &Path, profile_path: &str) -> PathBuf {
    let root = home.join("Library/Application Support/Firefox");
    let given = Path::new(profile_path);
    if given.is_absolute() { return given.to_path_buf(); }
    root.join(given)
}

fn main() {
    let home = Path::new("/Users/ada");

    let escaped = chromium_like(home, "../../../../../../Volumes/evidence");
    println!("chromium profileId=\"../../../..\" -> {}", escaped.display());
    assert!(escaped.to_string_lossy().contains("/Volumes/evidence"));

    let absolute = chromium_like(home, "/Users/victim/Library/Application Support/Google/Chrome/Default");
    println!("chromium profileId=absolute        -> {}", absolute.display());
    assert_eq!(absolute, Path::new("/Users/victim/Library/Application Support/Google/Chrome/Default"));

    let ff = firefox_like(home, "/Users/victim/Library/Application Support/Firefox/Profiles/x");
    println!("firefox  profileId=absolute        -> {}  (explicitly honoured)", ff.display());
    assert!(ff.starts_with("/Users/victim"));

    println!("no canonicalize(), no starts_with(root) check anywhere in browsers.rs");
}
