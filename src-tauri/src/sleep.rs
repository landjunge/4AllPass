/// The vault stays unlocked until the user presses Lock.
///
/// A >5s wall-clock stall used to emit `desktop-lock`. macOS App Nap suspends
/// the process while Chrome is in front, so switching to Netflix looked like
/// sleep and zeroized the Vault Key. Do not bring that path back.
pub fn watch_desktop_lock(_app: tauri::AppHandle) {}
