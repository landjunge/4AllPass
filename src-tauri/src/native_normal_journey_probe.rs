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

fn copy_dir(from: &std::path::Path, to: &std::path::Path) -> std::io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
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
    // Fail closed before parsing/creating the task dir or spawning a sidecar.
    crate::process::configure_test_core_port().expect("private test core port required");
    if let Ok(mode) = std::env::var("FOURALLPASS_NATIVE_SNAPSHOT_FAULT") {
        assert!(
            matches!(mode.as_str(), "none" | "get" | "post" | "both"),
            "invalid FOURALLPASS_NATIVE_SNAPSHOT_FAULT"
        );
    }
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
    if let Ok(seed) = std::env::var("FOURALLPASS_NATIVE_SEED_DATA") {
        let seed = PathBuf::from(seed);
        assert!(seed.is_absolute(), "seed data dir must be absolute");
        assert!(seed.is_dir(), "seed data dir must exist");
        copy_dir(&seed, &root().join("data")).expect("copy synthetic seed data");
    }
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

fn listener_is_owned(listener_pid: u32, child_pid: u32) -> bool {
    if listener_pid == child_pid {
        return true;
    }
    let mut pid = listener_pid;
    for _ in 0..8 {
        let Some((ppid, _)) = crate::process_inspect::parent_and_command(pid) else {
            return false;
        };
        if ppid == child_pid {
            return true;
        }
        if ppid <= 1 {
            return false;
        }
        pid = ppid;
    }
    false
}

fn restart_own_sidecar(handle: &tauri::AppHandle, original_child_pid: u32) -> Option<u32> {
    if crate::process::core_up()
        || crate::process_inspect::loopback_listen_pid(crate::process::core_port()).is_some()
    {
        return None;
    }
    let Ok(child) = crate::process::spawn_core() else {
        return None;
    };
    let pid = child.id();
    if pid == original_child_pid {
        return None;
    }
    if let Some(state) = handle.try_state::<crate::CoreProcess>() {
        if let Ok(mut slot) = state.0.lock() {
            *slot = Some(child);
        }
    }
    crate::loopback::wait_our_core(pid, Duration::from_secs(20))
        .ok()
        .map(|_| pid)
}

