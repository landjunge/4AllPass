"""Copy approved AP4 pixels; containerize provided sizes without redrawing/resampling.

Run on macOS to regenerate ICNS with Apple's iconutil. --check works on CI.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import struct
import subprocess
import tempfile
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BRAND = ROOT / "brand/ap4"
SIZES = (16, 24, 32, 48, 64, 96, 128, 180, 192, 256, 384, 512, 1024)
ORIGINALS = {
    "dark": "e34a5925bee7a35434145646c8fca497edc26eef015b3e88a40411e006bbb094",
    "light": "d253dfba15a8eea31c958debf5b3b1fdb068c96dd8e7a77192681e3e655866b4",
}
NATIVE_SIZES = (16, 24, 32, 48, 64, 128, 256, 512, 1024)


def png(variant, size):
    return BRAND / variant / f"4allpass-{variant}-{size}.png"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def rgba_pixels(path):
    """Decode known 8-bit non-interlaced RGB/RGBA PNGs without image dependencies."""
    data = path.read_bytes()
    width, height = struct.unpack(">II", data[16:24])
    assert data[:8] == b"\x89PNG\r\n\x1a\n" and data[24] == 8 and data[28] == 0
    channels = {2: 3, 6: 4}[data[25]]
    offset, compressed = 8, bytearray()
    while offset < len(data):
        length = struct.unpack(">I", data[offset : offset + 4])[0]
        if data[offset + 4 : offset + 8] == b"IDAT":
            compressed.extend(data[offset + 8 : offset + 8 + length])
        offset += length + 12
    raw = zlib.decompress(compressed)
    stride = width * channels
    assert len(raw) == height * (stride + 1)
    previous, pixels = bytearray(stride), bytearray()
    for start in range(0, len(raw), stride + 1):
        filter_type = raw[start]
        row = bytearray(raw[start + 1 : start + 1 + stride])
        assert 0 <= filter_type <= 4
        for i in range(stride):
            a = row[i - channels] if i >= channels else 0
            b = previous[i]
            c = previous[i - channels] if i >= channels else 0
            if filter_type == 1:
                predictor = a
            elif filter_type == 2:
                predictor = b
            elif filter_type == 3:
                predictor = (a + b) // 2
            elif filter_type == 4:
                p = a + b - c
                predictor = min((a, b, c), key=lambda value: abs(p - value))
            else:
                predictor = 0
            row[i] = (row[i] + predictor) % 256
        if channels == 4:
            pixels.extend(row)
        else:
            for i in range(0, stride, 3):
                pixels.extend(row[i : i + 3])
                pixels.append(255)
        previous = row
    return width, height, pixels


def mappings():
    result = {}
    for name, size in {
        "32x32.png": 32,
        "128x128.png": 128,
        "128x128@2x.png": 256,
        "256x256.png": 256,
        "256x256@2x.png": 512,
        "512x512.png": 512,
        "512x512@2x.png": 1024,
        "icon.png": 1024,
    }.items():
        result[f"src-tauri/icons/{name}"] = BRAND / "native" / f"{size}x{size}.png"
    for name, size in {
        "favicon.png": 32,
        "logo.png": 96,
        "icon.png": 512,
        "icon-180.png": 180,
        "icon-192.png": 192,
        "icon-512.png": 512,
        "og.png": 1024,
    }.items():
        result[f"frontend/public/{name}"] = png("dark", size)
    for name, size in {"favicon-light.png": 32, "logo-light.png": 96}.items():
        result[f"frontend/public/{name}"] = png("light", size)
    for size in (16, 32, 48, 128):
        result[f"extension/icons/icon{size}.png"] = png("dark", size)
    result["extension/icons/logo.png"] = png("dark", 128)
    result["extension/safari/FourAllPass/FourAllPass/Resources/Icon.png"] = png(
        "dark", 512
    )
    safari = "extension/safari/FourAllPass/FourAllPass/Assets.xcassets"
    for folder, sizes in (
        ("AppIcon.appiconset", (16, 32, 64, 128, 256, 512, 1024)),
        ("LargeIcon.imageset", (128, 256, 384)),
    ):
        for size in sizes:
            result[f"{safari}/{folder}/ap4-{size}.png"] = png("dark", size)
    for variant in ORIGINALS:
        for size in (32, 128, 512):
            result[f"site/assets/ap4-{variant}-{size}.png"] = png(variant, size)
    return result


def ico_bytes():
    # Windows ICO directory with the unchanged approved PNG frames.
    sizes = (16, 24, 32, 48, 64, 128, 256)
    entries, payload, offset = [], [], 6 + 16 * len(sizes)
    for size in sizes:
        data = (BRAND / "native" / f"{size}x{size}.png").read_bytes()
        entries.append(
            struct.pack(
                "<BBBBHHII", size % 256, size % 256, 0, 0, 1, 32, len(data), offset
            )
        )
        payload.append(data)
        offset += len(data)
    return struct.pack("<HHH", 0, 1, len(sizes)) + b"".join(entries + payload)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    for variant, expected in ORIGINALS.items():
        assert digest(BRAND / f"4allpass-{variant}.png") == expected, (
            "Approved original changed"
        )
        for size in SIZES:
            data = png(variant, size).read_bytes()
            assert data[:8] == b"\x89PNG\r\n\x1a\n" and struct.unpack(
                ">II", data[16:24]
            ) == (size, size)
    native = BRAND / "native"
    if not args.check:
        native.mkdir(exist_ok=True)
        for size in NATIVE_SIZES:
            subprocess.run(
                [
                    "npm",
                    "run",
                    "tauri",
                    "--",
                    "icon",
                    str(png("dark", size)),
                    "--png",
                    str(size),
                    "--output",
                    str(native),
                ],
                cwd=ROOT,
                check=True,
                stdout=subprocess.DEVNULL,
            )
    for size in NATIVE_SIZES:
        converted = native / f"{size}x{size}.png"
        assert converted.read_bytes()[25] == 6, "Tauri requires RGBA native icons"
        assert rgba_pixels(converted) == rgba_pixels(png("dark", size)), (
            "Native conversion changed pixels"
        )
    for relative, source in mappings().items():
        target = ROOT / relative
        if not args.check:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        assert target.read_bytes() == source.read_bytes(), relative
    ico = ROOT / "src-tauri/icons/icon.ico"
    if not args.check:
        ico.write_bytes(ico_bytes())
        with tempfile.TemporaryDirectory() as temporary:
            iconset = Path(temporary) / "AP4.iconset"
            iconset.mkdir()
            for size in (16, 32, 128, 256, 512):
                for scale in (1, 2):
                    suffix = "@2x" if scale == 2 else ""
                    shutil.copyfile(
                        png("dark", size * scale),
                        iconset / f"icon_{size}x{size}{suffix}.png",
                    )
            subprocess.run(
                [
                    "/usr/bin/iconutil",
                    "-c",
                    "icns",
                    str(iconset),
                    "-o",
                    str(ROOT / "src-tauri/icons/icon.icns"),
                ],
                check=True,
            )
    assert ico.read_bytes() == ico_bytes()
    containers = BRAND / "containers.json"
    container_hashes = {
        name: digest(ROOT / "src-tauri/icons" / name)
        for name in ("icon.ico", "icon.icns")
    }
    if not args.check:
        containers.write_text(json.dumps(container_hashes, indent=2) + "\n")
    assert json.loads(containers.read_text()) == container_hashes, (
        "Native container changed"
    )
    manifest = BRAND / "SHA256SUMS"
    text = "".join(
        f"{digest(path)}  {path.relative_to(BRAND).as_posix()}\n"
        for path in sorted(BRAND.rglob("*.png"))
    )
    if not args.check:
        manifest.write_text(text)
    assert manifest.read_text() == text, "Approved size hash manifest differs"
    print(
        json.dumps(
            {
                "approved_originals": ORIGINALS,
                "provided_sizes_each": list(SIZES),
                "checked_target_copies": len(mappings()),
                "native_rgba_pixel_equivalent_sizes": list(NATIVE_SIZES),
                "ico_frames": 7,
                "native_variant": "dark",
            }
        )
    )


if __name__ == "__main__":
    main()
