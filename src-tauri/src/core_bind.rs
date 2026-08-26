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
    /// Unknown process. Hard refuse — do not navigate the webview to :8788.
    Foreign,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Occupant {
    pub ours: bool,
    pub ui_parent_alive: bool,
}

pub fn classify_occupied(already_bound: bool, occupant: Option<Occupant>) -> OccupiedKind {
    if !already_bound {
        return OccupiedKind::Free;
    }
    match occupant {
        Some(Occupant {
            ours: true,
            ui_parent_alive: false,
        }) => OccupiedKind::OurOrphan,
        Some(Occupant {
            ours: true,
            ui_parent_alive: true,
        }) => OccupiedKind::OurLive,
        _ => OccupiedKind::Foreign,
    }
}

pub fn is_core_binary_name(name: &str) -> bool {
    name == "fourallpass-core" || name == "fourallpass-core.exe"
}

pub fn is_ui_binary_name(name: &str) -> bool {
    name == "fourallpass" || name == "fourallpass.exe"
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
                    ui_parent_alive: false
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
                    ui_parent_alive: false
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
                    ui_parent_alive: true
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
}