pub(crate) fn attach(app: &mut tauri::App, child_pid: u32) -> tauri::Result<()> {
    // Same configured main/capabilities/assets; explicit construction adds only
    // the private download destination and DOM driver. Core ownership already passed.
    let scenario = std::env::var("FOURALLPASS_NATIVE_SCENARIO")
        .unwrap_or_else(|_| "normal".to_owned());
    let base_script: &'static str = match scenario.as_str() {
        "normal" => include_str!("../tests/native-normal-journey.js"),
        "legacy-known" => concat!(
            "window.__NATIVE_SCENARIO_KIND__='known';\n",
            include_str!("../tests/native-legacy-common.js")
        ),
        "legacy-unknown-fields" => concat!(
            "window.__NATIVE_SCENARIO_KIND__='unknown-fields';\n",
            include_str!("../tests/native-legacy-common.js")
        ),
        "legacy-snapshot-fault" => concat!(
            "window.__NATIVE_SCENARIO_KIND__='snapshot-fault';\n",
            include_str!("../tests/native-legacy-common.js")
        ),
        other => panic!("unknown native scenario: {other}"),
    };
    let fixture_prefix = if scenario == "normal" {
        String::new()
    } else {
        let fixture = json!({
            "email": std::env::var("FOURALLPASS_NATIVE_ACCOUNT_EMAIL").unwrap_or_default(),
            "password": std::env::var("FOURALLPASS_NATIVE_ACCOUNT_PASSWORD").unwrap_or_default(),
            "vaultPassword": std::env::var("FOURALLPASS_NATIVE_VAULT_PASSWORD").unwrap_or_default(),
        });
        format!("window.__NATIVE_FIXTURE__={fixture};\n")
    };
    let driver_script = format!("{fixture_prefix}{base_script}");
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
        .on_page_load(move |window, payload| {
            if payload.event() == PageLoadEvent::Finished {
                let _ = window.eval(&driver_script);
            }
        })
        .build()?;
    let handle = app.handle().clone();
    let configured_csp = app.config().app.security.csp.clone();
    std::thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(150);
        let mut outcome = json!({"done":false,"stage":"driver-timeout"});
        let mut listener_pid = None;
        let mut own_sidecar_stopped = false;
        let mut own_sidecar_restarted = false;
        let mut restarted_child_pid: Option<u32> = None;
        while Instant::now() < deadline {
            listener_pid = listener_pid
                .or_else(|| crate::process_inspect::loopback_listen_pid(crate::process::core_port()));
            let Some(window) = handle.get_webview_window("main") else {
                break;
            };
            let downloaded = DOWNLOADED.load(Ordering::SeqCst);
            let (tx, rx) = mpsc::channel();
            let script = format!("window.__NORMAL_KIT_DOWNLOADED__={downloaded};JSON.stringify(window.__NORMAL_JOURNEY__||window.__NATIVE_MIGRATION__||null)");
            let _ = window.eval_with_callback(script, move |value| {
                let _ = tx.send(value);
            });
            if let Ok(raw) = rx.recv_timeout(Duration::from_secs(1)) {
                if let Ok(Value::String(encoded)) = serde_json::from_str::<Value>(&raw) {
                    if let Ok(value) = serde_json::from_str::<Value>(&encoded) {
                        let migration = scenario != "normal";
                        let phase = value["phase"].as_str().unwrap_or("");
                        let needs_stop = (scenario == "legacy-known" && phase == "before-post")
                            || (scenario == "legacy-unknown-fields" && phase == "before-offline");
                        if migration && needs_stop && !own_sidecar_stopped {
                            // Stop only the sidecar this probe spawned. The normal
                            // lifecycle owns it; no foreign listener is touched.
                            let owned = listener_pid
                                .map(|pid| listener_is_owned(pid, child_pid))
                                .unwrap_or(false);
                            let ack = if !owned {
                                "sidecar-stop-not-owned"
                            } else {
                                let _ = crate::process::kill_core(&handle);
                                let mut stopped = false;
                                let wait_started = Instant::now();
                                while Instant::now() < wait_started + Duration::from_secs(5) {
                                    if !crate::process::core_up()
                                        && crate::process_inspect::loopback_listen_pid(
                                            crate::process::core_port(),
                                        )
                                        .is_none()
                                    {
                                        stopped = true;
                                        break;
                                    }
                                    std::thread::sleep(Duration::from_millis(50));
                                }
                                own_sidecar_stopped = stopped;
                                if stopped {
                                    "sidecar-stopped"
                                } else {
                                    "sidecar-stop-failed"
                                }
                            };
                            let _ = window.eval(format!(
                                "if (window.__NATIVE_MIGRATION__) window.__NATIVE_MIGRATION__.ack='{ack}'"
                            ));
                        }
                        if scenario == "legacy-known"
                            && phase == "restart-sidecar"
                            && own_sidecar_restarted == false
                        {
                            restarted_child_pid = restart_own_sidecar(&handle, child_pid);
                            own_sidecar_restarted = restarted_child_pid.is_some();
                            let ack = if own_sidecar_restarted {
                                "sidecar-restarted"
                            } else {
                                "sidecar-restart-failed"
                            };
                            let _ = window.eval(format!(
                                "if (window.__NATIVE_MIGRATION__) window.__NATIVE_MIGRATION__.ack='{ack}'"
                            ));
                        }
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
        let migration = scenario != "normal";
        let normal_ok = DOWNLOADED.load(Ordering::SeqCst)
            && fixture_empty
            && commands.get("list_browser_profiles").copied().unwrap_or(0) > 0;
        let scenario_ok = match scenario.as_str() {
            "legacy-known" => own_sidecar_stopped && own_sidecar_restarted && fixture_empty,
            "legacy-unknown-fields" => own_sidecar_stopped && fixture_empty,
            "legacy-snapshot-fault" => fixture_empty,
            _ => normal_ok,
        };
        let passed = outcome["passed"] == true
            && allowed
            && commands.get("sidecar_http").copied().unwrap_or(0) > 0
            && scenario_ok;
        let result = json!({"passed":passed,"native":"WKWebView","scenario":scenario,
            "normalSetupCalled":true,"normalChildOwnershipCheckPassed":true,
            "childPid":child_pid,"listenerPid":listener_pid,
            "testPort":crate::process::core_port(),"portIsolation":"ephemeral-own",
            "ownSidecarStopped":own_sidecar_stopped,
            "ownSidecarRestarted":own_sidecar_restarted,
            "originalChildPid":child_pid,
            "restartedChildPid":restarted_child_pid,
            "restartSamePort":crate::process::core_port(),
            "restartSameData":root().join("data"),
            "restartLifecycle":"spawn_core+wait_our_core+CoreProcess",
            "snapshotRouteAttempts":{
                "get":crate::sidecar_http::snapshot_get_attempts(),
                "post":crate::sidecar_http::snapshot_post_attempts(),
            },
            "snapshotFault":std::env::var("FOURALLPASS_NATIVE_SNAPSHOT_FAULT").ok(),
            "seededData":std::env::var_os("FOURALLPASS_NATIVE_SEED_DATA").is_some(),
            "privateDataDir":root().join("data"),"incognito":true,"browserFixtureEmpty":fixture_empty,
            "kitDownloadFinished":DOWNLOADED.load(Ordering::SeqCst),"commands":commands,"ui":outcome,
            "configuredCsp":configured_csp,
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
