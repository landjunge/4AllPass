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

use std::io::Read;
use std::process::{Child, Command, Stdio};
use std::sync::{
    atomic::{AtomicU8, Ordering},
    mpsc,
};
use std::time::{Duration, Instant};

const CATALOG_IDS: [&str; 5] = [
    "kirabridge",
    "threaddesk",
    "4allpass",
    "tollgate",
    "agent-authority",
];
const BROKER_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_OUTPUT: usize = 64 * 1024;
// 0: idle, 1: running, 2: unknown. Process-wide, survives header remounts.
static SWITCH_STATE: AtomicU8 = AtomicU8::new(0);

fn has_outer_bounds(value: Option<&serde_json::Value>) -> bool {
    value.is_some_and(|v| {
        ["x", "y", "width", "height"].iter().all(|key| {
            v.get(*key)
                .and_then(|n| n.as_f64())
                .is_some_and(|n| n.is_finite() && (!matches!(*key, "width" | "height") || n > 0.0))
        })
    })
}

fn map_outcome(status_success: bool, stdout: &[u8], target: &str) -> &'static str {
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(stdout) else {
        return "uncertain";
    };
    // Unknown overrides even exit 0 and an apparently successful receipt.
    let unknown = value.get("execution_outcome_unknown");
    if unknown.is_some() && unknown.and_then(|v| v.as_bool()) != Some(false) {
        return "uncertain";
    }
    if !status_success {
        return if value.get("success").and_then(|v| v.as_bool()) == Some(false)
            && unknown.and_then(|v| v.as_bool()) == Some(false)
        {
            "failed"
        } else {
            "uncertain"
        };
    }
    if value.get("success").and_then(|v| v.as_bool()) == Some(true)
        && value.get("active_product").and_then(|v| v.as_str()) == Some(target)
        && value.get("visible_family_windows").and_then(|v| v.as_i64()) == Some(1)
        && has_outer_bounds(value.get("actual_outer_bounds"))
    {
        "focused"
    } else {
        "uncertain"
    }
}

fn retire(mut child: Child) {
    // Signal only our child. Cleanup does not undo side effects or permit retry.
    let _ = child.kill();
    std::thread::spawn(move || {
        let _ = child.wait();
    });
}

fn run_broker(mut command: Command, target: &str, timeout: Duration) -> Result<String, String> {
    let deadline = Instant::now() + timeout;
    let mut child = match command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(child) => child,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok("missing".into()),
        Err(error) => return Err(format!("broker spawn failed: {error}")),
    };
    let Some(stdout) = child.stdout.take() else {
        retire(child);
        return Ok("uncertain".into());
    };
    let (send, receive) = mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let result = stdout.take((MAX_OUTPUT + 1) as u64).read_to_end(&mut bytes);
        let _ = send.send(result.map(|_| bytes));
    });
    let status = loop {
        if Instant::now() >= deadline {
            retire(child);
            return Ok("uncertain".into());
        }
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => std::thread::sleep(
                Duration::from_millis(10).min(deadline.saturating_duration_since(Instant::now())),
            ),
            Err(_) => {
                retire(child);
                return Ok("uncertain".into());
            }
        }
    };
    // Descendants may retain stdout after exit. EOF shares the same deadline.
    match receive.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
        Ok(Ok(bytes)) if bytes.len() <= MAX_OUTPUT => {
            Ok(map_outcome(status.success(), &bytes, target).into())
        }
        _ => Ok("uncertain".into()),
    }
}

fn begin(state: &AtomicU8) -> bool {
    state
        .compare_exchange(0, 1, Ordering::SeqCst, Ordering::SeqCst)
        .is_ok()
}

fn finish(state: &AtomicU8, result: &Result<String, String>) {
    state.store(
        if matches!(result, Ok(outcome) if outcome == "uncertain") {
            2
        } else {
            0
        },
        Ordering::SeqCst,
    );
}

