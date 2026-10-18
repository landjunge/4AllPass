"""Preserve upstream notices from the actual build environment without relicensing them."""

from __future__ import annotations

import hashlib
import importlib.metadata
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "dist/third-party-licenses"


def notice(path):
    return path.is_file() and re.match(
        r"^(licen[cs]e|notice|copying|copyright)([._-]|$)", path.name, re.I
    )


def collect():
    OUT.mkdir(parents=True, exist_ok=False)
    inventory = []

    def save(ecosystem, name, version, files, declared=None):
        label = re.sub(r"[^a-zA-Z0-9_.-]", "_", name + "-" + version)
        record = {
            "ecosystem": ecosystem,
            "name": name,
            "version": version,
            "declared_license": declared,
            "notices": [],
        }
        for path in sorted(set(files)):
            if path.is_symlink():
                continue
            data = path.read_bytes()
            if len(data) > 2_000_000:
                raise RuntimeError("Upstream notice unexpectedly large")
            digest = hashlib.sha256(data).hexdigest()
            dest = OUT / ecosystem / label / (digest[:12] + "-" + path.name)
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(data)
            record["notices"].append(
                {"file": str(dest.relative_to(OUT)), "sha256": digest}
            )
        inventory.append(record)

    lock = json.loads((ROOT / "package-lock.json").read_text())
    for location, package in lock["packages"].items():
        if not location.startswith("node_modules/") or package.get("link"):
            continue
        folder = ROOT / location
        if not folder.is_dir():
            continue
        candidates = list(folder.glob("*"))
        for sub in ("LICENSES", "licenses"):
            if (folder / sub).is_dir():
                candidates += list((folder / sub).glob("*"))
        save(
            "npm",
            package.get("name", location.split("node_modules/")[-1]),
            package.get("version", "unknown"),
            [p for p in candidates if notice(p)],
            package.get("license"),
        )
    metadata = json.loads(
        subprocess.check_output(
            ["cargo", "metadata", "--locked", "--format-version", "1"],
            cwd=ROOT / "src-tauri",
        )
    )
    for package in metadata["packages"]:
        if not package.get("source"):
            continue  # Own code has the root LICENSE, not replacement third-party terms.
        folder = Path(package["manifest_path"]).parent
        files = [p for p in folder.glob("*") if notice(p)]
        if package.get("license_file"):
            p = folder / package["license_file"]
            if p.is_file() and p.resolve().is_relative_to(folder.resolve()):
                files.append(p)
        save(
            "cargo", package["name"], package["version"], files, package.get("license")
        )
    for package in importlib.metadata.distributions():
        files = [
            Path(package.locate_file(p))
            for p in package.files or []
            if notice(Path(package.locate_file(p)))
        ]
        save(
            "python",
            package.metadata["Name"],
            package.version,
            files,
            package.metadata.get("License-Expression")
            or package.metadata.get("License"),
        )
    (OUT / "inventory.json").write_text(
        json.dumps(
            {
                "scope": "Notices found in installed npm, Cargo and Python build dependencies; includes build-only packages. Missing texts are listed, not invented. This is not a legal compatibility opinion.",
                "components": inventory,
            },
            indent=2,
        )
        + "\n"
    )
    (OUT / "README.txt").write_text(
        "Third-party components retain their upstream terms. Root LICENSE covers the owner's contributions only.\n"
        "Drittbestandteile behalten ihre eigenen Bedingungen. Die Haupt-LICENSE gilt nur fuer eigene Beitraege.\n"
        "inventory.json records actual versions and notice hashes, not a legal audit.\n"
    )
    print(
        json.dumps(
            {
                "components": len(inventory),
                "with_notice_texts": sum(bool(x["notices"]) for x in inventory),
            }
        )
    )


if __name__ == "__main__":
    collect()
