//! List installed browsers and their profiles. Does not read passwords.

use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserProfile {
    pub id: String,
    pub name: String,
    pub dir_name: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BrowserCard {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub installed: bool,
    pub profiles: Vec<BrowserProfile>,
}

struct Spec {
    id: &'static str,
    name: &'static str,
    kind: &'static str,
    mac_app: &'static str,
    mac_data: &'static str,
    win_data: &'static str,
    linux_data: &'static str,
}

const SPECS: &[Spec] = &[
    Spec {
        id: "chrome",
        name: "Chrome",
        kind: "chromium",
        mac_app: "Google Chrome.app",
        mac_data: "Google/Chrome",
        win_data: "Google/Chrome/User Data",
        linux_data: "google-chrome",
    },
    Spec {
        id: "brave",
        name: "Brave",
        kind: "chromium",
        mac_app: "Brave Browser.app",
        mac_data: "BraveSoftware/Brave-Browser",
        win_data: "BraveSoftware/Brave-Browser/User Data",
        linux_data: "BraveSoftware/Brave-Browser",
    },
    Spec {
        id: "edge",
        name: "Edge",
        kind: "chromium",
        mac_app: "Microsoft Edge.app",
        mac_data: "Microsoft Edge",
        win_data: "Microsoft/Edge/User Data",
        linux_data: "microsoft-edge",
    },
    Spec {
        id: "arc",
        name: "Arc",
        kind: "chromium",
        mac_app: "Arc.app",
        mac_data: "Arc/User Data",
        win_data: "Arc/User Data",
        linux_data: "Arc",
    },
    Spec {
        id: "chromium",
        name: "Chromium",
        kind: "chromium",
        mac_app: "Chromium.app",
        mac_data: "Chromium",
        win_data: "Chromium/User Data",
        linux_data: "chromium",
    },
    Spec {
        id: "vivaldi",
        name: "Vivaldi",
        kind: "chromium",
        mac_app: "Vivaldi.app",
        mac_data: "Vivaldi",
        win_data: "Vivaldi/User Data",
        linux_data: "vivaldi",
    },
    Spec {
        id: "opera",
        name: "Opera",
        kind: "chromium",
        mac_app: "Opera.app",
        mac_data: "com.operasoftware.Opera",
        win_data: "Opera Software/Opera Stable",
        linux_data: "opera",
    },
    Spec {
        id: "opera-gx",
        name: "Opera GX",
        kind: "chromium",
        mac_app: "Opera GX.app",
        mac_data: "com.operasoftware.OperaGX",
        win_data: "Opera Software/Opera GX Stable",
        linux_data: "opera-gx",
    },
    Spec {
        id: "chrome-canary",
        name: "Chrome Canary",
        kind: "chromium",
        mac_app: "Google Chrome Canary.app",
        mac_data: "Google/Chrome Canary",
        win_data: "Google/Chrome SxS/User Data",
        linux_data: "google-chrome-unstable",
    },
    Spec {
        id: "firefox",
        name: "Firefox",
        kind: "firefox",
        mac_app: "Firefox.app",
        mac_data: "Firefox",
        win_data: "Mozilla/Firefox",
        linux_data: "firefox",
    },
    Spec {
        id: "firefox-developer",
        name: "Firefox Developer",
        kind: "firefox",
        mac_app: "Firefox Developer Edition.app",
        mac_data: "FirefoxDeveloperEdition",
        win_data: "Mozilla/Firefox Developer Edition",
        linux_data: "firefox-dev",
    },
    Spec {
        id: "firefox-nightly",
        name: "Firefox Nightly",
        kind: "firefox",
        mac_app: "Firefox Nightly.app",
        mac_data: "Firefox Nightly",
        win_data: "Mozilla/Firefox Nightly",
        linux_data: "firefox-nightly",
    },
    Spec {
        id: "safari",
        name: "Safari",
        kind: "safari",
        mac_app: "Safari.app",
        mac_data: "Safari",
        win_data: "",
        linux_data: "",
    },
];

pub fn list_browser_cards(home: &Path, applications: &[&Path]) -> Vec<BrowserCard> {
    SPECS
        .iter()
        .filter_map(|spec| card_for(spec, home, applications))
        .collect()
}

fn card_for(spec: &Spec, home: &Path, applications: &[&Path]) -> Option<BrowserCard> {
    let app_installed = applications.iter().any(|root| root.join(spec.mac_app).is_dir());
    let data = user_data_dir(spec, home);
    let data_exists = data.is_dir();
    if spec.kind == "safari" && cfg!(not(target_os = "macos")) {
        return None;
    }
    if spec.kind == "safari" && !app_installed && !data_exists {
        return None;
    }
    if spec.kind != "safari" && !app_installed && !data_exists {
        return None;
    }

    let profiles = match spec.kind {
        "chromium" => chromium_profiles(&data),
        "firefox" => firefox_profiles(&data),
        "safari" => vec![BrowserProfile {
            id: "default".into(),
            name: "Safari".into(),
            dir_name: String::new(),
        }],
        _ => vec![],
    };

    Some(BrowserCard {
        id: spec.id.into(),
        name: spec.name.into(),
        kind: spec.kind.into(),
        installed: app_installed || data_exists,
        profiles,
    })
}

/// Profile dirs must stay under the browser's data folder. Absolute Firefox
/// paths are allowed only if they still resolve inside that folder.
pub(crate) fn contained_profile_dir(root: &Path, given: &str) -> Result<PathBuf, String> {
    if given.is_empty() {
        return Err("empty profile path".into());
    }
    let raw = Path::new(given);
    if raw.components().any(|part| matches!(part, std::path::Component::ParentDir)) {
        return Err("profile path must not contain ..".into());
    }
    let joined = if raw.is_absolute() {
        raw.to_path_buf()
    } else {
        root.join(raw)
    };
    let root_norm = normalize_path(root);
    let joined_norm = normalize_path(&joined);
    if !joined_norm.starts_with(&root_norm) {
        return Err("profile is outside the browser data folder".into());
    }
    Ok(joined)
}

fn normalize_path(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for part in path.components() {
        match part {
            std::path::Component::ParentDir => {
                out.pop();
            }
            std::path::Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

pub(crate) fn firefox_profile_dir(home: &Path, browser_id: &str, profile_path: &str) -> Result<PathBuf, String> {
    let spec = SPECS
        .iter()
        .find(|spec| spec.id == browser_id)
        .ok_or_else(|| format!("unknown browser {browser_id}"))?;
    if spec.kind != "firefox" {
        return Err("not a Firefox profile".into());
    }
    contained_profile_dir(&user_data_dir(spec, home), profile_path)
}

pub(crate) fn chromium_profile_dir(home: &Path, browser_id: &str, profile_dir: &str) -> Result<PathBuf, String> {
    let spec = SPECS
        .iter()
        .find(|spec| spec.id == browser_id)
        .ok_or_else(|| format!("unknown browser {browser_id}"))?;
    if spec.kind != "chromium" {
        return Err("Passwörter aus diesem Browser kommen als Nächstes. / Password import for this browser is next.".into());
    }
    contained_profile_dir(&user_data_dir(spec, home), profile_dir)
}

fn user_data_dir(spec: &Spec, home: &Path) -> PathBuf {
    if cfg!(target_os = "windows") {
        let local = std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join("AppData/Local"));
        return local.join(spec.win_data);
    }
    if cfg!(target_os = "linux") {
        return home.join(".config").join(spec.linux_data);
    }
    home.join("Library/Application Support").join(spec.mac_data)
}

fn chromium_profiles(data: &Path) -> Vec<BrowserProfile> {
    let mut out = Vec::new();
    let state = data.join("Local State");
    if let Ok(text) = fs::read_to_string(&state) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
            if let Some(cache) = json
                .pointer("/profile/info_cache")
                .and_then(|v| v.as_object())
            {
                for (dir_name, info) in cache {
                    if skip_chromium_profile(dir_name) {
                        continue;
                    }
                    let name = info
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or(dir_name)
                        .to_string();
                    out.push(BrowserProfile {
                        id: dir_name.clone(),
                        name,
                        dir_name: dir_name.clone(),
                    });
                }
            }
        }
    }
    if out.is_empty() {
        out.extend(chromium_dirs(data));
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

fn chromium_dirs(data: &Path) -> Vec<BrowserProfile> {
    let Ok(entries) = fs::read_dir(data) else {
        return vec![];
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if skip_chromium_profile(&name) {
            continue;
        }
        if name == "Default" || name.starts_with("Profile ") {
            let dir = data.join(name.as_ref());
            if dir.join("Preferences").is_file() || dir.join("Login Data").is_file() {
                out.push(BrowserProfile {
                    id: name.to_string(),
                    name: display_chromium_dir(&name),
                    dir_name: name.to_string(),
                });
            }
        }
    }
    out
}

fn skip_chromium_profile(dir_name: &str) -> bool {
    matches!(dir_name, "System Profile" | "Guest Profile")
}

fn display_chromium_dir(dir: &str) -> String {
    if dir == "Default" {
        "Default".into()
    } else {
        dir.to_string()
    }
}

fn firefox_profiles(data: &Path) -> Vec<BrowserProfile> {
    let ini = data.join("profiles.ini");
    if let Ok(text) = fs::read_to_string(&ini) {
        let parsed = parse_firefox_ini(&text);
        if !parsed.is_empty() {
            return parsed;
        }
    }
    let profiles_dir = data.join("Profiles");
    let Ok(entries) = fs::read_dir(&profiles_dir) else {
        return vec![];
    };
    entries
        .flatten()
        .filter(|e| e.path().is_dir())
        .map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            BrowserProfile {
                id: name.clone(),
                name: name.clone(),
                dir_name: format!("Profiles/{name}"),
            }
        })
        .collect()
}

fn parse_firefox_ini(text: &str) -> Vec<BrowserProfile> {
    let mut out = Vec::new();
    let mut name: Option<String> = None;
    let mut path: Option<String> = None;
    let mut in_profile = false;
    let flush = |name: &mut Option<String>, path: &mut Option<String>, out: &mut Vec<BrowserProfile>| {
        if let Some(dir) = path.take() {
            let label = name.take().unwrap_or_else(|| dir.clone());
            out.push(BrowserProfile {
                id: dir.clone(),
                name: label,
                dir_name: dir,
            });
        } else {
            name.take();
        }
    };
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with('[') && line.ends_with(']') {
            if in_profile {
                flush(&mut name, &mut path, &mut out);
            }
            in_profile = line[1..line.len() - 1].starts_with("Profile");
            continue;
        }
        if !in_profile {
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            match k.trim() {
                "Name" => name = Some(v.trim().to_string()),
                "Path" => path = Some(v.trim().to_string()),
                _ => {}
            }
        }
    }
    if in_profile {
        flush(&mut name, &mut path, &mut out);
    }
    out
}

