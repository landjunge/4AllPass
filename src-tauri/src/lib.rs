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
mod sleep;
mod sleep_stall;
mod tray;

use loopback::prepare_loopback_core;
use process::{kill_core, spawn_core, wait_core, CoreProcess};
use prompts::{deny_closed_prompt, PromptState};
use sidecar_http::sidecar_http;
use sleep::watch_desktop_lock;
use tray::show_main;

fn start_hidden() -> bool {
    std::env::args().any(|arg| arg == "--hidden")
}

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
        .invoke_handler(tauri::generate_handler![
            prompts::access_prompt,
            prompts::access_decide,
            prompts::access_dismiss,
            sidecar_http,
            browsers::list_browser_profiles,
            browsers::extension_install,
            browsers::open_browser_for_extension,
            browsers::open_autofill_demo,
            browser_passwords::import_browser_logins
        ])
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
            *app.state::<CoreProcess>()
                .0
                .lock()
                .map_err(|err| err.to_string())? = Some(child);
            if !wait_core(Duration::from_secs(45)) {
                eprintln!("4AllPass local core did not bind 127.0.0.1:8788");
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
