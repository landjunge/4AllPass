use std::{
    net::TcpStream,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_notification::NotificationExt;

const CORE_HOST: &str = "127.0.0.1";
const CORE_PORT: u16 = 8788;
const CORE_ORIGIN: &str = "http://127.0.0.1:8788";

struct CoreProcess(Mutex<Option<Child>>);
struct PromptState(Mutex<Option<String>>);

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

fn core_up() -> bool {
    TcpStream::connect((CORE_HOST, CORE_PORT)).is_ok()
}

fn wait_core(timeout: Duration) -> bool {
    let started = Instant::now();
    while started.elapsed() < timeout {
        if core_up() {
            return true;
        }
        thread::sleep(Duration::from_millis(100));
    }
    false
}

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri is inside the repo")
        .to_path_buf()
}

fn sidecar_triple() -> &'static str {
    if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        "aarch64-apple-darwin"
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        "x86_64-apple-darwin"
    } else if cfg!(all(target_os = "windows", target_arch = "aarch64")) {
        "aarch64-pc-windows-msvc"
    } else if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        "x86_64-pc-windows-msvc"
    } else if cfg!(all(target_os = "linux", target_arch = "aarch64")) {
        "aarch64-unknown-linux-gnu"
    } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        "x86_64-unknown-linux-gnu"
    } else {
        "unknown"
    }
}

fn bundled_core() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    for name in ["fourallpass-core", "fourallpass-core.exe"] {
        let beside = dir.join(name);
        if beside.is_file() {
            return Some(beside);
        }
    }
    None
}

fn repo_core() -> Option<PathBuf> {
    let triple = sidecar_triple();
    let dir = repo_root().join("src-tauri/binaries");
    for name in [
        format!("fourallpass-core-{triple}"),
        format!("fourallpass-core-{triple}.exe"),
    ] {
        let path = dir.join(name);
        if path.is_file() {
            return Some(path);
        }
    }
    None
}

fn spawn_core_command(bin: PathBuf) -> Command {
    let mut command = Command::new(bin);
    command.stdin(Stdio::null()).stdout(Stdio::inherit()).stderr(Stdio::inherit());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

fn spawn_core() -> Result<Child, String> {
    if let Some(bin) = bundled_core().or_else(repo_core) {
        return spawn_core_command(bin)
            .spawn()
            .map_err(|err| format!("spawn bundled core: {err}"));
    }
    let root = repo_root();
    Command::new("npm")
        .current_dir(&root)
        .args(["run", "app:sidecar"])
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|err| format!("spawn local core: {err}"))
}

fn kill_core(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<CoreProcess>() {
        if let Ok(mut slot) = state.0.lock() {
            if let Some(mut child) = slot.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

fn start_hidden() -> bool {
    std::env::args().any(|arg| arg == "--hidden")
}

/// Ask the unlocked UI to zeroize the Vault Key. Not disk encryption.
const DESKTOP_LOCK_EVENT: &str = "desktop-lock";

#[cfg(target_os = "macos")]
fn watch_desktop_lock(app: tauri::AppHandle) {
    thread::spawn(move || {
        #[link(name = "System", kind = "dylib")]
        extern "C" {
            fn notify_register_check(name: *const i8, out_token: *mut i32) -> u32;
            fn notify_check(token: i32, out_flag: *mut i32) -> u32;
            fn notify_get_state(token: i32, out_state: *mut u64) -> u32;
        }

        fn register(name: &[u8]) -> Option<i32> {
            let mut token = 0i32;
            let status = unsafe { notify_register_check(name.as_ptr() as *const i8, &mut token) };
            (status == 0).then_some(token)
        }

        let screen = register(b"com.apple.screenIsLocked\0");
        let sleep = register(b"com.apple.system.sleep\0");
        let mut announced = false;
        loop {
            thread::sleep(Duration::from_millis(400));
            let mut lock_now = false;
            if let Some(token) = screen {
                let mut state = 0u64;
                if unsafe { notify_get_state(token, &mut state) } == 0 && state != 0 {
                    lock_now = true;
                }
            }
            if let Some(token) = sleep {
                let mut flag = 0i32;
                if unsafe { notify_check(token, &mut flag) } == 0 && flag != 0 {
                    lock_now = true;
                }
            }
            if lock_now {
                if !announced {
                    let _ = app.emit(DESKTOP_LOCK_EVENT, ());
                    announced = true;
                }
            } else {
                announced = false;
            }
        }
    });
}

#[cfg(not(target_os = "macos"))]
fn watch_desktop_lock(_app: tauri::AppHandle) {}

fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
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

fn deny_closed_prompt(app: &tauri::AppHandle) {
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
    let url = format!(
        "{CORE_ORIGIN}/access-prompt.html?id={}&application={}&provider={}&scope={}&ttl={}",
        percent_encode(request_id),
        percent_encode(application),
        percent_encode(provider),
        percent_encode(scope),
        ttl_seconds
    );
    let parsed = url.parse().map_err(|err| format!("prompt url: {err}"))?;
    if let Some(window) = app.get_webview_window("access-prompt") {
        window.navigate(parsed).map_err(|err| err.to_string())?;
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }
    WebviewWindowBuilder::new(app, "access-prompt", WebviewUrl::External(parsed))
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
fn access_prompt(
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
fn access_decide(app: tauri::AppHandle, request_id: String, allow: bool) -> Result<(), String> {
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
fn access_dismiss(app: tauri::AppHandle) -> Result<(), String> {
    let _ = take_prompt_id(&app);
    hide_prompt(&app);
    Ok(())
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
            access_prompt,
            access_decide,
            access_dismiss
        ])
        .setup(|app| {
            if start_hidden() {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            if !core_up() {
                let child = spawn_core()?;
                *app.state::<CoreProcess>()
                    .0
                    .lock()
                    .map_err(|err| err.to_string())? = Some(child);
            }
            if !wait_core(Duration::from_secs(45)) {
                return Err("4AllPass local core did not bind 127.0.0.1:8788".into());
            }
            if let Some(window) = app.get_webview_window("main") {
                let url = CORE_ORIGIN.parse()?;
                window.navigate(url)?;
                if start_hidden() {
                    let _ = window.hide();
                }
            }
            let show = MenuItem::with_id(app, "show", "Anzeigen / Show", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Beenden / Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let mut tray = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => show_main(app),
                    "quit" => {
                        kill_core(app);
                        app.exit(0);
                    }
                    _ => {}
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
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

    app.run(|app, event| {
        if let RunEvent::Exit = event {
            kill_core(app);
        }
    });
}
