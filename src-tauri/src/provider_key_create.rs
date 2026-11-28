//! Opens the verified, official key-creation page for a provider in the
//! user's default external browser. Issue #278.
//!
//! Never a caller-supplied URL: the provider id is mapped to one of a small
//! fixed allow-list of official provider URLs, the same convention
//! `open_autofill_demo` in `browsers.rs` already uses ("not an arbitrary URL
//! opener"). This opens the OS default browser, not the 4AllPass webview —
//! the new key is created and copied outside this app's window and only
//! enters it through the explicit, time-bounded clipboard capture the
//! frontend starts separately (`frontend/src/lib/clipboard-capture.ts`).
//! This command never touches the clipboard itself.

use std::process::Command;

/// Exactly the three provider ids `provider_key_check.rs` (#277) and
/// `@4allpass/providers`'s "api" credential kind cover
/// (`frontend/src/lib/providers.ts`, `frontend/src/lib/provider-key-create.ts`).
/// Adding a provider here always means adding it in both those places too.
fn key_creation_url(provider_id: &str) -> Option<&'static str> {
    match provider_id {
        // https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens
        "github" => Some("https://github.com/settings/tokens/new"),
        // https://platform.openai.com/docs/api-reference/authentication
        "openai" => Some("https://platform.openai.com/api-keys"),
        // https://docs.stripe.com/keys
        "stripe" => Some("https://dashboard.stripe.com/apikeys"),
        _ => None,
    }
}

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
    Err("open provider key page is not supported on this OS".into())
}

/// `provider_id` is never used to build the URL; it only selects one entry
/// of the fixed allow-list above. An unknown id is rejected before any OS
/// call is made.
#[tauri::command]
pub fn open_provider_key_page(provider_id: String) -> Result<(), String> {
    let url = key_creation_url(&provider_id).ok_or_else(|| format!("unknown provider: {provider_id}"))?;
    open_url(url)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_providers_resolve_to_their_official_https_domain() {
        assert_eq!(key_creation_url("github"), Some("https://github.com/settings/tokens/new"));
        assert_eq!(key_creation_url("openai"), Some("https://platform.openai.com/api-keys"));
        assert_eq!(key_creation_url("stripe"), Some("https://dashboard.stripe.com/apikeys"));
    }

    #[test]
    fn every_known_url_is_https_and_has_no_query_or_fragment_an_attacker_could_smuggle_a_redirect_into() {
        for id in ["github", "openai", "stripe"] {
            let url = key_creation_url(id).unwrap();
            assert!(url.starts_with("https://"), "{id} url must be https: {url}");
            assert!(!url.contains('?') && !url.contains('#'), "{id} url must be plain: {url}");
        }
    }

    #[test]
    fn unknown_provider_resolves_to_nothing() {
        assert_eq!(key_creation_url(""), None);
        assert_eq!(key_creation_url("acme"), None);
        assert_eq!(key_creation_url("GitHub"), None); // ids are lowercase, never guessed case-insensitively
    }

    #[test]
    fn unknown_provider_is_rejected_before_any_os_call() {
        let result = open_provider_key_page("not-a-real-provider".to_string());
        assert_eq!(result, Err("unknown provider: not-a-real-provider".to_string()));
    }
}
