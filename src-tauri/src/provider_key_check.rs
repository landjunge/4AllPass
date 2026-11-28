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

use std::sync::{Arc, OnceLock};
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

/// Issue #279. Whether a *real* expiry was reported by the provider for this
/// key — never a guess, never an estimate, never a "typical" lifetime.
/// `Known` is only ever produced from a value the provider itself sent in
/// this response; `Unknown` covers every provider/response that does not
/// expose a real expiry, including GitHub responses without the expiration
/// header (which means either no expiration is set on that token, or this
/// module simply was not given one to read — both are honestly "unknown",
/// never displayed as "no expiry").
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum KeyExpiry {
    Unknown,
    Known {
        /// ISO-8601 UTC instant, reformatted from the provider's own value.
        /// Never synthesized, never rounded, never defaulted.
        #[serde(rename = "expiresAt")]
        expires_at: String,
    },
}

#[derive(Debug, Serialize, PartialEq)]
pub struct KeyCheckOutcome {
    pub id: String,
    pub status: KeyCheckStatus,
    /// Short, provider-reported scope text (e.g. GitHub's `X-OAuth-Scopes`).
    /// Never the key, never a prefix of it, truncated defensively.
    #[serde(rename = "scopeHint")]
    pub scope_hint: Option<String>,
    pub expiry: KeyExpiry,
}

fn truncate_scope(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.chars().count() <= MAX_SCOPE_HINT_LEN {
        trimmed.to_string()
    } else {
        trimmed.chars().take(MAX_SCOPE_HINT_LEN).collect()
    }
}

/// GitHub sends this response header, on an authenticated, successful call,
/// exactly when the token presented has a real expiration set (classic PAT
/// with an expiration chosen, or any fine-grained PAT — those always expire).
/// No other covered provider (OpenAI, Stripe) exposes a key/token expiry
/// through its API at all, so this is the only header this module ever
/// reads for issue #279; everything else stays `KeyExpiry::Unknown` rather
/// than inventing a lifetime.
const GITHUB_EXPIRATION_HEADER: &str = "github-authentication-token-expiration";

/// Parses GitHub's own `"YYYY-MM-DD HH:MM:SS UTC"` value into an ISO-8601
/// UTC instant (`"YYYY-MM-DDTHH:MM:SSZ"`). Pure reformatting of a value the
/// provider sent — no guessing, no timezone conversion (GitHub's value is
/// always UTC), and a strict shape check so a header this module does not
/// recognize is reported as unknown rather than passed through as if it
/// were a validated date.
fn parse_github_expiration_header(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    let mut parts = trimmed.split_whitespace();
    let date_part = parts.next()?;
    let time_part = parts.next()?;
    let tz_part = parts.next()?;
    if parts.next().is_some() || !tz_part.eq_ignore_ascii_case("UTC") {
        return None;
    }
    if !is_iso_date_shape(date_part) || !is_iso_time_shape(time_part) {
        return None;
    }
    Some(format!("{date_part}T{time_part}Z"))
}

fn is_iso_date_shape(s: &str) -> bool {
    let bytes = s.as_bytes();
    bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && s.chars().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
}

fn is_iso_time_shape(s: &str) -> bool {
    let bytes = s.as_bytes();
    bytes.len() == 8
        && bytes[2] == b':'
        && bytes[5] == b':'
        && s.chars().enumerate().all(|(i, c)| i == 2 || i == 5 || c.is_ascii_digit())
}

fn classify_success(
    provider: CheckedProvider,
    response: &ureq::Response,
) -> (KeyCheckStatus, Option<String>, KeyExpiry) {
    let status = response.status();
    if status != 200 {
        // Includes 3xx: ureq does not treat a redirect as an error when
        // `redirects(0)` is set, but this module never follows one and
        // never trusts an unexpected success-range status it cannot read.
        return (KeyCheckStatus::NotCheckable, None, KeyExpiry::Unknown);
    }
    let scope_hint = match provider {
        CheckedProvider::GitHub => response.header("X-OAuth-Scopes").map(truncate_scope),
        CheckedProvider::OpenAi | CheckedProvider::Stripe => None,
    };
    let expiry = match provider {
        // OpenAI and Stripe do not report a real key/token expiry on any
        // documented endpoint — left `Unknown` on purpose, never estimated.
        CheckedProvider::GitHub => response
            .header(GITHUB_EXPIRATION_HEADER)
            .and_then(parse_github_expiration_header)
            .map(|expires_at| KeyExpiry::Known { expires_at })
            .unwrap_or(KeyExpiry::Unknown),
        CheckedProvider::OpenAi | CheckedProvider::Stripe => KeyExpiry::Unknown,
    };
    (KeyCheckStatus::Valid, scope_hint, expiry)
}

