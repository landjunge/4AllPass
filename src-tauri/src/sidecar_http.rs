use std::{collections::HashMap, error::Error as StdError, time::Duration};
#[cfg(all(feature = "native-normal-journey-probe", debug_assertions))]
use std::sync::atomic::{AtomicUsize, Ordering};

use serde::Serialize;

use crate::process::core_port;
use crate::sidecar_target::core_api_url;

#[cfg(all(feature = "native-normal-journey-probe", debug_assertions))]
static SNAPSHOT_GET_ATTEMPTS: AtomicUsize = AtomicUsize::new(0);
#[cfg(all(feature = "native-normal-journey-probe", debug_assertions))]
static SNAPSHOT_FAULT_ACTIVE: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);
#[cfg(all(feature = "native-normal-journey-probe", debug_assertions))]
static SNAPSHOT_POST_ATTEMPTS: AtomicUsize = AtomicUsize::new(0);

#[cfg(all(feature = "native-normal-journey-probe", debug_assertions))]
pub(crate) fn snapshot_get_attempts() -> usize {
    SNAPSHOT_GET_ATTEMPTS.load(Ordering::SeqCst)
}

#[cfg(all(feature = "native-normal-journey-probe", debug_assertions))]
pub(crate) fn snapshot_post_attempts() -> usize {
    SNAPSHOT_POST_ATTEMPTS.load(Ordering::SeqCst)
}

#[cfg(all(feature = "native-normal-journey-probe", debug_assertions))]
pub(crate) fn set_snapshot_fault_active(active: bool) {
    SNAPSHOT_FAULT_ACTIVE.store(active, Ordering::SeqCst);
}

/// Test-only, tightly scoped snapshot transport fault. The auth/vault-list
/// routes pass through to the real sidecar; only the named snapshot route
/// returns the same typed offline error before any dispatch.
#[cfg(all(feature = "native-normal-journey-probe", debug_assertions))]
fn snapshot_fault(path: &str) -> Option<SidecarError> {
    if !SNAPSHOT_FAULT_ACTIVE.load(Ordering::SeqCst) {
        return None;
    }
    let mode = std::env::var("FOURALLPASS_NATIVE_SNAPSHOT_FAULT").ok()?;
    let is_get = path.starts_with("/api/v1/vaults/") && path.ends_with("/snapshot");
    let is_post = path.starts_with("/api/v1/vaults/") && path.ends_with("/snapshots");
    match mode.as_str() {
        "get" if is_get => Some(SidecarError::new(SidecarErrorCode::OfflineNetwork)),
        "post" if is_post => Some(SidecarError::new(SidecarErrorCode::OfflineNetwork)),
        "both" if is_get || is_post => Some(SidecarError::new(SidecarErrorCode::OfflineNetwork)),
        "none" | "" => None,
        _ => None,
    }
}

#[derive(Debug, serde::Serialize)]
pub struct SidecarHttpResult {
    status: u16,
    body: String,
}

/// Wire-level classification for the Tauri command error.
///
/// Only the three `offline_*` codes are real local transport failures. HTTP
/// statuses remain `SidecarHttpResult` values and never become errors here.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SidecarErrorCode {
    /// ureq connection/DNS failure to the loopback core.
    OfflineNetwork,
    /// ureq/std::io timeout while talking to the loopback core.
    OfflineTimeout,
    /// Other std::io transport failure while talking to the loopback core.
    OfflineIo,
    /// Caller path/method validation failed before any request.
    Validation,
    /// The transport failed for a non-offline protocol reason.
    Protocol,
    /// A local permission/capability failure (e.g. PermissionDenied).
    Capability,
}

#[derive(Debug, Serialize)]
pub struct SidecarError {
    code: SidecarErrorCode,
    /// Static, sanitized text only. Never a URL, header, body or secret.
    message: &'static str,
}

impl SidecarError {
    fn new(code: SidecarErrorCode) -> Self {
        let message = match code {
            SidecarErrorCode::OfflineNetwork => "desktop sidecar network unavailable",
            SidecarErrorCode::OfflineTimeout => "desktop sidecar request timed out",
            SidecarErrorCode::OfflineIo => "desktop sidecar I/O unavailable",
            SidecarErrorCode::Validation => "desktop sidecar request validation failed",
            SidecarErrorCode::Protocol => "desktop sidecar protocol failure",
            SidecarErrorCode::Capability => "desktop sidecar capability failure",
        };
        Self { code, message }
    }
}