#[tauri::command]
pub async fn family_switch(target: String) -> Result<String, String> {
    if !CATALOG_IDS.contains(&target.as_str()) {
        return Err(format!("unknown product id: {target}"));
    }
    let home = std::env::var("HOME").map_err(|_| "no home directory".to_string())?;
    if !begin(&SWITCH_STATE) {
        return Ok("uncertain".into());
    }
    // Yield IPC immediately. Dropping its future does not cancel the worker.
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut command = Command::new(format!("{home}/.local/bin/kirabridge"));
        command.args([
            "--principal",
            "local",
            "family",
            "switch",
            &target,
            "--source-pid",
            &std::process::id().to_string(),
        ]);
        let result = run_broker(command, &target, BROKER_TIMEOUT);
        finish(&SWITCH_STATE, &result);
        result
    })
    .await;
    match result {
        Ok(result) => result,
        Err(_) => {
            SWITCH_STATE.store(2, Ordering::SeqCst);
            Ok("uncertain".into())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    fn receipt() -> Value {
        json!({"success":true,"active_product":"kirabridge","actual_outer_bounds":{"x":-100,"y":0,"width":800,"height":600},"visible_family_windows":1})
    }
    fn mapped(value: Value, exit_ok: bool) -> &'static str {
        map_outcome(exit_ok, &serde_json::to_vec(&value).unwrap(), "kirabridge")
    }
    #[test]
    fn rejects_unknown_catalog_id() {
        for target in ["evil", ""] {
            assert!(tauri::async_runtime::block_on(family_switch(target.into())).is_err());
        }
    }
    #[test]
    fn requires_complete_strict_success_receipt() {
        assert_eq!(mapped(receipt(), true), "focused");
        for (key, value) in [
            ("success", json!(1)),
            ("success", json!("true")),
            ("active_product", json!("threaddesk")),
            ("visible_family_windows", json!(1.0)),
            ("visible_family_windows", json!(true)),
            ("visible_family_windows", json!(2)),
            ("execution_outcome_unknown", json!(true)),
            ("execution_outcome_unknown", json!(0)),
        ] {
            let mut out = receipt();
            out[key] = value;
            assert_eq!(mapped(out, true), "uncertain", "{key}");
        }
        assert_eq!(mapped(receipt(), false), "uncertain");
        for key in [
            "success",
            "active_product",
            "visible_family_windows",
            "actual_outer_bounds",
        ] {
            let mut out = receipt();
            out.as_object_mut().unwrap().remove(key);
            assert_eq!(mapped(out, true), "uncertain", "missing {key}");
        }
        for key in ["x", "y", "width", "height"] {
            for value in [json!(null), json!("1"), json!(true)] {
                let mut out = receipt();
                out["actual_outer_bounds"][key] = value;
                assert_eq!(mapped(out, true), "uncertain");
            }
        }
        for key in ["width", "height"] {
            for value in [0, -1] {
                let mut out = receipt();
                out["actual_outer_bounds"][key] = json!(value);
                assert_eq!(mapped(out, true), "uncertain");
            }
        }
        for bytes in [
            b"not json".as_slice(),
            br#"{"success":true,"actual_outer_bounds":{"x":1e999}}"#,
        ] {
            assert_eq!(map_outcome(true, bytes, "kirabridge"), "uncertain");
        }
    }
    #[test]
    fn failure_must_explicitly_have_known_outcome() {
        assert_eq!(
            mapped(
                json!({"success":false,"execution_outcome_unknown":false}),
                false
            ),
            "failed"
        );
        for out in [
            json!({"success":false}),
            json!({"success":false,"execution_outcome_unknown":true}),
            json!({"success":false,"execution_outcome_unknown":0}),
        ] {
            assert_eq!(mapped(out, false), "uncertain");
        }
    }
    #[test]
    fn unknown_and_inflight_block_reentry() {
        let state = AtomicU8::new(0);
        assert!(begin(&state));
        assert!(!begin(&state));
        finish(&state, &Ok("focused".into()));
        assert!(begin(&state));
        finish(&state, &Ok("uncertain".into()));
        assert!(!begin(&state));
        assert_eq!(state.load(Ordering::SeqCst), 2);
    }
    #[cfg(unix)]
    fn fixture(script: &str) -> Command {
        let mut cmd = Command::new("/bin/sh");
        cmd.args(["-c", script]);
        cmd
    }
    #[test]
    #[cfg(unix)]
    fn bounded_wait_yields_runtime_and_blocks_late_result() {
        let start = Instant::now();
        let state = AtomicU8::new(0);
        assert!(begin(&state));
        let worker = tauri::async_runtime::spawn_blocking(|| {
            run_broker(
                fixture("sleep 0.3; printf '{}'"),
                "kirabridge",
                Duration::from_millis(60),
            )
        });
        let heartbeat = tauri::async_runtime::spawn(async { 42 });
        assert_eq!(tauri::async_runtime::block_on(heartbeat).unwrap(), 42);
        let result = tauri::async_runtime::block_on(worker).unwrap();
        assert_eq!(result.as_deref(), Ok("uncertain"));
        assert!(start.elapsed() < Duration::from_millis(250));
        finish(&state, &result);
        assert!(!begin(&state));
        std::thread::sleep(Duration::from_millis(350));
        assert!(!begin(&state));
    }
    #[test]
    #[cfg(unix)]
    fn capped_output_and_descendant_pipe_are_uncertain() {
        for script in ["head -c 70000 /dev/zero", "sleep 0.3 & printf '{}'"] {
            let start = Instant::now();
            assert_eq!(
                run_broker(fixture(script), "kirabridge", Duration::from_millis(60)).as_deref(),
                Ok("uncertain")
            );
            assert!(start.elapsed() < Duration::from_millis(250));
        }
    }

    #[test]
    #[cfg(unix)]
    fn actual_process_requires_receipt_and_zero_exit() {
        let body = receipt().to_string();
        for (exit, expected) in [(0, "focused"), (1, "uncertain")] {
            let script = format!("printf '%s' '{body}'; exit {exit}");
            assert_eq!(
                run_broker(fixture(&script), "kirabridge", Duration::from_secs(2)).as_deref(),
                Ok(expected)
            );
        }
    }
}
