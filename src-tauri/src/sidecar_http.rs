use std::{collections::HashMap, time::Duration};
#[cfg(all(feature = "native-normal-journey-probe", debug_assertions))]
use std::sync::atomic::{AtomicUsize, Ordering};

use crate::process::core_port;
use crate::sidecar_target::core_api_url;

#[cfg(all(feature = "native-normal-journey-probe", debug_assertions))]
static SNAPSHOT_POST_ATTEMPTS: AtomicUsize = AtomicUsize::new(0);

#[cfg(all(feature = "native-normal-journey-probe", debug_assertions))]
pub(crate) fn snapshot_post_attempts() -> usize {
    SNAPSHOT_POST_ATTEMPTS.load(Ordering::SeqCst)
}

#[derive(serde::Serialize)]
pub struct SidecarHttpResult {
    status: u16,
    body: String,
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

/// Talk to the core we spawned. The webview must not fetch :8788 itself
/// (WKWebView blocks or CORS-fails that). Never navigate the webview there.
#[tauri::command]
pub fn sidecar_http(
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: Option<String>,
) -> Result<SidecarHttpResult, String> {
    let diagnostic_path = path.clone();
    let diagnostic_body = body.clone();
    #[cfg(all(feature = "native-normal-journey-probe", debug_assertions))]
    if method.eq_ignore_ascii_case("POST") && path.ends_with("/snapshots") {
        SNAPSHOT_POST_ATTEMPTS.fetch_add(1, Ordering::SeqCst);
    }
    let result = request_core(core_port(), method, path, headers, body)?;
    #[cfg(all(feature = "native-normal-journey-probe", debug_assertions))]
    auth_diagnostic(&diagnostic_path, &diagnostic_body, result.status, &result.body);
    Ok(result)
}

// A fixed loopback host; the normal command always supplies its fixed core port.
// Unit fixtures supply only their own ephemeral port, never a caller URL.
fn request_core(
    port: u16,
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: Option<String>,
) -> Result<SidecarHttpResult, String> {
    let url = core_api_url(port, &path)?;
    let method = method.to_ascii_uppercase();
    match method.as_str() {
        "GET" | "POST" | "PUT" | "PATCH" | "DELETE" => {}
        _ => return Err("method not allowed".into()),
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
        Err(err) => Err(err.to_string()),
    }
}

#[cfg(test)]
#[path = "sidecar_http_tests.rs"]
mod tests;
