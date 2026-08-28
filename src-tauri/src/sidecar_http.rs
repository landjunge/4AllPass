use std::{collections::HashMap, time::Duration};

use crate::process::{CORE_HOST, CORE_PORT};

#[derive(serde::Serialize)]
pub struct SidecarHttpResult {
    status: u16,
    body: String,
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
    if !path.starts_with("/api/v1/") && path != "/api/v1" {
        return Err("sidecar_http path must be /api/v1/…".into());
    }
    if path.contains('\n') || path.contains('\r') || path.contains(' ') {
        return Err("invalid path".into());
    }
    let method = method.to_ascii_uppercase();
    match method.as_str() {
        "GET" | "POST" | "PUT" | "PATCH" | "DELETE" => {}
        _ => return Err("method not allowed".into()),
    }
    let url = format!("http://{CORE_HOST}:{CORE_PORT}{path}");
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(15))
        .build();
    let mut req = agent.request(&method, &url);
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
            Ok(SidecarHttpResult {
                status,
                body: text,
            })
        }
        Err(ureq::Error::Status(status, ok)) => {
            let text = ok.into_string().unwrap_or_default();
            Ok(SidecarHttpResult {
                status,
                body: text,
            })
        }
        Err(err) => Err(err.to_string()),
    }
}
