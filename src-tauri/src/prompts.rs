use std::sync::Mutex;

use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_notification::NotificationExt;

use crate::tray::show_main;

/// Ask the unlocked UI to zeroize the Vault Key. Not disk encryption.
const DESKTOP_LOCK_EVENT: &str = "desktop-lock";

pub struct PromptState(pub Mutex<Option<String>>);

#[derive(Clone, serde::Serialize)]
struct AccessDecision {
    #[serde(rename = "requestId")]
    request_id: String,
    allow: bool,
}

fn percent_encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char);
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn hide_prompt(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("access-prompt") {
        let _ = window.hide();
    }
}

fn take_prompt_id(app: &tauri::AppHandle) -> Option<String> {
    app.try_state::<PromptState>()
        .and_then(|state| state.0.lock().ok().and_then(|mut slot| slot.take()))
}

pub fn deny_closed_prompt(app: &tauri::AppHandle) {
    if let Some(request_id) = take_prompt_id(app) {
        let _ = app.emit(
            "access-decision",
            AccessDecision {
                request_id,
                allow: false,
            },
        );
    }
}

pub fn emit_desktop_lock(app: &tauri::AppHandle) {
    hide_prompt(app);
    deny_closed_prompt(app);
    let _ = app.emit(DESKTOP_LOCK_EVENT, ());
}

fn open_prompt_window(
    app: &tauri::AppHandle,
    request_id: &str,
    application: &str,
    provider: &str,
    scope: &str,
    ttl_seconds: u32,
) -> Result<(), String> {
    if let Ok(mut slot) = app.state::<PromptState>().0.lock() {
        *slot = Some(request_id.to_string());
    }
    let path = format!(
        "access-prompt.html?id={}&application={}&provider={}&scope={}&ttl={}",
        percent_encode(request_id),
        percent_encode(application),
        percent_encode(provider),
        percent_encode(scope),
        ttl_seconds
    );
    if let Some(window) = app.get_webview_window("access-prompt") {
        let _ = window.close();
    }
    WebviewWindowBuilder::new(app, "access-prompt", WebviewUrl::App(path.into()))
        .title("4AllPass — Zugriff / Access")
        .inner_size(460.0, 360.0)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(true)
        .center()
        .build()
        .map_err(|err| err.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn access_prompt(
    app: tauri::AppHandle,
    request_id: String,
    application: String,
    provider: String,
    scope: Vec<String>,
    ttl_seconds: u32,
) -> Result<(), String> {
    show_main(&app);
    let caps = scope.join(", ");
    let body = format!("{application} · {provider} · {caps} · {ttl_seconds}s");
    let _ = app
        .notification()
        .builder()
        .title("4AllPass — Access request / Zugriff")
        .body(&body)
        .show();
    open_prompt_window(
        &app,
        &request_id,
        &application,
        &provider,
        &caps,
        ttl_seconds,
    )
}

#[tauri::command]
pub fn access_decide(app: tauri::AppHandle, request_id: String, allow: bool) -> Result<(), String> {
    let _ = take_prompt_id(&app);
    hide_prompt(&app);
    app.emit(
        "access-decision",
        AccessDecision {
            request_id,
            allow,
        },
    )
    .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn access_dismiss(app: tauri::AppHandle) -> Result<(), String> {
    let _ = take_prompt_id(&app);
    hide_prompt(&app);
    Ok(())
}
