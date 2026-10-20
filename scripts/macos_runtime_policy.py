"""Inspect the effective signatures of both executables in the macOS candidate.

Configuration alone cannot establish hardened runtime. This is a package gate,
not a Developer ID, notarization, sandbox or archived-library audit.
"""

import hashlib
from pathlib import Path
import plistlib
import re
import subprocess

CS_EXCEPTIONS = (
    "com.apple.security.cs.allow-jit",
    "com.apple.security.cs.allow-unsigned-executable-memory",
    "com.apple.security.cs.disable-library-validation",
)


def inspect_runtime(executable):
    executable = Path(executable)
    architectures = subprocess.check_output(
        ["lipo", "-archs", str(executable)], text=True,
    ).split()
    # Current Intel/Apple-Silicon releases are separate thin artifacts. Display
    # without --architecture does not establish every slice of a fat binary.
    if len(architectures) != 1:
        raise RuntimeError(f"Universal executables are outside this runtime profile: {executable.name}")
    subprocess.run(
        ["codesign", "--verify", "--strict", str(executable)],
        check=True, capture_output=True,
    )
    displayed = subprocess.run(
        ["codesign", "-dvv", str(executable)],
        check=True, capture_output=True, text=True,
    )
    flags = re.findall(
        r"^CodeDirectory v=\d+ size=\d+ flags=0x([0-9a-fA-F]+)(?:\(|\s|$)",
        displayed.stderr, re.MULTILINE,
    )
    # Identifier and executable-path text are not CodeDirectory evidence.
    if len(flags) != 1 or not int(flags[0], 16) & 0x10000:
        raise RuntimeError(f"Hardened runtime missing: {executable.name}")
    extracted = subprocess.run(
        # The colon requests a plist, rather than codesign's display format.
        ["codesign", "-d", "--entitlements", ":-", str(executable)],
        check=True, capture_output=True,
    )
    entitlements = plistlib.loads(extracted.stdout) if extracted.stdout.strip() else {}
    if not isinstance(entitlements, dict):
        raise RuntimeError(f"Invalid entitlements: {executable.name}")
    if any(entitlements.get(key) for key in CS_EXCEPTIONS):
        raise RuntimeError(f"Unapproved code-signing exception: {executable.name}")
    return {
        "sha256": hashlib.sha256(executable.read_bytes()).hexdigest(),
        "architecture": architectures[0],
        "code_directory_flags": int(flags[0], 16),
        "hardened_runtime": True,
        "three_cs_exceptions_enabled": False,
        "signature_valid": True,
    }


def inspect_bundle_runtime(app):
    app = Path(app)
    info = plistlib.loads((app / "Contents/Info.plist").read_bytes())
    name = info.get("CFBundleExecutable")
    if not isinstance(name, str) or not name or name in (".", "..") or Path(name).name != name:
        raise RuntimeError("Invalid CFBundleExecutable")
    executable_dir = app / "Contents/MacOS"
    return {
        "parent": inspect_runtime(executable_dir / name),
        # Check the final Tauri-signed copy, not the pre-bundle PyInstaller input.
        "bundled_core": inspect_runtime(executable_dir / "fourallpass-core"),
    }
