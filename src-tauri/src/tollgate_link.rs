//! Opens the local TollGate dashboard in the user's default external
//! browser. Issue #279, point 9 ("Kosten/Limits").
//!
//! TollGate (`/Users/landjunge/tollgate`) is a separate, self-contained
//! product: a local security gate / cost guard for AI agent calls. It runs
//! locally as `tollgate serve` and exposes its own HTTP API on
//! `http://127.0.0.1:8787`. 4AllPass does not fetch that API, does not read
//! or display any of TollGate's limits or spend, and never sends a vault key
//! or password to it. The only integration point is this command: it opens
//! TollGate's dashboard URL in the OS default browser, exactly the same
//! pattern `provider_key_create.rs` (issue #278) already uses for provider
//! key-creation pages — a fixed, hardcoded destination, never a
//! caller-supplied one, and never a connection from this process or its
//! webview.
//!
//! `http://127.0.0.1:8787` (not `https://`) is intentional here: this is a
//! pure OS-level "open" call, the same as double-clicking a link in Finder —
//! it hands the URL to the operating system's default-browser launcher. It
//! is not a `fetch`, not a network request made by the 4AllPass process or
//! its webview, and it does not touch or require any change to the webview
//! Content-Security-Policy's `connect-src`
//! (`docs/desktop-network-boundary.md`). TollGate's own HTTP server, running
//! as a separate local process, is what actually accepts the resulting
//! browser connection.

use std::process::Command;

/// The one and only destination this command ever opens. Never built from
/// caller input — there is no parameter to this command at all.
const TOLLGATE_DASHBOARD_URL: &str = "http://127.0.0.1:8787";

fn open_url(url: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let status = Command::new("open").arg(url).status().map_err(|err| err.to_string())?;
        if !status.success() {
            return Err(format!("could not open {url}"));
        }
        return Ok(());
    }
    #[cfg(target_os = "windows")]
    {
        let status = Command::new("cmd")
            .args(["/C", "start", "", url])
            .status()
            .map_err(|err| err.to_string())?;
        if !status.success() {
            return Err(format!("could not open {url}"));
        }
        return Ok(());
    }
    #[cfg(target_os = "linux")]
    {
        let status = Command::new("xdg-open").arg(url).status().map_err(|err| err.to_string())?;
        if !status.success() {
            return Err(format!("could not open {url}"));
        }
        return Ok(());
    }
    #[allow(unreachable_code)]
    Err("open tollgate dashboard is not supported on this OS".into())
}

/// Takes no parameters — there is nothing for a caller to smuggle a
/// different destination through. Opens the one fixed TollGate dashboard
/// URL in the OS default browser.
#[tauri::command]
pub fn open_tollgate_dashboard() -> Result<(), String> {
    open_url(TOLLGATE_DASHBOARD_URL)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dashboard_url_is_the_fixed_local_tollgate_loopback_address() {
        assert_eq!(TOLLGATE_DASHBOARD_URL, "http://127.0.0.1:8787");
    }

    #[test]
    fn dashboard_url_is_plain_http_loopback_with_no_query_or_fragment_an_attacker_could_smuggle_a_redirect_into() {
        assert!(
            TOLLGATE_DASHBOARD_URL.starts_with("http://127.0.0.1"),
            "url must be a plain loopback http address: {TOLLGATE_DASHBOARD_URL}"
        );
        assert!(
            !TOLLGATE_DASHBOARD_URL.contains('?') && !TOLLGATE_DASHBOARD_URL.contains('#'),
            "url must be plain: {TOLLGATE_DASHBOARD_URL}"
        );
    }

    #[test]
    fn dashboard_url_has_no_userinfo_and_no_path() {
        assert!(!TOLLGATE_DASHBOARD_URL.contains('@'), "url must not carry userinfo");
        assert_eq!(TOLLGATE_DASHBOARD_URL.matches('/').count(), 2, "url must have no path segment");
    }

    #[test]
    fn open_tollgate_dashboard_takes_no_parameters_so_nothing_can_redirect_it() {
        // The command's signature itself is the guarantee here: it is a
        // zero-argument function, so there is no input path through which a
        // caller could ever supply a different URL. This test only pins
        // that the call compiles and returns the same Result shape the
        // other OS-open commands use.
        let result: Result<(), String> = open_tollgate_dashboard();
        // On a machine without "open"/"start"/"xdg-open" available this may
        // fail; we only assert it is the expected error shape, never a
        // panic, and never a different URL in the message.
        if let Err(message) = result {
            assert!(
                !message.contains("http://") || message.contains(TOLLGATE_DASHBOARD_URL),
                "any url mentioned in an error must be the fixed dashboard url: {message}"
            );
        }
    }
}
