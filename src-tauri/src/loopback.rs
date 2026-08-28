use std::{path::PathBuf, thread, time::{Duration, Instant}};

use crate::core_bind::{
    classify_occupied, is_core_binary_name, is_ui_binary_name, Occupant, OccupiedKind,
};
use crate::process::{bundled_core, core_up, CORE_PORT};
use crate::process_inspect::{cmd_name, loopback_listen_pid, parent_and_command, terminate};

fn occupant_of(listen_pid: u32, our_core: Option<&PathBuf>) -> Occupant {
    let Some((mut pid, cmd)) = parent_and_command(listen_pid) else {
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
        let Some((next, parent_cmd)) = parent_and_command(pid) else {
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
        let Some((ppid, cmd)) = parent_and_command(pid) else {
            break;
        };
        let name = cmd_name(&cmd);
        if is_ui_binary_name(&name) {
            break;
        }
        if is_core_binary_name(&name) {
            terminate(pid);
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
pub fn prepare_loopback_core() -> Result<(), String> {
    if !core_up() {
        return Ok(());
    }
    let occupant = loopback_listen_pid(CORE_PORT).map(|pid| occupant_of(pid, bundled_core().as_ref()));
    match classify_occupied(true, occupant) {
        OccupiedKind::Free => Ok(()),
        OccupiedKind::OurOrphan => {
            if let Some(pid) = loopback_listen_pid(CORE_PORT) {
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
