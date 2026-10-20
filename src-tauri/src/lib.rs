use std::{sync::Mutex, time::Duration};

use tauri::{Manager, RunEvent, WindowEvent};

mod browser_passwords;
mod browsers;
mod core_bind;
mod firefox_logins;
mod loopback;
mod process;
mod process_inspect;
mod prompts;
mod secret_fs;
mod sidecar_http;
mod sidecar_target;
mod sleep;
mod tray;

use loopback::{prepare_loopback_core, wait_our_core};
use process::{kill_core, spawn_core, CoreProcess};
use prompts::{deny_closed_prompt, PromptState};
use sleep::watch_desktop_lock;
use tray::show_main;

include!("command_contract.rs");

macro_rules! command_handler {
    ($($module:ident::$command:ident),* $(,)?) => {
        tauri::generate_handler![$($module::$command),*]
    };
}

fn app_command_handler() -> impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static {
    app_commands!(command_handler)
}

#[cfg(feature = "native-acl-probe")]
mod native_acl_probe;
#[cfg(feature = "native-network-probe")]
mod native_network_probe;
#[cfg(test)]
mod test_http_fixture;
#[cfg(feature = "native-acl-probe")]
pub use native_acl_probe::run as run_native_acl_probe;

fn start_hidden() -> bool {
    std::env::args().any(|arg| arg == "--hidden")
}

#[cfg(feature = "native-acl-probe")]
pub fn run() {
    panic!("native-acl-probe is test-only; use fourallpass-acl-probe");
}

#[cfg(not(feature = "native-acl-probe"))]
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .manage(CoreProcess(Mutex::new(None)))
        .manage(PromptState(Mutex::new(None)))
        .invoke_handler(app_command_handler())
        .setup(|app| {
            if start_hidden() {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            if let Err(msg) = prepare_loopback_core() {
                eprintln!("{msg}");
                std::process::exit(1);
            }
            let child = spawn_core()?;
            let child_pid = child.id();
            *app.state::<CoreProcess>()
                .0
                .lock()
                .map_err(|err| err.to_string())? = Some(child);
            if let Err(msg) = wait_our_core(child_pid, Duration::from_secs(45)) {
                eprintln!("{msg}");
                kill_core(&app.handle());
                std::process::exit(1);
            }
            if !start_hidden() {
                show_main(&app.handle());
            }
            // UI stays on the bundled frontendDist. Never navigate the webview
            // to the sidecar origin — that would grant Tauri IPC to whoever
            // holds port 8788.
            tray::install(app)?;
            watch_desktop_lock(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
                if window.label() == "access-prompt" {
                    deny_closed_prompt(window.app_handle());
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building 4AllPass");

    app.run(|app, event| match event {
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => show_main(app),
        RunEvent::Ready => {
            if !start_hidden() {
                show_main(app);
            }
        }
        RunEvent::Exit => kill_core(app),
        _ => {}
    });
}
