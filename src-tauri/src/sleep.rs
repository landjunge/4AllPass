//! Lock the vault when the machine goes to sleep.
//!
//! A >5s wall-clock stall used to emit `desktop-lock`. That was the wrong
//! signal: macOS App Nap suspends the process while Chrome is in front, so
//! switching to Netflix looked exactly like a lid-close and zeroized the Vault
//! Key. Do not bring that path back; a clock gap also means "NTP stepped" or
//! "the app was throttled", and neither is a reason to drop the vault.
//!
//! `NSWorkspaceWillSleepNotification` is a different thing entirely: the OS
//! says it is suspending, rather than us inferring it from a clock that also
//! jumps for harmless reasons. App Nap does not post it.
//!
//! Only sleep is wired. Screen lock (`com.apple.screenIsLocked`) and idle
//! timeouts are separate signals and stay off until asked for.
//!
//! This is best effort, not FileVault: the event crosses into the WKWebView
//! process, and if the machine suspends first the lock lands on wake instead.
//! The Vault Key can therefore still sit in RAM while the machine sleeps.

#[cfg(target_os = "macos")]
pub fn watch_desktop_lock(app: tauri::AppHandle) {
    use block2::RcBlock;
    use objc2_app_kit::NSWorkspace;
    use objc2_foundation::{NSNotification, NSString};

    // The observer lives for the life of the process, which is what we want:
    // the app should keep locking on sleep until it exits.
    let handler = RcBlock::new(move |_: core::ptr::NonNull<NSNotification>| {
        crate::prompts::emit_desktop_lock(&app);
    });

    unsafe {
        let workspace = NSWorkspace::sharedWorkspace();
        let center = workspace.notificationCenter();
        let name = NSString::from_str("NSWorkspaceWillSleepNotification");
        // Main queue: the handler touches windows via emit_desktop_lock.
        let queue = objc2_foundation::NSOperationQueue::mainQueue();
        let _observer = center.addObserverForName_object_queue_usingBlock(
            Some(&name),
            None,
            Some(&queue),
            &handler,
        );
        // Deliberately leaked: unregistering would mean the vault stops
        // locking on sleep, which is the opposite of the point.
        core::mem::forget(_observer);
    }
    core::mem::forget(handler);
}

#[cfg(not(target_os = "macos"))]
pub fn watch_desktop_lock(_app: tauri::AppHandle) {
    // Windows (WM_POWERBROADCAST) and Linux (logind PrepareForSleep) have the
    // same shape of signal. Not wired yet; those builds keep manual Lock only.
}