pub fn default_home() -> PathBuf {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

pub fn default_application_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if cfg!(target_os = "macos") {
        dirs.push(PathBuf::from("/Applications"));
        dirs.push(default_home().join("Applications"));
    }
    dirs
}

#[tauri::command]
pub fn list_browser_profiles() -> Vec<BrowserCard> {
    let home = default_home();
    let apps: Vec<PathBuf> = default_application_dirs();
    let refs: Vec<&Path> = apps.iter().map(PathBuf::as_path).collect();
    list_browser_cards(&home, &refs)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionInstall {
    pub browser_id: String,
    pub flavor: String,
    pub bundle_path: String,
    pub app_name: String,
    pub page: String,
}

fn flavor_for(browser_id: &str) -> &'static str {
    match browser_id {
        "firefox" | "firefox-developer" | "firefox-nightly" => "firefox",
        "safari" => "safari",
        _ => "chromium",
    }
}

fn app_name_for(browser_id: &str) -> &'static str {
    match browser_id {
        "chrome" => "Google Chrome",
        "chrome-canary" => "Google Chrome Canary",
        "brave" => "Brave Browser",
        "edge" => "Microsoft Edge",
        "arc" => "Arc",
        "chromium" => "Chromium",
        "vivaldi" => "Vivaldi",
        "opera" => "Opera",
        "opera-gx" => "Opera GX",
        "firefox" => "Firefox",
        "firefox-developer" => "Firefox Developer Edition",
        "firefox-nightly" => "Firefox Nightly",
        "safari" => "Safari",
        _ => "Google Chrome",
    }
}

