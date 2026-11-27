//! Local, read-only API-key validity checks against the real provider domain.
//!
//! Issue #277. Rules this module exists to keep:
//! - The key only ever travels as an `Authorization` header value, straight
//!   from this trusted desktop process to the provider's own, fixed, documented
//!   host — never to 4AllPass's own server, never through a caller-supplied URL.
//! - Redirects are never followed (`redirects(0)`), so a provider cannot
//!   bounce this request to a foreign host and still get the key.
//! - Nothing here ever logs the key, a prefix of it, or any response body.
//!   Classification uses only the HTTP status and a couple of named,
//!   non-secret headers.
//! - `403` and `429` alone are never read as proof the key is invalid/revoked
//!   (see `classify_error_status`); only `401` is.
//! - Every outcome is a snapshot, not a standing guarantee — callers attach
//!   their own "checked at" timestamp; this module makes no persistence claim.
//!
//! Providers covered are exactly the ones this codebase already treats as
//! API-capable in `@4allpass/providers` (`credentialKinds: [..., "api"]`):
//! GitHub, OpenAI, Stripe. Cloudflare has two incompatible credential shapes
//! (scoped API Token vs. legacy Global API Key + email) and no single
//! documented free endpoint correctly identifies both without guessing a key
//! shape by its look, so it is intentionally left out — callers see
//! `NotCheckable` for it. No other provider id is accepted.

use std::time::Duration;

use serde::{Deserialize, Serialize};

const TIMEOUT: Duration = Duration::from_secs(8);
const MAX_SCOPE_HINT_LEN: usize = 160;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum CheckedProvider {
    GitHub,
    OpenAi,
    Stripe,
}

impl CheckedProvider {
    fn from_id(id: &str) -> Option<Self> {
        match id {
            "github" => Some(Self::GitHub),
            "openai" => Some(Self::OpenAi),
            "stripe" => Some(Self::Stripe),
            _ => None,
        }
    }
}

/// Fixed, documented, free, read-only path per provider. Never caller input.
fn provider_path(provider: CheckedProvider) -> &'static str {
    match provider {
        // https://docs.github.com/en/rest/users/users#get-the-authenticated-user
        CheckedProvider::GitHub => "/user",
        // https://platform.openai.com/docs/api-reference/models/list
        CheckedProvider::OpenAi => "/v1/models",
        // https://docs.stripe.com/api/balance/balance_retrieve
        CheckedProvider::Stripe => "/v1/balance",
    }
}

