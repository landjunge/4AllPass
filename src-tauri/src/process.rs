use std::{
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

use tauri::Manager;

pub const CORE_HOST: &str = "127.0.0.1";
pub const CORE_PORT: u16 = 8788;

pub struct CoreProcess(pub Mutex<Option<Child>>);

pub fn core_up() -> bool {
    std::net::TcpStream::connect((CORE_HOST, CORE_PORT)).is_ok()
}

pub fn wait_core(timeout: Duration) -> bool {
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

pub fn bundled_core() -> Option<PathBuf> {
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

pub fn spawn_core() -> Result<Child, String> {
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

pub fn kill_core(app: &tauri::AppHandle) {
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
