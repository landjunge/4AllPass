#!/usr/bin/env python3
"""Isolated native WKWebView legacy-migration proof for the AP286 test fork.

Test-only: debug probe on a private ephemeral loopback port, fresh task dir,
synthetic throwaway backend. Never touches 8788, the production app, a real
vault, a user profile, or an installed app.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]
PROD_PORT = 8788
ACCOUNT_EMAIL = "native-migration-fixture@example.com"
ACCOUNT_PASSWORD = "Native migration account fixture 2026!"
VAULT_PASSWORD = "Native legacy vault fixture 2026!"
DEVICE_ID = "native-migration-fixture-device"


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def tree_digest(folder: Path) -> str:
    lines = []
    for path in sorted(folder.rglob("*")):
        if path.is_file():
            lines.append(f"{digest(path)}  {path.relative_to(folder).as_posix()}")
    return hashlib.sha256("\n".join(lines).encode()).hexdigest()


def port_free(port: int) -> bool:
    if port <= 1024 or port == PROD_PORT:
        return False
    found = subprocess.run(
        ["/usr/sbin/lsof", "-nP", "-t", f"-iTCP:{port}", "-sTCP:LISTEN"],
        capture_output=True,
        text=True,
    )
    if found.returncode not in (0, 1) or found.stdout.strip():
        return False
    try:
        with socket.socket() as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.bind(("127.0.0.1", port))
        return True
    except OSError:
        return False


def choose_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    if port <= 1024 or port == PROD_PORT or not port_free(port):
        raise RuntimeError("no isolated loopback port")
    return port


def run(command, log, *, env, cwd=ROOT, timeout=600):
    with log.open("w") as stream:
        result = subprocess.run(
            command, cwd=cwd, env=env, stdout=stream, stderr=subprocess.STDOUT, timeout=timeout
        )
    if result.returncode:
        raise RuntimeError(f"command failed ({result.returncode}); private log: {log}")


def http_json(method, url, body=None, headers=None, timeout=30):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        raw = response.read()
    return json.loads(raw) if raw else None


def wait_health(port: int, proc: subprocess.Popen, log_path: Path) -> None:
    for _ in range(120):
        if proc.poll() is not None:
            raise RuntimeError(f"seed backend exited early; private log: {log_path}")
        try:
            health = http_json("GET", f"http://127.0.0.1:{port}/api/v1/health", timeout=2)
            if health.get("database") is True and health.get("profile") == "local":
                return
        except (OSError, urllib.error.URLError, json.JSONDecodeError):
            pass
        time.sleep(0.25)
    raise RuntimeError("seed backend health timeout")


def seed_legacy_backend(
    python: Path, output: Path, dist: Path, seed_port: int
) -> dict:
    seed_root = output / f"seed-{uuid.uuid4().hex}"
    seed_data = seed_root / "data"
    seed_data.mkdir(parents=True, exist_ok=True)
    log_path = output / "seed-backend.log"
    env = {k: v for k, v in os.environ.items() if not k.startswith(("FOURALLPASS_", "TAURI_", "VITE_", "PYTHON"))}
    env["FOURALLPASS_DATA_DIR"] = str(seed_data)
    with log_path.open("wb") as log:
        proc = subprocess.Popen(
            [
                str(python),
                "-m",
                "app.local",
                "--port",
                str(seed_port),
                "--data-dir",
                str(seed_data),
                "--ui-dist",
                str(dist),
            ],
            cwd=ROOT / "backend",
            env=env,
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        try:
            wait_health(seed_port, proc, log_path)
            base = f"http://127.0.0.1:{seed_port}/api/v1"
            headers = {"Content-Type": "application/json", "X-Device-Id": DEVICE_ID}
            session = http_json(
                "POST",
                f"{base}/auth/register",
                {"email": ACCOUNT_EMAIL, "password": ACCOUNT_PASSWORD},
                headers,
            )
            auth = dict(headers, Authorization=f"Bearer {session['token']}")
            vault = http_json("POST", f"{base}/vaults", None, auth)
            vault_id = vault["vaultId"]
            wire_path = seed_root / "legacy-wire.json"
            fixture_env = {
                k: v
                for k, v in os.environ.items()
                if not k.startswith(("FOURALLPASS_", "TAURI_", "VITE_", "PYTHON"))
            }
            node = subprocess.run(
                [
                    "node",
                    "--import",
                    "tsx",
                    "scripts/make-native-legacy-fixture.mjs",
                    vault_id,
                    VAULT_PASSWORD,
                    str(wire_path),
                ],
                cwd=ROOT,
                env=fixture_env,
                capture_output=True,
                text=True,
                timeout=300,
            )
            if node.returncode:
                raise RuntimeError(f"fixture generator failed: {node.stderr[-2000:]}")
            wire = json.loads(wire_path.read_text())
            snapshot = {
                "expectedRevision": None,
                "revision": 1,
                "vaultKeyVersion": 1,
                "cryptoProtocolVersion": 1,
                "envelopes": wire["envelopes"],
                "entries": wire["entries"],
            }
            committed = http_json(
                "POST", f"{base}/vaults/{vault_id}/snapshots", snapshot, auth
            )
            if committed.get("sealedManifest") is not None:
                raise RuntimeError("seeded legacy snapshot unexpectedly sealed")
        finally:
            if proc.poll() is None:
                proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=5)
    for _ in range(80):
        if port_free(seed_port):
            break
        time.sleep(0.1)
    if not port_free(seed_port):
        raise RuntimeError("seed backend port did not release")
    return {
        "seed_data": str(seed_data),
        "seed_port": seed_port,
        "vault_id": vault_id,
        "wire_path": str(wire_path),
        "wire_sha256": digest(wire_path),
        "revision": 1,
        "sealed_manifest": False,
    }


def negative_port_checks(binary: Path, output: Path, base_env: dict) -> dict:
    results = {}
    cases = {
        "missing": None,
        "invalid_8788": "8788",
        "invalid_80": "80",
    }
    for name, value in cases.items():
        task = output / f"port-{name}-{uuid.uuid4().hex}"
        env = dict(base_env)
        env.pop("TAURI_CONFIG", None)
        env["FOURALLPASS_NATIVE_SCENARIO"] = "legacy-known"
        env.pop("FOURALLPASS_TEST_CORE_PORT", None)
        if value is not None:
            env["FOURALLPASS_TEST_CORE_PORT"] = value
        env["FOURALLPASS_DATA_DIR"] = str(task / "data")
        log_path = output / f"port-{name}.log"
        with log_path.open("w") as log:
            result = subprocess.run(
                [str(binary), str(task)],
                cwd=output,
                env=env,
                stdout=log,
                stderr=subprocess.STDOUT,
                timeout=30,
            )
        results[name] = {
            "returncode": result.returncode,
            "task_absent": not task.exists(),
            "data_absent": not (task / "data").exists(),
            "failed_before_spawn": result.returncode != 0 and not task.exists(),
            "log": str(log_path),
        }
    occupied_port = choose_port()
    task = output / f"port-occupied-{uuid.uuid4().hex}"
    env = dict(base_env)
    env.pop("TAURI_CONFIG", None)
    env["FOURALLPASS_NATIVE_SCENARIO"] = "legacy-known"
    env["FOURALLPASS_TEST_CORE_PORT"] = str(occupied_port)
    env["FOURALLPASS_DATA_DIR"] = str(task / "data")
    with socket.socket() as listener:
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind(("127.0.0.1", occupied_port))
        listener.listen(2)
        log_path = output / "port-occupied.log"
        with log_path.open("w") as log:
            result = subprocess.run(
                [str(binary), str(task)],
                cwd=output,
                env=env,
                stdout=log,
                stderr=subprocess.STDOUT,
                timeout=30,
            )
    results["occupied"] = {
        "port": occupied_port,
        "returncode": result.returncode,
        "task_created": task.exists(),
        "data_absent": not (task / "data").exists(),
        "refused_before_sidecar": result.returncode == 1 and not (task / "data").exists(),
        "log": str(log_path),
    }
    results["all_failed_closed"] = (
        results["missing"]["failed_before_spawn"]
        and results["invalid_8788"]["failed_before_spawn"]
        and results["invalid_80"]["failed_before_spawn"]
        and results["occupied"]["refused_before_sidecar"]
    )
    return results


def db_counts(db: Path) -> dict:
    with sqlite3.connect(db.as_uri() + "?mode=ro", uri=True) as connection:
        tables = {
            row[0]
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        counts = {
            name: connection.execute(f'SELECT count(*) FROM "{name}"').fetchone()[0]
            for name in ["users", "vaults", "vault_snapshots", "encrypted_entries", "key_envelopes"]
            if name in tables
        }
        revisions = [
            row[0]
            for row in connection.execute(
                "SELECT revision FROM vault_snapshots ORDER BY revision"
            )
        ]
    return {"counts": counts, "revisions": revisions}


def run_scenario(binary: Path, output: Path, base_env: dict, dist: Path, scenario: str, python: Path) -> dict:
    test_port = choose_port()
    seed_port = choose_port()
    if seed_port == test_port:
        seed_port = choose_port()
    negatives = negative_port_checks(binary, output, base_env)
    if not negatives["all_failed_closed"]:
        raise RuntimeError("port negative checks failed; refusing native run")
    seed = seed_legacy_backend(python, output, dist, seed_port)
    task = output / f"run-{scenario}-{uuid.uuid4().hex}"
    if task.exists():
        raise RuntimeError("task dir must be fresh")
    log_path = output / f"native-{scenario}.log"
    env = dict(base_env)
    env.pop("TAURI_CONFIG", None)
    env["FOURALLPASS_DATA_DIR"] = str(task / "data")
    env["FOURALLPASS_TEST_CORE_PORT"] = str(test_port)
    env["FOURALLPASS_NATIVE_SCENARIO"] = scenario
    env["FOURALLPASS_NATIVE_SEED_DATA"] = seed["seed_data"]
    with log_path.open("w") as log:
        proc = subprocess.Popen(
            [str(binary), str(task)],
            cwd=output,
            env=env,
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        try:
            proc.wait(timeout=300)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, 15)
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid, 9)
                proc.wait(timeout=5)
            raise RuntimeError(f"native probe timeout; private log: {log_path}")
    if proc.returncode not in (0, 1):
        raise RuntimeError(f"native probe exit {proc.returncode}; private log: {log_path}")
    for _ in range(100):
        if port_free(test_port):
            break
        time.sleep(0.1)
    port_released = port_free(test_port)
    if not port_released:
        raise RuntimeError("native probe test port still held; no foreign cleanup attempted")
    remaining = subprocess.run(
        ["pgrep", "-fl", str(binary)], capture_output=True, text=True
    ).stdout.strip()
    result_path = task / "native-result.json"
    if not result_path.is_file():
        raise RuntimeError(f"native-result.json missing; private log: {log_path}")
    result = json.loads(result_path.read_text())
    db = task / "data/vault.db"
    counts = db_counts(db)
    connection = sqlite3.connect(db.as_uri() + "?mode=ro", uri=True)
    with connection:
        tables = {
            row[0]
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        kdf_metadata = []
        if "key_envelopes" in tables:
            for (raw,) in connection.execute(
                "SELECT kdf_params FROM key_envelopes WHERE type='master'"
            ):
                params = json.loads(raw)
                kdf_metadata.append(
                    {
                        key: params[key]
                        for key in [
                            "algorithm",
                            "version",
                            "memory",
                            "iterations",
                            "parallelism",
                            "hashLen",
                        ]
                    }
                )
    markers = [
        b"Native legacy fixture",
        b"synthetic-legacy-password",
        VAULT_PASSWORD.encode(),
        ACCOUNT_PASSWORD.encode(),
    ]
    opaque = all(marker not in db.read_bytes() for marker in markers)
    evidence = {
        "scenario": scenario,
        "sourcePin": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
        "releaseSourcePin": "620e8c6d8dcb3917a371d7a3f0af832d9931edcd",
        "sourceDirty": bool(subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT, text=True)),
        "testPort": test_port,
        "portIsolation": "ephemeral-own",
        "seed": seed,
        "negativePortChecks": negatives,
        "nativeResult": result,
        "privateDbCounts": counts["counts"],
        "revisions": counts["revisions"],
        "noSyntheticPlaintextInDb": opaque,
        "portReleased": port_released,
        "remainingProbeProcesses": remaining,
        "kdfMetadataWithoutSalt": kdf_metadata,
        "frontendDistTree": tree_digest(dist),
        "nativeLog": str(log_path),
        "boundaries": [
            "test-only debug probe on private ephemeral port; 8788 never bound or trusted",
            "single native WKWebView context; no two-native-context claim",
            "unknown-fields fixture is a client IDB head-cache fixture; the server schema forbids extra wire fields",
            "no install/real vault/user profile/OS rights/production app termination",
        ],
    }
    return evidence


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--build-python", type=Path, required=True)
    parser.add_argument("--release-dist", type=Path)
    parser.add_argument("--build-dir", type=Path)
    parser.add_argument(
        "--scenarios",
        default="legacy-known,legacy-unknown-fields",
        help="comma-separated legacy-known,legacy-unknown-fields",
    )
    args = parser.parse_args()
    if sys.platform != "darwin":
        parser.error("requires native macOS WKWebView")
    os.umask(0o077)
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    output.chmod(0o700)
    env = {
        k: v
        for k, v in os.environ.items()
        if not k.startswith(("FOURALLPASS_", "TAURI_", "VITE_", "PYTHON"))
    }
    for key in ["DATABASE_URL", "REDIS_URL", "API_ORIGIN", "CARGO_TARGET_DIR"]:
        env.pop(key, None)
    args.build_python.resolve(strict=True)
    python = args.build_python.absolute()
    identity = subprocess.check_output(
        [
            str(python),
            "-I",
            "-c",
            "import json,sys,importlib.metadata as m; print(json.dumps(dict(version=sys.version,prefix=sys.prefix,base_prefix=sys.base_prefix,pyinstaller=m.version('pyinstaller'),hooks=m.version('pyinstaller-hooks-contrib'))))",
        ],
        env=env,
        text=True,
    )
    identity = json.loads(identity)
    if (
        not identity["version"].startswith("3.12.")
        or identity["prefix"] == identity["base_prefix"]
        or identity["pyinstaller"] != "6.22.2"
        or identity["hooks"] != "2026.7"
    ):
        raise RuntimeError("private buildvenv/pinned packager required")
    build = (args.build_dir or (output / "build")).resolve()
    build.mkdir(parents=True, exist_ok=True)
    dist = build / "dist"
    run(
        ["npm", "run", "build", "-w", "@4allpass/frontend", "--", "--outDir", str(dist)],
        output / "frontend-build.log",
        env=env,
    )
    sources = sorted(
        [
            *(ROOT / "backend/app").rglob("*.py"),
            ROOT / "backend/requirements.txt",
            ROOT / "backend/requirements-sidecar.txt",
            ROOT / "LICENSE",
        ]
    )
    inputs = {str(p.relative_to(ROOT)): digest(p) for p in sources}
    inputs.update(
        {
            "dist/" + str(p.relative_to(dist)): digest(p)
            for p in sorted(dist.rglob("*"))
            if p.is_file()
        }
    )
    sidecar = build / "sidecar/fourallpass-core"
    receipt = build / "sidecar-inputs.json"
    previous = json.loads(receipt.read_text()) if receipt.exists() else {}
    if (
        not sidecar.is_file()
        or previous.get("inputs") != inputs
        or previous.get("binarySha256") != digest(sidecar)
    ):
        command = [
            str(python),
            "-I",
            "-m",
            "PyInstaller",
            "--noconfirm",
            "--clean",
            "--onefile",
            "--name",
            "fourallpass-core",
            "--paths",
            str(ROOT / "backend"),
            "--distpath",
            str(sidecar.parent),
            "--workpath",
            str(build / "pyinstaller-work"),
            "--specpath",
            str(build),
            "--add-data",
            str(dist) + ":frontend/dist",
            "--add-data",
            str(ROOT / "LICENSE") + ":.",
        ]
        for module in [
            "uvicorn.logging",
            "uvicorn.loops.auto",
            "uvicorn.protocols.http.auto",
            "uvicorn.protocols.websockets.auto",
            "uvicorn.lifespan.on",
            "aiosqlite",
            "greenlet",
            "app.main",
            "app.local",
            "app.broker",
        ]:
            command += ["--hidden-import", module]
        command += [str(ROOT / "backend/app/local.py")]
        run(command, output / "sidecar-build.log", env=env, cwd=build)
        receipt.write_text(
            json.dumps({"inputs": inputs, "binarySha256": digest(sidecar)}, indent=2) + "\n"
        )
    config = json.loads((ROOT / "src-tauri/tauri.conf.json").read_text())
    window = config["app"]["windows"][0]
    window.update(
        {"create": False, "incognito": True, "title": "4AllPass private legacy migration"}
    )
    overlay = {
        "productName": "4AllPass Legacy Migration Probe",
        "identifier": "de.netzwerkpunkt.fourallpass.normal-journey-probe",
        "build": {
            "beforeDevCommand": None,
            "beforeBuildCommand": None,
            "devUrl": None,
            "frontendDist": str(dist),
        },
        "app": {"windows": [window]},
        "bundle": {"active": False, "externalBin": [], "resources": []},
    }
    env["TAURI_CONFIG"] = json.dumps(overlay)
    env["CARGO_TARGET_DIR"] = str(build / "cargo-target")
    (build / "tauri-overlay.json").write_text(json.dumps(overlay, indent=2) + "\n")
    run(
        [
            "cargo",
            "build",
            "--locked",
            "--manifest-path",
            str(ROOT / "src-tauri/Cargo.toml"),
            "--features",
            "custom-protocol,native-normal-journey-probe",
            "--bin",
            "fourallpass-normal-journey-probe",
            "--jobs",
            "2",
        ],
        output / "native-build.log",
        env=env,
        timeout=1200,
    )
    binary = build / "cargo-target/debug/fourallpass-normal-journey-probe"
    shutil.copy2(sidecar, binary.parent / "fourallpass-core")
    scenarios = [item.strip() for item in args.scenarios.split(",") if item.strip()]
    if not scenarios or any(item not in {"legacy-known", "legacy-unknown-fields"} for item in scenarios):
        parser.error("unknown scenario selection")
    results = [
        run_scenario(binary, output, env, dist, scenario, python) for scenario in scenarios
    ]
    run_evidence = {
        "schema": "ap286-native-legacy-migration-v1",
        "releaseSourcePin": "620e8c6d8dcb3917a371d7a3f0af832d9931edcd",
        "testDeltaPin": subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
        ).strip(),
        "sourceDirty": bool(
            subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT, text=True)
        ),
        "python": identity,
        "binarySha256": digest(binary),
        "sidecarSha256": digest(sidecar),
        "tauriOverlaySha256": digest(build / "tauri-overlay.json"),
        "inputSources": inputs,
        "frontendDistTree": tree_digest(dist),
        "releaseFrontendDistTree": tree_digest(args.release_dist) if args.release_dist else None,
        "frontendAssetsIdentical": (
            tree_digest(dist) == tree_digest(args.release_dist)
            if args.release_dist
            else None
        ),
        "scenarios": results,
    }
    (output / "run.json").write_text(json.dumps(run_evidence, indent=2) + "\n")
    failed = [item["scenario"] for item in results if not item["nativeResult"].get("passed")]
    if failed:
        raise RuntimeError(f"native migration oracle failed: {', '.join(failed)}; see {output}")
    print(f"Native legacy migration probes passed; private evidence: {output}")


if __name__ == "__main__":
    main()
