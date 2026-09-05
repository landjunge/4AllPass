//! Sidecar bind policy. The desktop UI must never treat "something listens
//! on 8788" as "that process is 4AllPass".
//!
//! A leftover *our* sidecar (same binary, no living UI parent) may be reaped.
//! That is not attaching the webview to whoever holds the port.

/// If a listener is already bound before *we* spawn the sidecar, it is foreign.
pub fn refuse_foreign_listener(already_bound: bool) -> bool {
    already_bound
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OccupiedKind {
    Free,
    /// Our `fourallpass-core` with no living `fourallpass` parent. Safe to kill.
    OurOrphan,
    /// Another 4AllPass window already owns this core.
    OurLive,
    /// `python -m app.local` / `npm run app` on 8788. Same data dir as Desk,
    /// not the sidecar binary. Reap, then spawn `fourallpass-core`. Never
    /// point the webview at that Python listener.
    DevLocal,
    /// Unknown process. Hard refuse — do not navigate the webview to :8788.
    Foreign,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Occupant {
    pub ours: bool,
    pub ui_parent_alive: bool,
    pub dev_local: bool,
}

pub fn classify_occupied(already_bound: bool, occupant: Option<Occupant>) -> OccupiedKind {
    if !already_bound {
        return OccupiedKind::Free;
    }
    match occupant {
        Some(Occupant {
            ours: true,
            ui_parent_alive: false,
            ..
        }) => OccupiedKind::OurOrphan,
        Some(Occupant {
            ours: true,
            ui_parent_alive: true,
            ..
        }) => OccupiedKind::OurLive,
        Some(Occupant {
            ours: false,
            dev_local: true,
            ..
        }) => OccupiedKind::DevLocal,
        _ => OccupiedKind::Foreign,
    }
}

pub fn is_core_binary_name(name: &str) -> bool {
    name == "fourallpass-core" || name == "fourallpass-core.exe"
}

pub fn is_ui_binary_name(name: &str) -> bool {
    name == "fourallpass" || name == "fourallpass.exe"
}

/// Local Python profile (`npm run app` / `python -m app.local`). Not every
/// Python on 8788 — only this product's entrypoint.
pub fn is_dev_local_command(cmd: &str) -> bool {
    let lower = cmd.to_ascii_lowercase();
    lower.contains("-m app.local")
        || lower.contains("-mapp.local")
        || lower.contains("app.local")
        || lower.contains("app/local.py")
}

/// After *we* spawn: TCP-up on 8788 is not “that process is our sidecar”.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SpawnedListener {
    /// Not bound yet — keep waiting.
    NotYet,
    /// Bound, but the listen PID is not named yet (lsof/netstat lag). Keep waiting; never treat as ours.
    Unknown,
    /// Bound by the child we spawned, or a descendant (PyInstaller / `npm run app:sidecar`).
    Ours,
    /// Bound by someone else. Same refuse as a pre-spawn foreign occupant.
    Foreign,
}

/// Walk at most 16 parents. `parent_of(pid)` is the OS parent pid.
pub fn pid_is_descendant(
    pid: u32,
    ancestor: u32,
    mut parent_of: impl FnMut(u32) -> Option<u32>,
) -> bool {
    if pid == 0 || ancestor == 0 {
        return false;
    }
    if pid == ancestor {
        return true;
    }
    let mut current = pid;
    for _ in 0..16 {
        let Some(parent) = parent_of(current) else {
            return false;
        };
        if parent == ancestor {
            return true;
        }
        if parent == 0 || parent == current || parent == pid {
            return false;
        }
        current = parent;
    }
    false
}

pub fn classify_spawned_listener(
    bound: bool,
    listen_pid: Option<u32>,
    child_pid: u32,
    parent_of: impl FnMut(u32) -> Option<u32>,
) -> SpawnedListener {
    if !bound {
        return SpawnedListener::NotYet;
    }
    let Some(pid) = listen_pid else {
        return SpawnedListener::Unknown;
    };
    if pid_is_descendant(pid, child_pid, parent_of) {
        SpawnedListener::Ours
    } else {
        SpawnedListener::Foreign
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn occupied_port_is_not_our_core() {
        assert!(refuse_foreign_listener(true));
        assert!(!refuse_foreign_listener(false));
    }

    #[test]
    fn free_port_is_free() {
        assert_eq!(classify_occupied(false, None), OccupiedKind::Free);
    }

    #[test]
    fn unknown_listener_is_foreign() {
        assert_eq!(classify_occupied(true, None), OccupiedKind::Foreign);
        assert_eq!(
            classify_occupied(
                true,
                Some(Occupant {
                    ours: false,
                    ui_parent_alive: false,
                    dev_local: false
                })
            ),
            OccupiedKind::Foreign
        );
    }

    #[test]
    fn leftover_core_is_orphan_not_trusted() {
        assert_eq!(
            classify_occupied(
                true,
                Some(Occupant {
                    ours: true,
                    ui_parent_alive: false,
                    dev_local: false
                })
            ),
            OccupiedKind::OurOrphan
        );
    }

    #[test]
    fn living_ui_is_already_running() {
        assert_eq!(
            classify_occupied(
                true,
                Some(Occupant {
                    ours: true,
                    ui_parent_alive: true,
                    dev_local: false
                })
            ),
            OccupiedKind::OurLive
        );
    }

    #[test]
    fn core_name_is_not_the_ui_name() {
        assert!(is_core_binary_name("fourallpass-core"));
        assert!(!is_ui_binary_name("fourallpass-core"));
        assert!(is_ui_binary_name("fourallpass"));
        assert!(!is_core_binary_name("fourallpass"));
    }

    #[test]
    fn spawned_port_not_yet_bound() {
        assert_eq!(
            classify_spawned_listener(false, None, 100, |_| None),
            SpawnedListener::NotYet
        );
    }

    #[test]
    fn spawned_port_unknown_pid_is_not_ours() {
        assert_eq!(
            classify_spawned_listener(true, None, 100, |_| None),
            SpawnedListener::Unknown
        );
    }

    #[test]
    fn spawned_listener_same_pid_is_ours() {
        assert_eq!(
            classify_spawned_listener(true, Some(100), 100, |_| None),
            SpawnedListener::Ours
        );
    }

    #[test]
    fn spawned_listener_grandchild_is_ours() {
        let parent_of = |pid| match pid {
            300 => Some(200),
            200 => Some(100),
            100 => Some(1),
            _ => None,
        };
        assert_eq!(
            classify_spawned_listener(true, Some(300), 100, parent_of),
            SpawnedListener::Ours
        );
        assert!(pid_is_descendant(300, 100, parent_of));
    }

    #[test]
    fn spawned_listener_unrelated_is_foreign() {
        let parent_of = |pid| match pid {
            999 => Some(1),
            100 => Some(1),
            _ => None,
        };
        assert_eq!(
            classify_spawned_listener(true, Some(999), 100, parent_of),
            SpawnedListener::Foreign
        );
        assert!(!pid_is_descendant(999, 100, parent_of));
    }

    #[test]
    fn python_app_local_is_dev_local() {
        assert!(is_dev_local_command(
            "/Users/x/4AllPass/backend/.venv/bin/python -m app.local --open"
        ));
        assert!(is_dev_local_command("python3 -m app.local"));
        assert!(!is_dev_local_command("python3 -m http.server 8788"));
        assert!(!is_dev_local_command("node server.js"));
        assert_eq!(
            classify_occupied(
                true,
                Some(Occupant {
                    ours: false,
                    ui_parent_alive: false,
                    dev_local: true
                })
            ),
            OccupiedKind::DevLocal
        );
    }

    #[test]
    fn descendant_stops_at_init_and_cycles() {
        assert!(!pid_is_descendant(5, 100, |pid| match pid {
            5 => Some(1),
            _ => None,
        }));
        assert!(!pid_is_descendant(5, 100, |_| Some(5)));
        assert!(!pid_is_descendant(0, 100, |_| Some(1)));
    }
}
