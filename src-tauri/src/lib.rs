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
mod core_bind;
mod firefox_logins;
mod secret_fs;
mod sleep_stall;
use core_bind::{
    classify_occupied, is_core_binary_name, is_ui_binary_name, Occupant, OccupiedKind,
};
use sleep_stall::{should_emit_desktop_lock, slept_through};

const CORE_HOST: &str = "127.0.0.1";
const CORE_PORT: u16 = 8788;

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
    command
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .env("FOURALLPASS_SIDECAR", "1");
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
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
                #[cfg(unix)]
                {
                    let pgid = child.id().to_string();
                    let _ = Command::new("kill")
                        .args(["-TERM", &format!("-{pgid}")])
                        .status();
                }
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

fn cmd_name(command: &str) -> String {
    PathBuf::from(command.split_whitespace().next().unwrap_or(""))
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("")
        .to_string()
}

fn ps_ppid_and_command(pid: u32) -> Option<(u32, String)> {
    let out = Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "ppid=", "-o", "command="])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let line = String::from_utf8_lossy(&out.stdout);
    let line = line.trim();
    let (ppid_s, rest) = line.split_once(char::is_whitespace)?;
    Some((ppid_s.trim().parse().ok()?, rest.trim().to_string()))
}

fn loopback_listen_pid() -> Option<u32> {
    for bin in ["lsof", "/usr/sbin/lsof"] {
        let Ok(out) = Command::new(bin)
            .args(["-nP", "-iTCP:127.0.0.1:8788", "-sTCP:LISTEN", "-t"])
            .output()
        else {
            continue;
        };
        if let Some(pid) = String::from_utf8_lossy(&out.stdout)
            .lines()
            .find_map(|line| line.trim().parse().ok())
        {
            return Some(pid);
        }
    }
    None
}

fn occupant_of(listen_pid: u32, our_core: Option<&PathBuf>) -> Occupant {
    let Some((mut pid, cmd)) = ps_ppid_and_command(listen_pid) else {
        return Occupant {
            ours: false,
            ui_parent_alive: false,
        };
    };
    let first = cmd.split_whitespace().next().unwrap_or("");
    let ours = our_core
        .map(|path| PathBuf::from(first) == *path)
        .unwrap_or(false)
        || is_core_binary_name(&cmd_name(&cmd));
    if !ours {
        return Occupant {
            ours: false,
            ui_parent_alive: false,
        };
    }
    let mut hops = 0;
    while pid > 1 && hops < 8 {
        hops += 1;
        let Some((next, parent_cmd)) = ps_ppid_and_command(pid) else {
            break;
        };
        if is_ui_binary_name(&cmd_name(&parent_cmd)) {
            return Occupant {
                ours: true,
                ui_parent_alive: true,
            };
        }
        pid = next;
    }
    Occupant {
        ours: true,
        ui_parent_alive: false,
    }
}

fn reap_our_core_chain(listen_pid: u32) {
    let mut pid = listen_pid;
    for _ in 0..8 {
        let Some((ppid, cmd)) = ps_ppid_and_command(pid) else {
            break;
        };
        let name = cmd_name(&cmd);
        if is_ui_binary_name(&name) {
            break;
        }
        if is_core_binary_name(&name) {
            let _ = Command::new("kill").args(["-TERM", &pid.to_string()]).status();
        }
        if ppid <= 1 {
            break;
        }
        pid = ppid;
    }
}

/// Occupied :8788 before *this* spawn. Never treat the occupant as the UI origin.
/// Leftover our-core (UI crashed) is killed. Foreign / live instance: clean exit,
/// not a Tauri setup panic (that was SIGABRT with no window).
fn prepare_loopback_core() -> Result<(), String> {
    if !core_up() {
        return Ok(());
    }
    let occupant = loopback_listen_pid().map(|pid| occupant_of(pid, bundled_core().as_ref()));
    match classify_occupied(true, occupant) {
        OccupiedKind::Free => Ok(()),
        OccupiedKind::OurOrphan => {
            if let Some(pid) = loopback_listen_pid() {
                reap_our_core_chain(pid);
            }
            let started = Instant::now();
            while core_up() && started.elapsed() < Duration::from_secs(2) {
                thread::sleep(Duration::from_millis(50));
            }
            if core_up() {
                Err("127.0.0.1:8788 is already bound by another process; refusing to treat it as 4AllPass".into())
            } else {
                Ok(())
            }
        }
        OccupiedKind::OurLive => {
            eprintln!("4AllPass läuft schon auf http://127.0.0.1:8788 / already running.");
            std::process::exit(0);
        }
        OccupiedKind::Foreign => Err(
            "127.0.0.1:8788 is already bound by another process; refusing to treat it as 4AllPass"
                .into(),
        ),
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

/// Sleep / Ruhemodus only. Screen lock (Win+L, Ctrl-Cmd-Q, logind LockedHint)
/// must not zeroize the vault — the user asked for manual lock or sleep.
#[cfg(target_os = "macos")]
struct OsSleepProbe {
    sleep: Option<i32>,
}

#[cfg(target_os = "macos")]
impl OsSleepProbe {
    fn new() -> Self {
        #[link(name = "System", kind = "dylib")]
        extern "C" {
            fn notify_register_check(name: *const i8, out_token: *mut i32) -> u32;
        }
        let mut token = 0i32;
        let status = unsafe {
            notify_register_check(b"com.apple.system.sleep\0".as_ptr() as *const i8, &mut token)
        };
        Self {
            sleep: (status == 0).then_some(token),
        }
    }

    fn went_to_sleep(&self) -> bool {
        #[link(name = "System", kind = "dylib")]
        extern "C" {
            fn notify_check(token: i32, out_flag: *mut i32) -> u32;
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

#[cfg(not(target_os = "macos"))]
struct OsSleepProbe;

#[cfg(not(target_os = "macos"))]
impl OsSleepProbe {
    fn new() -> Self {
        Self
    }

    fn went_to_sleep(&self) -> bool {
        false
    }
}

fn watch_desktop_lock(app: tauri::AppHandle) {
    thread::spawn(move || {
        let probe = OsSleepProbe::new();
        let mut announced = false;
        let mut last_tick = SystemTime::now();
        loop {
            thread::sleep(LOCK_POLL);
            let now = SystemTime::now();
            let stalled = slept_through(last_tick, now, SLEEP_STALL);
            last_tick = now;
            if should_emit_desktop_lock(stalled, probe.went_to_sleep(), false) {
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