fn classify_error_status(
    provider: CheckedProvider,
    status: u16,
    response: &ureq::Response,
) -> (KeyCheckStatus, Option<String>, KeyExpiry) {
    let outcome = match status {
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
    };
    // A non-200 response never yields an expiry: this module only trusts
    // the expiration header on the one path it fully classifies as a
    // successful, authenticated call against the real provider.
    (outcome.0, outcome.1, KeyExpiry::Unknown)
}

/// ureq 2.x never picks a TLS backend on its own — with `default-features =
/// false, features = ["native-tls"]` the agent must be handed an explicit
/// `native_tls::TlsConnector`, or every real `https://` provider check fails
/// transport-side regardless of the key. Built once and shared: constructing
/// it is the only part that can fail (missing system TLS backend), so a
/// failure here is classified the same as any other transport failure
/// instead of panicking the command.
fn shared_tls_connector() -> Option<Arc<native_tls::TlsConnector>> {
    static CONNECTOR: OnceLock<Option<Arc<native_tls::TlsConnector>>> = OnceLock::new();
    CONNECTOR
        .get_or_init(|| native_tls::TlsConnector::new().ok().map(Arc::new))
        .clone()
}

/// Talk to `base` (the real provider host in production, a synthetic
/// loopback fixture in tests) with a fixed path, fixed method, no redirects,
/// and a bounded timeout. Never reads the response body.
fn check_against(provider: CheckedProvider, key: &str, base: &str) -> (KeyCheckStatus, Option<String>, KeyExpiry) {
    let Some(tls_connector) = shared_tls_connector() else {
        return (KeyCheckStatus::Unreachable, None, KeyExpiry::Unknown);
    };
    let url = format!("{base}{}", provider_path(provider));
    let agent = ureq::AgentBuilder::new()
        .redirects(0)
        .timeout(TIMEOUT)
        .tls_connector(tls_connector)
        .build();
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
        Err(ureq::Error::Transport(_)) => (KeyCheckStatus::Unreachable, None, KeyExpiry::Unknown),
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
            let (status, scope_hint, expiry) = match CheckedProvider::from_id(&item.provider_id) {
                Some(_) if key.is_empty() => (KeyCheckStatus::NotCheckable, None, KeyExpiry::Unknown),
                Some(provider) => check_against(provider, key, &base_for(provider)),
                None => (KeyCheckStatus::NotCheckable, None, KeyExpiry::Unknown),
            };
            KeyCheckOutcome {
                id: item.id,
                status,
                scope_hint,
                expiry,
            }
        })
        .collect()
}

/// Explicit, user-triggered single or multi check of existing vault entries.
/// Each request item is independent; one failure never blocks the others.
/// The vault stays decrypted only in this process — this command receives
/// the already-decrypted key values the caller chose to check and returns
/// status only, never an echo of the key.
///
/// Async so Tauri does not run the blocking batch (each item up to
/// `TIMEOUT` sequentially) on the main thread — same `spawn_blocking`
/// pattern as `family_switch::family_switch`. A panicked worker (never
/// expected; `run_checks` itself does not panic) yields `NotCheckable` for
/// every item rather than losing the response.
#[tauri::command]
pub async fn check_provider_keys(items: Vec<KeyCheckRequest>) -> Vec<KeyCheckOutcome> {
    let ids: Vec<String> = items.iter().map(|item| item.id.clone()).collect();
    tauri::async_runtime::spawn_blocking(move || {
        run_checks(items, |provider| provider_default_base(provider).to_string())
    })
    .await
    .unwrap_or_else(|_| {
        ids.into_iter()
            .map(|id| KeyCheckOutcome {
                id,
                status: KeyCheckStatus::NotCheckable,
                scope_hint: None,
                expiry: KeyExpiry::Unknown,
            })
            .collect()
    })
}

#[cfg(test)]
#[path = "provider_key_check_tests.rs"]
mod tests;
