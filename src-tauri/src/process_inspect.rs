//! Who listens on loopback, and who is their parent.
//!
//! Unix used to shell out to `ps` / `lsof` only. Windows has neither.
//! Parsers are OS-free so they can be rustc --test'd like `core_bind.rs`.

use std::process::Command;

pub fn cmd_name(command: &str) -> String {
    std::path::PathBuf::from(command.split_whitespace().next().unwrap_or(""))
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("")
        .to_string()
}

pub fn loopback_listen_pid(port: u16) -> Option<u32> {
    #[cfg(target_os = "linux")]
    {
        if let Some(pid) = linux_proc_listen_pid(port) {
            return Some(pid);
        }
    }
    #[cfg(unix)]
    {
        if let Some(pid) = lsof_listen_pid(port) {
            return Some(pid);
        }
    }
    #[cfg(windows)]
    {
        if let Some(pid) = netstat_listen_pid(port) {
            return Some(pid);
        }
    }
    None
}

pub fn parent_and_command(pid: u32) -> Option<(u32, String)> {
    #[cfg(target_os = "linux")]
    {
        if let Some(row) = linux_proc_parent_and_command(pid) {
            return Some(row);
        }
    }
    #[cfg(unix)]
    {
        if let Some(row) = ps_parent_and_command(pid) {
            return Some(row);
        }
    }
    #[cfg(windows)]
    {
        if let Some(row) = windows_parent_and_command(pid) {
            return Some(row);
        }
    }
    None
}

pub fn terminate(pid: u32) {
    #[cfg(unix)]
    {
        let _ = Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .status();
    }
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .status();
    }
}

pub fn parse_lsof_pids(stdout: &str) -> Option<u32> {
    stdout.lines().find_map(|line| line.trim().parse().ok())
}

pub fn parse_ps_ppid_command(stdout: &str) -> Option<(u32, String)> {
    let line = stdout.trim();
    let (ppid_s, rest) = line.split_once(char::is_whitespace)?;
    Some((ppid_s.trim().parse().ok()?, rest.trim().to_string()))
}

/// `netstat -ano` (Windows). Last column is PID. Match loopback:`port` only.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn parse_netstat_listen_pid(stdout: &str, port: u16) -> Option<u32> {
    let needle_v4 = format!("127.0.0.1:{port}");
    let needle_v6 = format!("[::1]:{port}");
    for line in stdout.lines() {
        let lower = line.to_ascii_lowercase();
        if !lower.contains("listen") && !lower.contains("abhören") {
            continue;
        }
        if !line.contains(&needle_v4) && !line.contains(&needle_v6) {
            continue;
        }
        if let Some(pid) = line.split_whitespace().last().and_then(|s| s.parse().ok()) {
            return Some(pid);
        }
    }
    None
}

/// `/proc/net/tcp` local_address is little-endian IPv4 hex + big-endian port hex.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn parse_proc_tcp_inode(stdout: &str, port: u16) -> Option<u64> {
    let want = format!("0100007F:{port:04X}");
    for line in stdout.lines().skip(1) {
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() < 10 {
            continue;
        }
        if cols[1].eq_ignore_ascii_case(&want) && cols[3] == "0A" {
            return cols[9].parse().ok();
        }
    }
    None
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn parse_proc_stat_ppid(stat: &str) -> Option<u32> {
    let end = stat.rfind(')')?;
    let mut after = stat[end + 1..].split_whitespace();
    let _state = after.next()?;
    after.next()?.parse().ok()
}

#[cfg(unix)]
fn lsof_listen_pid(port: u16) -> Option<u32> {
    let spec = format!("-iTCP:127.0.0.1:{port}");
    for bin in ["lsof", "/usr/sbin/lsof"] {
        let Ok(out) = Command::new(bin)
            .args(["-nP", &spec, "-sTCP:LISTEN", "-t"])
            .output()
        else {
            continue;
        };
        if let Some(pid) = parse_lsof_pids(&String::from_utf8_lossy(&out.stdout)) {
            return Some(pid);
        }
    }
    None
}

#[cfg(unix)]
fn ps_parent_and_command(pid: u32) -> Option<(u32, String)> {
    let out = Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "ppid=", "-o", "command="])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    parse_ps_ppid_command(&String::from_utf8_lossy(&out.stdout))
}