fn extensions_page(browser_id: &str) -> &'static str {
    match flavor_for(browser_id) {
        "firefox" => "about:debugging#/runtime/this-firefox",
        "safari" => "Safari → Settings → Extensions",
        _ => "chrome://extensions",
    }
}

fn repo_bundle(flavor: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("repo")
        .join("extension")
        .join("dist")
        .join(flavor)
}

#[tauri::command]
pub fn extension_install(browser_id: String) -> Result<ExtensionInstall, String> {
    let flavor = flavor_for(&browser_id).to_string();
    let bundle = if flavor == "safari" {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("repo")
            .join("extension/safari/FourAllPass/FourAllPass.xcodeproj")
    } else {
        repo_bundle(&flavor)
    };
    if !bundle.exists() {
        return Err(format!(
            "extension bundle missing: {} — run npm run build:extension",
            bundle.display()
        ));
    }
    Ok(ExtensionInstall {
        browser_id: browser_id.clone(),
        flavor,
        bundle_path: bundle.to_string_lossy().into_owned(),
        app_name: app_name_for(&browser_id).into(),
        page: extensions_page(&browser_id).into(),
    })
}

/// Demo login page served by the local sidecar. Not an arbitrary URL opener.
const AUTOFILL_DEMO_URL: &str = "http://127.0.0.1:8788/test-login.html";

