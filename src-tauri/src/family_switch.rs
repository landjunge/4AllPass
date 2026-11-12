//! Family window switch: call the shared native host with only a catalog id.
//!
//! The web layer may pass only a target catalog id — never a URL, pid or
//! arbitrary argv. This command derives the caller pid, spawns the fixed
//! ``~/.local/bin/kirabridge`` broker *without* a shell, and maps the broker's
//! JSON result to the small outcome vocabulary the shared appbar expects.
//!
//! CLI ABI (ThreadDesk product board 8b7f304ee839 / 9801fc91d30b):
//!   exit 0  => {"success":true,"active_product":TARGET,"actual_outer_bounds":{...},"visible_family_windows":1}
//!   exit!=0 => {"success":false,"error":{"code","message"},"execution_outcome_unknown":bool}
//! A missing broker is reported honestly — never faked as "connected".

use std::process::{Command, Stdio};

const CATALOG_IDS: [&str; 5] = ["kirabridge", "threaddesk", "4allpass", "tollgate", "agent-authority"];

fn map_outcome(status_success: bool, stdout: &[u8], target: &str) -> &'static str {
    let parsed: Option<serde_json::Value> = serde_json::from_slice(stdout).ok();
    if !status_success {
        return match parsed {
            Some(value) if value.get("success").and_then(|v| v.as_bool()) == Some(false) => {
                if value.get("execution_outcome_unknown").and_then(|v| v.as_bool()) == Some(true) {
                    "uncertain"
                } else {
                    "failed"
                }
            }
            _ => "uncertain",
        };
    }
    match parsed {
        Some(value)
            if value.get("success").and_then(|v| v.as_bool()) == Some(true)
                && value.get("active_product").and_then(|v| v.as_str()) == Some(target)
                && value.get("visible_family_windows").and_then(|v| v.as_i64()) == Some(1) =>
        {
            "focused"
        }
        Some(value) if value.get("success").and_then(|v| v.as_bool()) == Some(true) => "opened",
        _ => "uncertain",
    }
}

#[tauri::command]
pub fn family_switch(target: String) -> Result<String, String> {
    if !CATALOG_IDS.contains(&target.as_str()) {
        return Err(format!("unknown product id: {target}"));
    }

    let home = std::env::var("HOME").map_err(|_| "no home directory".to_string())?;
    let broker = format!("{home}/.local/bin/kirabridge");
    let pid = std::process::id();
    let pid_str = pid.to_string();

    // Fixed argv, no shell, no token/key. source-start is optional; the broker
    // captures a fresh identity itself.
    let args: [&str; 7] = [
        "--principal",
        "local",
        "family",
        "switch",
        target.as_str(),
        "--source-pid",
        pid_str.as_str(),
    ];
    let output = Command::new(&broker)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|error| match error.kind() {
            std::io::ErrorKind::NotFound => "broker not found".to_string(),
            _ => format!("broker spawn failed: {error}"),
        })?;

    if !output.status.success() && output.stdout.is_empty() {
        // Broker died without a JSON body: treat as an unknown outcome.
        return Ok("uncertain".to_string());
    }

    Ok(map_outcome(output.status.success(), &output.stdout, &target).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unknown_catalog_id() {
        assert!(family_switch("evil".to_string()).is_err());
        assert!(family_switch("".to_string()).is_err());
    }

    #[test]
    fn maps_confirmed_switch_to_focused() {
        let out = br#"{"success":true,"active_product":"kirabridge","actual_outer_bounds":{"x":1,"y":2,"width":800,"height":600},"visible_family_windows":1}"#;
        assert_eq!(map_outcome(true, out, "kirabridge"), "focused");
    }

    #[test]
    fn maps_known_error_to_failed() {
        let out = br#"{"success":false,"error":{"code":"NO_SUCH_PRODUCT","message":"x"},"execution_outcome_unknown":false}"#;
        assert_eq!(map_outcome(false, out, "tollgate"), "failed");
    }

    #[test]
    fn maps_unknown_error_to_uncertain() {
        let out = br#"{"success":false,"error":{"code":"IO","message":"x"},"execution_outcome_unknown":true}"#;
        assert_eq!(map_outcome(false, out, "agent-authority"), "uncertain");
    }

    #[test]
    fn maps_malformed_success_to_uncertain() {
        assert_eq!(map_outcome(true, b"not json", "threaddesk"), "uncertain");
    }
}
