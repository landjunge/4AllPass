//! Opt-in native WKWebView test entry. Never calls run()/sidecar/tray setup.
use serde_json::{json, Value};
use std::sync::atomic::{AtomicI32, Ordering};
use std::{
    fs,
    path::PathBuf,
    sync::{mpsc, Mutex, OnceLock},
    time::{Duration, Instant},
};
use tauri::{Listener, Manager, WebviewUrl, WebviewWindowBuilder};

static ORACLE_EXIT: AtomicI32 = AtomicI32::new(2);
static HOME_FIXTURE: OnceLock<PathBuf> = OnceLock::new();
pub(crate) fn fixture_home() -> PathBuf {
    HOME_FIXTURE
        .get()
        .expect("native probe must initialize its private fixture")
        .clone()
}

pub fn run() {
    let report = PathBuf::from(
        std::env::args()
            .nth(1)
            .expect("private report path required"),
    );
    let root = report
        .parent()
        .expect("report parent")
        .join("browser-fixture");
    // create_dir (not create_dir_all) refuses reuse of a real/existing profile.
    fs::create_dir(&root).expect("fresh empty private browser fixture required");
    HOME_FIXTURE.set(root.clone()).unwrap();
    let context = tauri::generate_context!();
    assert_eq!(
        context.config().identifier,
        "de.netzwerkpunkt.fourallpass.acl-probe"
    );
    assert!(
        context.config().app.windows.is_empty(),
        "no automatic normal main window"
    );
    assert!(
        context.config().build.dev_url.is_none(),
        "bundled private assets only"
    );
    let app = tauri::Builder::default()
        .manage(crate::prompts::PromptState(Mutex::new(Some("h3-synthetic".into()))))
        .invoke_handler(crate::app_command_handler())
        .setup(move |app| {
            let (event_tx, event_rx) = mpsc::channel();
            app.listen("access-decision", move |event| {
                let _ = event_tx.send(event.payload().to_owned());
            });
            let commands = serde_json::to_string(crate::APP_COMMAND_NAMES)?;
            for label in ["main", "access-prompt", "h3-untrusted"] {
                let script = include_str!("../tests/native-acl-probe.js")
                    .replace("__COMMAND_NAMES__", &commands)
                    .replace("__WINDOW_LABEL__", &serde_json::to_string(label)?);
                WebviewWindowBuilder::new(app, label,
                    WebviewUrl::App("access-prompt.html?id=h3-synthetic&application=synthetic&provider=fixture&scope=none&ttl=1".into()))
                    .title(format!("4AllPass H3 probe — {label}"))
                    .incognito(true)
                    .inner_size(460.0, 360.0)
                    .on_page_load(move |window, payload| {
                        if payload.event() == tauri::webview::PageLoadEvent::Finished {
                            window.eval(script.clone()).expect("inject real IPC probe");
                        }
                    })
                    .build()?;
            }
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let mut windows = serde_json::Map::new();
                let deadline = Instant::now() + Duration::from_secs(25);
                while windows.len() < 3 && Instant::now() < deadline {
                    for label in ["main", "access-prompt", "h3-untrusted"] {
                        if windows.contains_key(label) { continue; }
                        let Some(window) = handle.get_webview_window(label) else { continue; };
                        let (tx, rx) = mpsc::channel();
                        let _ = window.eval_with_callback(
                            "JSON.stringify(window.__H3_PROBE__ || null)",
                            move |value| { let _ = tx.send(value); },
                        );
                        if let Ok(raw) = rx.recv_timeout(Duration::from_secs(1)) {
                            if let Ok(Value::String(encoded)) = serde_json::from_str::<Value>(&raw) {
                                if let Ok(value) = serde_json::from_str::<Value>(&encoded) {
                                    if value.get("done").and_then(Value::as_bool) == Some(true) {
                                        windows.insert(label.into(), value);
                                    }
                                }
                            }
                        }
                    }
                    std::thread::sleep(Duration::from_millis(50));
                }
                let event = event_rx.recv_timeout(Duration::from_secs(1)).ok();
                let fixture_empty = fs::read_dir(&root).map(|mut rows| rows.next().is_none()).unwrap_or(false);
                let passed = fixture_empty && windows.len() == 3 && windows.values().all(|w| w["passed"] == true)
                    && event.as_deref().and_then(|s| serde_json::from_str::<Value>(s).ok())
                        == Some(json!({"requestId":"h3-synthetic", "allow":false}));
                let result = json!({"native":"WKWebView", "passed":passed,
                    "commands":crate::APP_COMMAND_NAMES, "windows":windows,
                    "decisionEvent":event, "normalSetupCalled":false,
                    "browserFixtureEmpty":fixture_empty,
                    "persistentWebviewStore":false});
                fs::write(&report, serde_json::to_vec_pretty(&result).unwrap()).expect("write probe receipt");
                ORACLE_EXIT.store(if passed { 0 } else { 1 }, Ordering::SeqCst);
                for window in handle.webview_windows().values() { let _ = window.destroy(); }
                fs::remove_dir(&root).expect("remove empty private fixture");
                handle.exit(if passed { 0 } else { 1 });
            });
            Ok(())
        })
        .build(context)
        .expect("build native ACL probe");
    app.run_return(|_, event| {
        if let tauri::RunEvent::ExitRequested {
            code: None, api, ..
        } = event
        {
            // Destroying the last probe window must not race the oracle's
            // explicit success/failure exit status.
            api.prevent_exit();
        }
    });
    std::process::exit(ORACLE_EXIT.load(Ordering::SeqCst));
}
