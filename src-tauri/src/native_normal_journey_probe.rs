//! Debug-only driver around the ordinary run/setup/sidecar lifecycle.
//! No product commands, API stubs, account injection or user profile discovery.
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Mutex, OnceLock,
    },
    time::{Duration, Instant},
};
use tauri::{
    webview::{DownloadEvent, PageLoadEvent},
    Manager, WebviewWindowBuilder,
};

static ROOT: OnceLock<PathBuf> = OnceLock::new();
static COMMANDS: Mutex<BTreeMap<String, u64>> = Mutex::new(BTreeMap::new());
static REQUESTED: AtomicBool = AtomicBool::new(false);
static DOWNLOADED: AtomicBool = AtomicBool::new(false);
static DOWNLOAD_URL: OnceLock<String> = OnceLock::new();

fn root() -> &'static PathBuf {
    ROOT.get().expect("initialize fixture before normal run")
}
pub(crate) fn assert_initialized() {
    let _ = root();
}
pub(crate) fn fixture_home() -> PathBuf {
    root().join("browser-fixture")
}
pub(crate) fn record_command(name: &str) -> bool {
    // Arguments, bodies, headers, tokens, keys and results are never recorded.
    *COMMANDS.lock().unwrap().entry(name.to_owned()).or_default() += 1;
    matches!(
        name,
        "sidecar_http" | "list_browser_profiles" | "access_dismiss"
    )
}

pub fn run() {
    assert!(cfg!(debug_assertions), "debug-only probe");
    assert_eq!(
        std::env::args().count(),
        2,
        "fresh private task directory required"
    );
    let task = PathBuf::from(std::env::args().nth(1).unwrap());
    assert!(task.is_absolute());
    fs::create_dir(&task).expect("refuse existing task/profile directory");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&task, fs::Permissions::from_mode(0o700)).unwrap();
    }
    ROOT.set(task).unwrap();
    fs::create_dir(fixture_home()).unwrap();
    assert_eq!(
        std::env::var_os("FOURALLPASS_DATA_DIR"),
        Some(root().join("data").into_os_string())
    );
    assert!(
        crate::process::bundled_core().is_some(),
        "private sibling sidecar required; no npm fallback"
    );
    // Config is validated before any normal setup or browser discovery.
    let context: tauri::Context<tauri::Wry> = tauri::generate_context!();
    let config = context.config();
    assert_eq!(
        config.identifier,
        "de.netzwerkpunkt.fourallpass.normal-journey-probe"
    );
    assert!(config.build.dev_url.is_none());
    assert_eq!(config.app.windows.len(), 1);
    let main = &config.app.windows[0];
    assert_eq!(main.label, "main");
    assert!(main.incognito && !main.create);
    assert!(!std::env::args().any(|arg| arg == "--hidden"));
    crate::run();
}

pub(crate) fn attach(app: &mut tauri::App, child_pid: u32) -> tauri::Result<()> {
    // Same configured main/capabilities/assets; explicit construction adds only
    // the private download destination and DOM driver. Core ownership already passed.
    let config = app.config().app.windows[0].clone();
    WebviewWindowBuilder::from_config(app, &config)?
        .on_navigation(|url| {
            (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
                || url.as_str().starts_with("blob:tauri://localhost/")
        })
        .on_download(|_, event| {
            match event {
                DownloadEvent::Requested { url, destination } => {
                    if url.scheme() != "blob" || REQUESTED.swap(true, Ordering::SeqCst) {
                        return false;
                    }
                    let _ = DOWNLOAD_URL.set(url.to_string());
                    *destination = root().join("recovery-kit.txt");
                }
                DownloadEvent::Finished { url, path, success } => {
                    let expected = root().join("recovery-kit.txt");
                    // Pinned Wry WKWebView reports no path on completion. Bind
                    // the actual success callback to the exact requested Blob
                    // and its fresh private destination instead.
                    let path_matches = path
                        .as_ref()
                        .map(|p| p == &expected)
                        .unwrap_or(cfg!(target_os = "macos"));
                    let regular = fs::symlink_metadata(&expected)
                        .map(|m| m.is_file() && (128..=4096).contains(&m.len()))
                        .unwrap_or(false);
                    let valid = success
                        && path_matches
                        && regular
                        && DOWNLOAD_URL.get().map(String::as_str) == Some(url.as_str());
                    #[cfg(unix)]
                    if valid {
                        use std::os::unix::fs::PermissionsExt;
                        let _ = fs::set_permissions(&expected, fs::Permissions::from_mode(0o600));
                    }
                    DOWNLOADED.store(valid, Ordering::SeqCst);
                }
                _ => return false,
            }
            true
        })
        .on_page_load(|window, payload| {
            if payload.event() == PageLoadEvent::Finished {
                let _ = window.eval(include_str!("../tests/native-normal-journey.js"));
            }
        })
        .build()?;
    let handle = app.handle().clone();
    std::thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(150);
        let mut outcome = json!({"done":false,"stage":"driver-timeout"});
        let mut listener_pid = None;
        while Instant::now() < deadline {
            listener_pid = listener_pid
                .or_else(|| crate::process_inspect::loopback_listen_pid(crate::process::CORE_PORT));
            let Some(window) = handle.get_webview_window("main") else {
                break;
            };
            let downloaded = DOWNLOADED.load(Ordering::SeqCst);
            let (tx, rx) = mpsc::channel();
            let script = format!("window.__NORMAL_KIT_DOWNLOADED__={downloaded};JSON.stringify(window.__NORMAL_JOURNEY__||null)");
            let _ = window.eval_with_callback(script, move |value| {
                let _ = tx.send(value);
            });
            if let Ok(raw) = rx.recv_timeout(Duration::from_secs(1)) {
                if let Ok(Value::String(encoded)) = serde_json::from_str::<Value>(&raw) {
                    if let Ok(value) = serde_json::from_str::<Value>(&encoded) {
                        if value["done"] == true {
                            outcome = value;
                            break;
                        }
                    }
                }
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        let fixture_empty = fs::read_dir(fixture_home())
            .map(|mut d| d.next().is_none())
            .unwrap_or(false);
        let commands = COMMANDS.lock().unwrap().clone();
        let allowed = commands.keys().all(|c| {
            matches!(
                c.as_str(),
                "sidecar_http" | "list_browser_profiles" | "access_dismiss"
            )
        });
        let passed = outcome["passed"] == true
            && DOWNLOADED.load(Ordering::SeqCst)
            && fixture_empty
            && allowed
            && commands.get("list_browser_profiles").copied().unwrap_or(0) > 0
            && commands.get("sidecar_http").copied().unwrap_or(0) > 0;
        let result = json!({"passed":passed,"native":"WKWebView","normalSetupCalled":true,
            "normalChildOwnershipCheckPassed":true,"childPid":child_pid,"listenerPid":listener_pid,
            "privateDataDir":root().join("data"),"incognito":true,"browserFixtureEmpty":fixture_empty,
            "kitDownloadFinished":DOWNLOADED.load(Ordering::SeqCst),"commands":commands,"ui":outcome,
            "testOnlyRestriction":"refuse any preexisting port occupant; normal reap policy not exercised"});
        fs::write(
            root().join("native-result.json"),
            serde_json::to_vec_pretty(&result).unwrap(),
        )
        .unwrap();
        // Ordinary RunEvent::Exit owns child cleanup. Do not hide/close-only.
        handle.exit(if passed { 0 } else { 1 });
    });
    Ok(())
}
