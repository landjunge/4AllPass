use std::{collections::HashMap, error::Error as StdError, time::Duration};

use serde::Serialize;

use crate::process::CORE_PORT;
use crate::sidecar_target::core_api_url;

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

/// Pure ureq kind classification. No message/string matching.
fn transport_code(kind: ureq::ErrorKind) -> Option<SidecarErrorCode> {
    match kind {
        ureq::ErrorKind::ConnectionFailed | ureq::ErrorKind::Dns => {
            Some(SidecarErrorCode::OfflineNetwork)
        }
        ureq::ErrorKind::Io => Some(SidecarErrorCode::OfflineIo),
        // InvalidUrl, UnknownScheme, InsecureRequestHttpsOnly, TooManyRedirects,
        // BadStatus, BadHeader, InvalidProxyUrl, ProxyConnect, ProxyUnauthorized,
        // HTTP and any future variant are not local offline transport failures.
        _ => None,
    }
}

fn io_code(error: &std::io::Error) -> SidecarErrorCode {
    match error.kind() {
        std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock => {
            SidecarErrorCode::OfflineTimeout
        }
        _ => SidecarErrorCode::OfflineIo,
    }
}

fn classify_transport(error: &ureq::Transport) -> SidecarErrorCode {
    match transport_code(error.kind()) {
        Some(SidecarErrorCode::OfflineIo) => StdError::source(error)
            .and_then(|source| source.downcast_ref::<std::io::Error>())
            .map(io_code)
            .unwrap_or(SidecarErrorCode::OfflineIo),
        Some(code) => code,
        None => SidecarErrorCode::Protocol,
    }
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
    request_core(CORE_PORT, method, path, headers, body)
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
