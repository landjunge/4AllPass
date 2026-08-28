use std::{
    thread,
    time::{Duration, SystemTime},
};

use crate::prompts::emit_desktop_lock;
use crate::sleep_stall::{should_emit_desktop_lock, slept_through};

const LOCK_POLL: Duration = Duration::from_millis(400);
const SLEEP_STALL: Duration = Duration::from_secs(5);

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

pub fn watch_desktop_lock(app: tauri::AppHandle) {
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
