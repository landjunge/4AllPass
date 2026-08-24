use std::time::{Duration, SystemTime};

/// Wall-clock stall. `Instant` (CLOCK_MONOTONIC) stops during suspend together
/// with the process, so a 30s lid-close looks like one 400ms poll tick and the
/// vault stays unlocked when logind/notify also miss. `SystemTime` still jumps.
/// A backwards NTP step is ignored (do not lock). A >5s forward step locks —
/// that is acceptable; it is not FileVault.
pub fn slept_through(prev: SystemTime, now: SystemTime, threshold: Duration) -> bool {
    now.duration_since(prev).map(|d| d > threshold).unwrap_or(false)
}

/// Desktop vault lock: sleep / Ruhemodus only. Screen lock is not sleep.
pub fn should_emit_desktop_lock(slept: bool, os_sleep: bool, screen_locked: bool) -> bool {
    let _ = screen_locked;
    slept || os_sleep
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sleep_stall_detects_wall_clock_gap() {
        let t0 = SystemTime::UNIX_EPOCH;
        let t1 = t0 + Duration::from_secs(6);
        assert!(slept_through(t0, t1, Duration::from_secs(5)));
        assert!(!slept_through(
            t0,
            t0 + Duration::from_millis(400),
            Duration::from_secs(5)
        ));
    }

    #[test]
    fn sleep_stall_sees_suspend_shaped_wall_gap() {
        // After lid-close, Instant advanced ~LOCK_POLL; wall advanced the sleep.
        // Instant must not be the stall clock — 400ms is not 5s.
        let now = SystemTime::now();
        assert!(!slept_through(
            now - Duration::from_millis(400),
            now,
            Duration::from_secs(5)
        ));
        assert!(slept_through(
            now - Duration::from_secs(30),
            now,
            Duration::from_secs(5)
        ));
    }

    #[test]
    fn sleep_stall_ignores_clock_going_backwards() {
        let later = SystemTime::UNIX_EPOCH + Duration::from_secs(10);
        let earlier = SystemTime::UNIX_EPOCH;
        assert!(!slept_through(later, earlier, Duration::from_secs(5)));
    }

    #[test]
    fn desktop_lock_is_sleep_not_screen_lock() {
        assert!(should_emit_desktop_lock(true, false, false));
        assert!(should_emit_desktop_lock(false, true, false));
        assert!(!should_emit_desktop_lock(false, false, true));
        assert!(!should_emit_desktop_lock(false, false, false));
    }
}