#[tauri::command]
pub fn open_autofill_demo(browser_id: String) -> Result<(), String> {
    let app = app_name_for(&browser_id);
    #[cfg(target_os = "macos")]
    {
        let status = Command::new("open")
            .args(["-a", app, AUTOFILL_DEMO_URL])
            .status()
            .map_err(|err| err.to_string())?;
        if !status.success() {
            return Err(format!("could not open demo login in {app}"));
        }
        return Ok(());
    }
    #[cfg(target_os = "windows")]
    {
        let _ = (browser_id, app);
        Command::new("cmd")
            .args(["/C", "start", "", AUTOFILL_DEMO_URL])
            .status()
            .map_err(|err| err.to_string())?;
        return Ok(());
    }
    #[cfg(target_os = "linux")]
    {
        let _ = (browser_id, app);
        Command::new("xdg-open")
            .arg(AUTOFILL_DEMO_URL)
            .status()
            .map_err(|err| err.to_string())?;
        return Ok(());
    }
    #[allow(unreachable_code)]
    Err("open demo login is not supported on this OS".into())
}

#[tauri::command]
pub fn open_browser_for_extension(browser_id: String) -> Result<(), String> {
    let app = app_name_for(&browser_id);
    #[cfg(target_os = "macos")]
    {
        let status = Command::new("open")
            .args(["-a", app])
            .status()
            .map_err(|err| err.to_string())?;
        if !status.success() {
            return Err(format!("could not open {app}"));
        }
        return Ok(());
    }
    #[cfg(target_os = "windows")]
    {
        let _ = browser_id;
        Command::new("cmd")
            .args(["/C", "start", "", app])
            .status()
            .map_err(|err| err.to_string())?;
        return Ok(());
    }
    #[cfg(target_os = "linux")]
    {
        let _ = (browser_id, app);
        Command::new("xdg-open")
            .arg(".")
            .status()
            .map_err(|err| err.to_string())?;
        return Ok(());
    }
    #[allow(unreachable_code)]
    Err("open browser is not supported on this OS".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn scratch() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "4ap-browsers-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn autofill_demo_stays_on_loopback() {
        assert_eq!(AUTOFILL_DEMO_URL, "http://127.0.0.1:8788/test-login.html");
        assert!(!AUTOFILL_DEMO_URL.contains("github.com"));
    }

    #[test]
    fn firefox_ini_profiles() {
        let text = "[General]\nStartWithLastProfile=1\n\n[Profile0]\nName=default-release\nIsRelative=1\nPath=Profiles/abcd.default-release\nDefault=1\n\n[Profile1]\nName=work\nIsRelative=1\nPath=Profiles/work\n";
        let got = parse_firefox_ini(text);
        assert_eq!(got.len(), 2);
        assert_eq!(got[0].name, "default-release");
        assert_eq!(got[1].name, "work");
    }

    #[test]
    fn chromium_from_local_state() {
        let root = scratch();
        let chrome = root.join("Library/Application Support/Google/Chrome");
        fs::create_dir_all(chrome.join("Default")).unwrap();
        fs::write(
            chrome.join("Local State"),
            r#"{"profile":{"info_cache":{"Default":{"name":"Person 1"},"Profile 1":{"name":"Arbeit"}}}}"#,
        )
        .unwrap();
        let apps = root.join("Applications");
        fs::create_dir_all(apps.join("Google Chrome.app")).unwrap();
        let cards = list_browser_cards(&root, &[apps.as_path()]);
        let chrome_card = cards.iter().find(|c| c.id == "chrome").expect("chrome");
        assert_eq!(chrome_card.profiles.len(), 2);
        let names: Vec<_> = chrome_card.profiles.iter().map(|p| p.name.as_str()).collect();
        assert!(names.contains(&"Person 1"));
        assert!(names.contains(&"Arbeit"));
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn chromium_skips_system_and_guest_profiles() {
        let root = scratch();
        let chrome = root.join("Library/Application Support/Google/Chrome");
        fs::create_dir_all(chrome.join("Default")).unwrap();
        fs::write(
            chrome.join("Local State"),
            r#"{"profile":{"info_cache":{"Default":{"name":"Person 1"},"System Profile":{"name":"System Profile"},"Guest Profile":{"name":"Gast"}}}}"#,
        )
        .unwrap();
        let apps = root.join("Applications");
        fs::create_dir_all(apps.join("Google Chrome.app")).unwrap();
        let cards = list_browser_cards(&root, &[apps.as_path()]);
        let chrome_card = cards.iter().find(|c| c.id == "chrome").expect("chrome");
        let names: Vec<_> = chrome_card.profiles.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, ["Person 1"]);
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn missing_browser_is_absent() {
        let root = scratch();
        let cards = list_browser_cards(&root, &[]);
        assert!(cards.iter().all(|c| c.id != "chrome"));
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn chromium_profile_rejects_parent_dir() {
        let home = scratch();
        let err = chromium_profile_dir(&home, "chrome", "../evil").unwrap_err();
        assert!(err.contains(".."), "{err}");
        fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn firefox_profile_rejects_absolute_path_outside_data_dir() {
        let home = scratch();
        let err = firefox_profile_dir(&home, "firefox", "/tmp/not-firefox").unwrap_err();
        assert!(err.contains("outside"), "{err}");
        let ok = firefox_profile_dir(&home, "firefox", "Profiles/abcd.default").unwrap();
        assert!(ok.ends_with("Profiles/abcd.default"));
        fs::remove_dir_all(&home).ok();
    }
}