impl std::fmt::Display for SidecarError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.message)
    }
}

impl StdError for SidecarError {}

/// ureq kind fallback when the transport carries no concrete io::Error source.
/// `Io` without a source is conservatively non-offline.
fn transport_code(kind: ureq::ErrorKind) -> Option<SidecarErrorCode> {
    match kind {
        ureq::ErrorKind::ConnectionFailed | ureq::ErrorKind::Dns => {
            Some(SidecarErrorCode::OfflineNetwork)
        }
        // InvalidUrl, UnknownScheme, InsecureRequestHttpsOnly, TooManyRedirects,
        // BadStatus, BadHeader, InvalidProxyUrl, ProxyConnect, ProxyUnauthorized,
        // HTTP, Io without a concrete source and future variants are not proven
        // local network failures.
        _ => None,
    }
}

/// Walk the typed error source chain; no message/string matching.
fn io_source<'a>(error: &'a (dyn StdError + 'static)) -> Option<&'a std::io::Error> {
    let mut current = StdError::source(error);
    while let Some(source) = current {
        if let Some(io) = source.downcast_ref::<std::io::Error>() {
            return Some(io);
        }
        current = StdError::source(source);
    }
    None
}

fn io_code(error: &std::io::Error) -> SidecarErrorCode {
    match error.kind() {
        std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock => {
            SidecarErrorCode::OfflineTimeout
        }
        std::io::ErrorKind::ConnectionRefused
        | std::io::ErrorKind::ConnectionReset
        | std::io::ErrorKind::ConnectionAborted
        | std::io::ErrorKind::NotConnected
        | std::io::ErrorKind::BrokenPipe
        | std::io::ErrorKind::UnexpectedEof => SidecarErrorCode::OfflineIo,
        std::io::ErrorKind::PermissionDenied => SidecarErrorCode::Capability,
        std::io::ErrorKind::InvalidData
        | std::io::ErrorKind::InvalidInput
        | std::io::ErrorKind::Unsupported => SidecarErrorCode::Protocol,
        // Unknown/local IO outcomes are not evidence of a network outage.
        _ => SidecarErrorCode::Protocol,
    }
}

fn classify_transport(error: &ureq::Transport) -> SidecarErrorCode {
    // The concrete io::Error is more specific than the ureq kind. A
    // PermissionDenied source can be wrapped in ureq ConnectionFailed.
    if let Some(io) = io_source(error) {
        return io_code(io);
    }
    transport_code(error.kind()).unwrap_or(SidecarErrorCode::Protocol)
}

#[cfg(all(feature = "native-normal-journey-probe", debug_assertions))]
fn auth_diagnostic(path: &str, body: &Option<String>, status: u16, response: &str) {
    if path != "/api/v1/auth/login" && path != "/api/v1/auth/register" {
        return;
    }
    let request = body
        .as_deref()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok());
    let keys = request
        .as_ref()
        .and_then(serde_json::Value::as_object)
        .map(|object| {
            let mut keys: Vec<String> = object.keys().cloned().collect();
            keys.sort();
            keys
        });
    let text = |key: &str| {
        request
            .as_ref()
            .and_then(|value| value.get(key))
            .and_then(serde_json::Value::as_str)
            .map(str::len)
    };
    let detail = serde_json::from_str::<serde_json::Value>(response)
        .ok()
        .and_then(|value| value.get("detail").cloned());
    let sanitized = match detail {
        Some(serde_json::Value::Array(items)) => serde_json::Value::Array(
            items
                .iter()
                .map(|item| {
                    serde_json::json!({
                        "loc": item.get("loc").cloned().unwrap_or(serde_json::Value::Null),
                        "type": item.get("type").cloned().unwrap_or(serde_json::Value::Null),
                    })
                })
                .collect(),
        ),
        Some(other) => serde_json::json!({
            "kind": match other {
                serde_json::Value::String(_) => "string",
                serde_json::Value::Object(_) => "object",
                _ => "other",
            }
        }),
        None => serde_json::Value::Null,
    };
    eprintln!(
        "NATIVE_AUTH_DIAG {}",
        serde_json::json!({
            "path": path,
            "status": status,
            "request_keys": keys,
            "email_len": text("email"),
            "password_len": text("password"),
            "detail": sanitized,
        })
    );
}

