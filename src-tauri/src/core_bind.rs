//! Sidecar bind policy. The desktop UI must never treat "something listens
//! on 8788" as "that process is 4AllPass".

/// If a listener is already bound before *we* spawn the sidecar, it is foreign.
pub fn refuse_foreign_listener(already_bound: bool) -> bool {
    already_bound
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn occupied_port_is_not_our_core() {
        assert!(refuse_foreign_listener(true));
        assert!(!refuse_foreign_listener(false));
    }
}
