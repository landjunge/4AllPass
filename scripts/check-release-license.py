"""Targeted package/license/startup evidence, using synthetic temp storage only."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import re
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def source_checks():
    license_bytes = (ROOT / "LICENSE").read_bytes()
    text = license_bytes.decode()
    assert text.startswith("Netzwerkpunkt Personal Use License 1.0")
    assert "DEUTSCH — maßgebliche Fassung" in text and "ENGLISH — translation" in text
    config = json.loads((ROOT / "src-tauri/tauri.conf.json").read_text())
    assert config["bundle"]["licenseFile"] == "../LICENSE"
    assert "../LICENSE" in config["bundle"]["resources"]
    assert 'license-file = "../LICENSE"' in (ROOT / "src-tauri/Cargo.toml").read_text()
    assert "PolyForm" not in (ROOT / "src-tauri/Cargo.toml").read_text()
    for path in [
        ROOT / "package.json",
        ROOT / "frontend/package.json",
        ROOT / "extension/package.json",
        *ROOT.glob("packages/*/package.json"),
    ]:
        data = json.loads(path.read_text())
        assert data["license"].startswith("SEE LICENSE IN "), path
        assert (
            path.parent / data["license"].removeprefix("SEE LICENSE IN ")
        ).resolve().read_bytes() == license_bytes
    return license_bytes, config


def same_license(folder, expected):
    files = [
        p for p in folder.rglob("LICENSE") if p.is_file() and p.read_bytes() == expected
    ]
    assert files, "Current root LICENSE missing from packaged resources"
    return True


def built_checks(license_bytes, config, *, sidecar_only=False):
    from PyInstaller.archive.readers import CArchiveReader

    triple = subprocess.check_output(
        [sys.executable, str(ROOT / "scripts/package-sidecar.py"), "--print-triple"],
        text=True,
    ).strip()
    sidecar = (
        ROOT
        / "src-tauri/binaries"
        / ("fourallpass-core-" + triple + (".exe" if sys.platform == "win32" else ""))
    )
    reader = CArchiveReader(str(sidecar))
    assert reader.extract("LICENSE") == license_bytes
    result = {
        "version": config["version"],
        "source_commit": subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
        ).strip(),
        "platform": platform.system() + "-" + platform.machine(),
        "license_sha256": hashlib.sha256(license_bytes).hexdigest(),
        "sidecar_embedded_license": True,
        "uses_personal_vault_or_account": False,
    }
    result["sidecar_sha256"] = hashlib.sha256(sidecar.read_bytes()).hexdigest()
    out = ROOT / "dist/release-checks"
    out.mkdir(parents=True, exist_ok=True)
    prior = out / ("sidecar-preflight-" + triple + ".json")
    with tempfile.TemporaryDirectory(prefix="4allpass-package-check-") as temporary:
        tmp = Path(temporary).resolve()
        if not sidecar_only and sys.platform == "darwin":
            app = ROOT / "src-tauri/target/release/bundle/macos/4AllPass.app"
            same_license(app / "Contents/Resources", license_bytes)
            subprocess.run(
                ["codesign", "--verify", "--deep", "--strict", str(app)],
                check=True,
                capture_output=True,
            )
            result["macos_code_signature_valid"] = True
            signature = subprocess.run(
                ["codesign", "-dv", str(app)], capture_output=True, text=True
            )
            result["signing"] = (
                "ad-hoc"
                if "Signature=adhoc" in signature.stderr
                else "codesigned; see release evidence"
            )
            dmg = next((ROOT / "src-tauri/target/release/bundle/dmg").glob("*.dmg"))
            mount = tmp / "mounted"
            mount.mkdir()
            subprocess.run(
                [
                    "hdiutil",
                    "attach",
                    "-readonly",
                    "-nobrowse",
                    "-mountpoint",
                    str(mount),
                    str(dmg),
                ],
                check=True,
                capture_output=True,
            )
            try:
                assert (mount / "LICENSE").read_bytes() == license_bytes
            finally:
                subprocess.run(
                    ["hdiutil", "detach", str(mount)], check=True, capture_output=True
                )
            result["dmg_root_license"] = True
        elif not sidecar_only and sys.platform == "linux":
            image = next(
                (ROOT / "src-tauri/target/release/bundle/appimage").glob("*.AppImage")
            )
            subprocess.run(
                [str(image), "--appimage-extract"],
                cwd=tmp,
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                timeout=90,
            )
            same_license(tmp / "squashfs-root", license_bytes)
            result["appimage_resources_license"] = True
        elif not sidecar_only and sys.platform == "win32":
            installer = next(
                (ROOT / "src-tauri/target/release/bundle/nsis").glob("*.exe")
            )
            subprocess.run(
                ["7z", "x", "-y", "-o" + str(tmp / "extracted"), str(installer)],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                timeout=90,
            )
            same_license(tmp / "extracted", license_bytes)
            signed = subprocess.check_output(
                [
                    "pwsh",
                    "-NoProfile",
                    "-Command",
                    "(Get-AuthenticodeSignature -LiteralPath $env:FOURALLPASS_SIGN_CHECK_PATH).Status.ToString()",
                ],
                env=dict(os.environ, FOURALLPASS_SIGN_CHECK_PATH=str(installer)),
                text=True,
            ).strip()
            result["authenticode_status"] = signed
            result["nsis_resources_license"] = True
        reused = (
            json.loads(prior.read_text())
            if prior.exists() and not sidecar_only
            else None
        )
        if reused and all(
            reused.get(k) == result[k]
            for k in ("source_commit", "sidecar_sha256", "license_sha256")
        ):
            assert reused.get("isolated_packaged_sidecar_database_startup") is True
            result["isolated_packaged_sidecar_database_startup"] = True
            result["startup_evidence_reused_for_identical_binary"] = prior.name
        else:
            startup_check(sidecar, tmp, result)
    result["third_party_notice_inventory_in_resources"] = (
        ROOT / "dist/third-party-licenses/inventory.json"
    ).is_file()
    output = prior if sidecar_only else out / ("package-check-" + triple + ".json")
    output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))


def startup_check(sidecar, tmp, result):
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    env = dict(os.environ)
    env.pop("FOURALLPASS_SIDECAR", None)
    stderr_path = tmp / "sidecar-stderr.txt"
    log = stderr_path.open("wb")
    proc = subprocess.Popen(
        [str(sidecar), "--data-dir", str(tmp / "synthetic-data"), "--port", str(port)],
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=log,
    )
    try:
        success = False
        for _ in range(60):
            if proc.poll() is not None:
                raw = stderr_path.read_text(errors="replace")[-16000:]
                modules = re.findall(
                    r"No module named ['\"]([a-zA-Z0-9_.-]+)['\"]", raw
                )
                distributions = re.findall(
                    r"No package metadata was found for ([a-zA-Z0-9_.-]+)", raw
                )
                types = re.findall(r"^([a-zA-Z0-9_.]*(?:Error|Exception)):", raw, re.M)
                diagnostic = {
                    "exit_code": proc.returncode,
                    "missing_modules": modules,
                    "exception_types": types,
                    "missing_distributions": distributions,
                    "source_commit": result["source_commit"],
                    "phase": "isolated_sidecar_startup",
                    "personal_data_used": False,
                }
                (ROOT / "dist/release-checks/startup-failure.json").write_text(
                    json.dumps(diagnostic, indent=2) + "\n"
                )
                raise RuntimeError(
                    "Packaged sidecar startup failed: " + json.dumps(diagnostic)
                )
            try:
                with urllib.request.urlopen(
                    f"http://127.0.0.1:{port}/api/v1/health", timeout=2
                ) as r:
                    health = json.load(r)
                if health.get("database") is True and health.get("profile") == "local":
                    success = True
                    break
            except (OSError, urllib.error.URLError):
                pass
            time.sleep(0.5)
        assert success, "Packaged sidecar database startup failed"
        result["isolated_packaged_sidecar_database_startup"] = True
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5)
        log.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--built", action="store_true")
    parser.add_argument("--sidecar", action="store_true")
    args = parser.parse_args()
    license_bytes, config = source_checks()
    if args.built or args.sidecar:
        built_checks(license_bytes, config, sidecar_only=args.sidecar)
    else:
        print(
            json.dumps(
                {
                    "source_license_checks": True,
                    "version": config["version"],
                    "license_sha256": hashlib.sha256(license_bytes).hexdigest(),
                }
            )
        )