#[cfg(all(feature = "native-normal-journey-probe", debug_assertions))]
fn auth_error_diagnostic(path: &str, body: &Option<String>, code: SidecarErrorCode) {
    if path != "/api/v1/auth/login" && path != "/api/v1/auth/register" {
        return;
    }
    let request = body
        .as_deref()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok());
    let keys = request
        .as_ref()
        .and_then(serde_json::Value::as_object)
        .map(|object| {
            let mut keys: Vec<String> = object.keys().cloned().collect();
            keys.sort();
            keys
        });
    eprintln!(
        "NATIVE_AUTH_DIAG {}",
        serde_json::json!({
            "path": path,
            "status": 0,
            "request_keys": keys,
            "error_code": code,
        })
    );
}

/// Talk to the core we spawned. The webview must not fetch :8788 itself
/// (WKWebView blocks or CORS-fails that). Never navigate the webview there.
#[tauri::command]
pub fn sidecar_http(
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: Option<String>,
) -> Result<SidecarHttpResult, SidecarError> {
    let diagnostic_path = path.clone();
    let diagnostic_body = body.clone();
    #[cfg(all(feature = "native-normal-journey-probe", debug_assertions))]
    {
        if method.eq_ignore_ascii_case("GET")
            && path.starts_with("/api/v1/vaults/")
            && path.ends_with("/snapshot")
        {
            SNAPSHOT_GET_ATTEMPTS.fetch_add(1, Ordering::SeqCst);
        }
        if method.eq_ignore_ascii_case("POST") && path.ends_with("/snapshots") {
            SNAPSHOT_POST_ATTEMPTS.fetch_add(1, Ordering::SeqCst);
        }
        if let Some(error) = snapshot_fault(&path) {
            return Err(error);
        }
    }
    let result = request_core(core_port(), method, path, headers, body);
    #[cfg(all(feature = "native-normal-journey-probe", debug_assertions))]
    match &result {
        Ok(ok) => auth_diagnostic(&diagnostic_path, &diagnostic_body, ok.status, &ok.body),
        Err(error) => auth_error_diagnostic(&diagnostic_path, &diagnostic_body, error.code),
    };
    result
}

// A fixed loopback host; the normal command always supplies its fixed core port.
// Unit fixtures supply only their own ephemeral port, never a caller URL.
fn request_core(
    port: u16,
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: Option<String>,
) -> Result<SidecarHttpResult, SidecarError> {
    let url = core_api_url(port, &path)
        .map_err(|_| SidecarError::new(SidecarErrorCode::Validation))?;
    let method = method.to_ascii_uppercase();
    match method.as_str() {
        "GET" | "POST" | "PUT" | "PATCH" | "DELETE" => {}
        _ => return Err(SidecarError::new(SidecarErrorCode::Validation)),
    }
    let agent = ureq::AgentBuilder::new()
        .redirects(0)
        .timeout(Duration::from_secs(15))
        .build();
    let mut req = agent.request_url(&method, &url);
    for (key, value) in &headers {
        if key.eq_ignore_ascii_case("host") || key.eq_ignore_ascii_case("content-length") {
            continue;
        }
        req = req.set(key, value);
    }
    let resp = if let Some(payload) = body {
        req.send_string(&payload)
    } else {
        req.call()
    };
    match resp {
        Ok(ok) => {
            let status = ok.status();
            let text = ok.into_string().unwrap_or_default();
            Ok(SidecarHttpResult { status, body: text })
        }
        Err(ureq::Error::Status(status, ok)) => {
            let text = ok.into_string().unwrap_or_default();
            Ok(SidecarHttpResult { status, body: text })
        }
        Err(ureq::Error::Transport(error)) => {
            Err(SidecarError::new(classify_transport(&error)))
        }
    }
}

#[cfg(test)]
#[path = "sidecar_http_tests.rs"]
mod tests;
