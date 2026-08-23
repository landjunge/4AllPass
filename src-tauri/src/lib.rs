use std::{
    net::TcpStream,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant, SystemTime},
};

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_notification::NotificationExt;

mod browser_passwords;
mod browsers;
mod firefox_logins;
mod sleep_stall;
use sleep_stall::slept_through;

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
const LOCK_POLL: Duration = Duration::from_millis(400);
const SLEEP_STALL: Duration = Duration::from_secs(5);

fn emit_desktop_lock(app: &tauri::AppHandle) {
    hide_prompt(app);
    deny_closed_prompt(app);
    let _ = app.emit(DESKTOP_LOCK_EVENT, ());
}

#[cfg(target_os = "macos")]
struct OsLockProbe {
    screen: Option<i32>,
    sleep: Option<i32>,
}

#[cfg(target_os = "macos")]
impl OsLockProbe {
    fn new() -> Self {
        #[link(name = "System", kind = "dylib")]
        extern "C" {
            fn notify_register_check(name: *const i8, out_token: *mut i32) -> u32;
        }
        fn register(name: &[u8]) -> Option<i32> {
            let mut token = 0i32;
            let status = unsafe { notify_register_check(name.as_ptr() as *const i8, &mut token) };
            (status == 0).then_some(token)
        }
        Self {
            screen: register(b"com.apple.screenIsLocked\0"),
            sleep: register(b"com.apple.system.sleep\0"),
        }
    }

    fn is_locked(&self) -> bool {
        #[link(name = "System", kind = "dylib")]
        extern "C" {
            fn notify_check(token: i32, out_flag: *mut i32) -> u32;
            fn notify_get_state(token: i32, out_state: *mut u64) -> u32;
        }
        if let Some(token) = self.screen {
            let mut state = 0u64;
            if unsafe { notify_get_state(token, &mut state) } == 0 && state != 0 {
                return true;
            }
        }
        if let Some(token) = self.sleep {
            let mut flag = 0i32;
            if unsafe { notify_check(token, &mut flag) } == 0 && flag != 0 {
                return true;
            }
        }
        false
    }
}

#[cfg(target_os = "windows")]
struct OsLockProbe;

#[cfg(target_os = "windows")]
impl OsLockProbe {
    fn new() -> Self {
        Self
    }

    fn is_locked(&self) -> bool {
        const DESKTOP_SWITCHDESKTOP: u32 = 0x0100;
        #[link(name = "user32")]
        extern "system" {
            fn OpenInputDesktop(
                flags: u32,
                inherit: i32,
                desired_access: u32,
            ) -> *mut core::ffi::c_void;
            fn CloseDesktop(desktop: *mut core::ffi::c_void) -> i32;
        }
        unsafe {
            let desk = OpenInputDesktop(0, 0, DESKTOP_SWITCHDESKTOP);
            if desk.is_null() {
                true
            } else {
                CloseDesktop(desk);
                false
            }
        }
    }
}

#[cfg(target_os = "linux")]
struct OsLockProbe {
    session: Option<String>,
    last: std::cell::Cell<Option<Instant>>,
    cached: std::cell::Cell<bool>,
}

#[cfg(target_os = "linux")]
impl OsLockProbe {
    fn new() -> Self {
        Self {
            session: std::env::var("XDG_SESSION_ID").ok().filter(|s| !s.is_empty()),
            last: std::cell::Cell::new(None),
            cached: std::cell::Cell::new(false),
        }
    }

    fn is_locked(&self) -> bool {
        if let Some(prev) = self.last.get() {
            if prev.elapsed() < Duration::from_secs(1) {
                return self.cached.get();
            }
        }
        self.last.set(Some(Instant::now()));
        let mut cmd = Command::new("loginctl");
        cmd.arg("show-session");
        if let Some(id) = self.session.as_deref() {
            cmd.arg(id);
        } else {
            cmd.arg("self");
        }
        cmd.args(["-p", "LockedHint", "--value"])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        let locked = cmd
            .output()
            .ok()
            .map(|out| {
                String::from_utf8_lossy(&out.stdout)
                    .trim()
                    .eq_ignore_ascii_case("yes")
            })
            .unwrap_or(false);
        self.cached.set(locked);
        locked
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
struct OsLockProbe;

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
impl OsLockProbe {
    fn new() -> Self {
        Self
    }

    fn is_locked(&self) -> bool {
        false
    }
}

fn watch_desktop_lock(app: tauri::AppHandle) {
    thread::spawn(move || {
        let probe = OsLockProbe::new();
        let mut announced = false;
        let mut last_tick = SystemTime::now();
        loop {
            thread::sleep(LOCK_POLL);
            let now = SystemTime::now();
            let stalled = slept_through(last_tick, now, SLEEP_STALL);
            last_tick = now;
            if stalled || probe.is_locked() {
                if !announced {
                    emit_desktop_lock(&app);
                    announced = true;
                }
            } else {
                announced = false;
            }
        }
    });
}

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
            access_dismiss,
            browsers::list_browser_profiles,
            browsers::extension_install,
            browsers::open_browser_for_extension,
            browser_passwords::import_browser_logins
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

