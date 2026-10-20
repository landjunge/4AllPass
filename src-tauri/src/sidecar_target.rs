//! Fixed local core target, checked after the same URL parsing used by ureq.
use crate::process::CORE_HOST;
use tauri::Url;

fn is_api_path(path: &str) -> bool {
    path == "/api/v1" || path.starts_with("/api/v1/")
}

pub(crate) fn core_api_url(port: u16, path: &str) -> Result<Url, String> {
    let invalid = || "invalid sidecar API target".to_string();
    // Separate query values: encoded delimiters there are ordinary data.
    let pathname = path.split('?').next().unwrap_or_default();
    let lower = pathname.to_ascii_lowercase();
    if !is_api_path(pathname)
        || path.chars().any(|c| c.is_ascii_control() || c == ' ')
        || pathname.contains('\\')
        || lower.contains("%2f")
        || lower.contains("%5c")
    {
        return Err(invalid());
    }
    let url = Url::parse(&format!("http://{CORE_HOST}:{port}{path}")).map_err(|_| invalid())?;
    // Raw/encoded dot segments are normalized by Url. Inspect that actual target,
    // not only the caller's prefix. Never pass a fragment or alternative authority.
    if url.scheme() != "http"
        || url.host_str() != Some(CORE_HOST)
        || url.port_or_known_default() != Some(port)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || !is_api_path(url.path())
    {
        return Err(invalid());
    }
    Ok(url)
}