#[cfg(target_os = "linux")]
fn linux_proc_listen_pid(port: u16) -> Option<u32> {
    let tcp = std::fs::read_to_string("/proc/net/tcp").ok()?;
    let inode = parse_proc_tcp_inode(&tcp, port)?;
    let want = format!("socket:[{inode}]");
    let proc = std::fs::read_dir("/proc").ok()?;
    for entry in proc.flatten() {
        let name = entry.file_name();
        let pid: u32 = match name.to_str().and_then(|s| s.parse().ok()) {
            Some(pid) => pid,
            None => continue,
        };
        let fd_dir = entry.path().join("fd");
        let Ok(fds) = std::fs::read_dir(fd_dir) else {
            continue;
        };
        for fd in fds.flatten() {
            if let Ok(target) = std::fs::read_link(fd.path()) {
                if target.to_string_lossy() == want {
                    return Some(pid);
                }
            }
        }
    }
    None
}

#[cfg(target_os = "linux")]
fn linux_proc_parent_and_command(pid: u32) -> Option<(u32, String)> {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let ppid = parse_proc_stat_ppid(&stat)?;
    let cmdline = std::fs::read_to_string(format!("/proc/{pid}/cmdline")).ok()?;
    let cmd = cmdline.replace('\0', " ").trim().to_string();
    if cmd.is_empty() {
        return None;
    }
    Some((ppid, cmd))
}

#[cfg(windows)]
fn netstat_listen_pid(port: u16) -> Option<u32> {
    let out = Command::new("netstat")
        .args(["-ano", "-p", "tcp"])
        .output()
        .ok()?;
    parse_netstat_listen_pid(&String::from_utf8_lossy(&out.stdout), port)
}

#[cfg(windows)]
fn windows_parent_and_command(pid: u32) -> Option<(u32, String)> {
    let script = format!(
        "$p = Get-CimInstance Win32_Process -Filter \"ProcessId={pid}\"; if ($null -eq $p) {{ exit 1 }}; Write-Output $p.ParentProcessId; Write-Output $p.CommandLine"
    );
    let out = Command::new("powershell")
        .args(["-NoProfile", "-Command", &script])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let mut lines = text.lines().map(str::trim).filter(|l| !l.is_empty());
    let ppid: u32 = lines.next()?.parse().ok()?;
    let cmd = lines.next()?.to_string();
    if cmd.is_empty() {
        return None;
    }
    Some((ppid, cmd))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lsof_dash_t_first_pid() {
        assert_eq!(parse_lsof_pids("4242\n"), Some(4242));
        assert_eq!(parse_lsof_pids("\n  99  \n"), Some(99));
        assert_eq!(parse_lsof_pids(""), None);
    }

    #[test]
    fn ps_ppid_and_rest_of_command() {
        assert_eq!(
            parse_ps_ppid_command("  1 /usr/bin/fourallpass-core --port 8788"),
            Some((1, "/usr/bin/fourallpass-core --port 8788".into()))
        );
    }

    #[test]
    fn netstat_loopback_listening_pid() {
        let out = "\
  TCP    0.0.0.0:8788            0.0.0.0:0              LISTENING       11
  TCP    127.0.0.1:8788          0.0.0.0:0              LISTENING       4242
";
        assert_eq!(parse_netstat_listen_pid(out, 8788), Some(4242));
    }

    #[test]
    fn netstat_ignores_established() {
        let out = "  TCP    127.0.0.1:8788          127.0.0.1:9            ESTABLISHED     7\n";
        assert_eq!(parse_netstat_listen_pid(out, 8788), None);
    }

    #[test]
    fn proc_tcp_listen_inode() {
        let out = "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n   0: 0100007F:2254 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 99999 1 0000000000000000 100 0 0 10 0\n";
        assert_eq!(parse_proc_tcp_inode(out, 8788), Some(99999));
    }

    #[test]
    fn proc_stat_ppid_with_spaces_in_comm() {
        let stat = "4242 (four all pass) S 17 17 17 0 -1 4194304 0 0 0 0 0 0 0 0 20 0 1 0 0 0 0";
        assert_eq!(parse_proc_stat_ppid(stat), Some(17));
    }

    #[test]
    fn cmd_name_strips_path() {
        assert_eq!(cmd_name("/usr/bin/fourallpass-core --port 8788"), "fourallpass-core");
        assert_eq!(cmd_name("fourallpass.exe"), "fourallpass.exe");
    }
}