/// The real provider domain. Never overridden outside `#[cfg(test)]`.
fn provider_default_base(provider: CheckedProvider) -> &'static str {
    match provider {
        CheckedProvider::GitHub => "https://api.github.com",
        CheckedProvider::OpenAi => "https://api.openai.com",
        CheckedProvider::Stripe => "https://api.stripe.com",
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum KeyCheckStatus {
    /// Provider accepted the key for this read-only call.
    Valid,
    /// Provider returned 401: the credential itself was rejected.
    Invalid,
    /// Provider returned 403 without a clear rate-limit signal, or an
    /// unexpected-but-not-auth status: the key may be valid but this call
    /// is not allowed (scope, region, restricted key, ...).
    InsufficientPermission,
    /// Provider returned 429, or a 403 that its own headers mark as a rate
    /// limit, not a credential rejection.
    QuotaExceeded,
    /// Transport failure (DNS/connect/timeout) or 5xx from the provider.
    /// Says nothing about the key itself.
    Unreachable,
    /// Unknown/unsupported provider id, empty key, a redirect we refused to
    /// follow, or any other response this module does not have a confident
    /// reading for.
    NotCheckable,
}

#[derive(Debug, Deserialize)]
pub struct KeyCheckRequest {
    pub id: String,
    #[serde(rename = "providerId")]
    pub provider_id: String,
    pub key: String,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct KeyCheckOutcome {
    pub id: String,
    pub status: KeyCheckStatus,
    /// Short, provider-reported scope text (e.g. GitHub's `X-OAuth-Scopes`).
    /// Never the key, never a prefix of it, truncated defensively.
    #[serde(rename = "scopeHint")]
    pub scope_hint: Option<String>,
}

fn truncate_scope(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.chars().count() <= MAX_SCOPE_HINT_LEN {
        trimmed.to_string()
    } else {
        trimmed.chars().take(MAX_SCOPE_HINT_LEN).collect()
    }
}

fn classify_success(provider: CheckedProvider, response: &ureq::Response) -> (KeyCheckStatus, Option<String>) {
    let status = response.status();
    if status != 200 {
        // Includes 3xx: ureq does not treat a redirect as an error when
        // `redirects(0)` is set, but this module never follows one and
        // never trusts an unexpected success-range status it cannot read.
        return (KeyCheckStatus::NotCheckable, None);
    }
    let scope_hint = match provider {
        CheckedProvider::GitHub => response.header("X-OAuth-Scopes").map(truncate_scope),
        CheckedProvider::OpenAi | CheckedProvider::Stripe => None,
    };
    (KeyCheckStatus::Valid, scope_hint)
}

fn classify_error_status(
    provider: CheckedProvider,
    status: u16,
    response: &ureq::Response,
) -> (KeyCheckStatus, Option<String>) {
    match status {
        401 => (KeyCheckStatus::Invalid, None),
        403 => {
            // GitHub's own signal for "this 403 is a rate limit, not a
            // credential problem" is an exhausted X-RateLimit budget.
            let rate_limited =
                provider == CheckedProvider::GitHub && response.header("X-RateLimit-Remaining") == Some("0");
            if rate_limited {
                (KeyCheckStatus::QuotaExceeded, None)
            } else {
                (KeyCheckStatus::InsufficientPermission, None)
            }
        }
        429 => (KeyCheckStatus::QuotaExceeded, None),
        500..=599 => (KeyCheckStatus::Unreachable, None),
        // 404 and anything else unexpected: no confident reading.
        _ => (KeyCheckStatus::NotCheckable, None),
    }
}

/// Talk to `base` (the real provider host in production, a synthetic
/// loopback fixture in tests) with a fixed path, fixed method, no redirects,
/// and a bounded timeout. Never reads the response body.
fn check_against(provider: CheckedProvider, key: &str, base: &str) -> (KeyCheckStatus, Option<String>) {
    let url = format!("{base}{}", provider_path(provider));
    let agent = ureq::AgentBuilder::new().redirects(0).timeout(TIMEOUT).build();
    let auth = format!("Bearer {key}");
    let mut request = agent
        .get(&url)
        .set("Authorization", &auth)
        .set("User-Agent", "4AllPass-KeyCheck/1");
    if provider == CheckedProvider::GitHub {
        request = request.set("Accept", "application/vnd.github+json");
    }
    match request.call() {
        Ok(response) => classify_success(provider, &response),
        Err(ureq::Error::Status(status, response)) => classify_error_status(provider, status, &response),
        Err(ureq::Error::Transport(_)) => (KeyCheckStatus::Unreachable, None),
    }
}

/// Shared by the real command and its tests. `base_for` resolves the host to
/// talk to for a given provider — the real provider domain in production,
/// a synthetic loopback fixture under test. Each item is independent: one
/// bad id, empty key, or failed check never affects the others in the batch.
fn run_checks(items: Vec<KeyCheckRequest>, base_for: impl Fn(CheckedProvider) -> String) -> Vec<KeyCheckOutcome> {
    items
        .into_iter()
        .map(|item| {
            let key = item.key.trim();
            let (status, scope_hint) = match CheckedProvider::from_id(&item.provider_id) {
                Some(_) if key.is_empty() => (KeyCheckStatus::NotCheckable, None),
                Some(provider) => check_against(provider, key, &base_for(provider)),
                None => (KeyCheckStatus::NotCheckable, None),
            };
            KeyCheckOutcome {
                id: item.id,
                status,
                scope_hint,
            }
        })
        .collect()
}

/// Explicit, user-triggered single or multi check of existing vault entries.
/// Each request item is independent; one failure never blocks the others.
/// The vault stays decrypted only in this process — this command receives
/// the already-decrypted key values the caller chose to check and returns
/// status only, never an echo of the key.
#[tauri::command]
pub fn check_provider_keys(items: Vec<KeyCheckRequest>) -> Vec<KeyCheckOutcome> {
    run_checks(items, |provider| provider_default_base(provider).to_string())
}

#[cfg(test)]
#[path = "provider_key_check_tests.rs"]
mod tests;
