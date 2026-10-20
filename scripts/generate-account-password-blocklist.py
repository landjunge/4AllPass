"""Rebuild the pinned public account-password blocklist offline (stdlib only)."""
import argparse
import hashlib
from pathlib import Path
import unicodedata

PIN = 'b8d455a03742da9037bb2ab8582eec90052cd5b1'
SOURCE_SHA = '1472aafa2561df5e3293aee252aee3ca660c12b399a283cf808bb01b39be388b'
LICENSE_NOTICE = 'MIT License\n\nCopyright (c) 2018 Daniel Miessler\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n'


def render(raw):
    if hashlib.sha256(raw).hexdigest() != SOURCE_SHA:
        raise SystemExit("source digest differs from reviewed pin")
    keys = sorted({unicodedata.normalize("NFC", value).casefold()
                   for value in raw.decode("utf-8").splitlines() if 15 <= len(value) <= 256})
    text = "\n".join(("# " + line if line else "#") for line in LICENSE_NOTICE.splitlines()) + "\n\n"
    text += "# Generated whole-password keys from the pinned SecLists top-100000.\n"
    text += f"# Upstream commit: {PIN}\n# Source SHA256: {SOURCE_SHA}\n"
    text += "# Only 15..256-codepoint entries can pass this registration length policy.\n"
    text += "# No network, package data file, or runtime update is used. See policy provenance.\n"
    return text + "COMMON_ACCOUNT_PASSWORDS = frozenset({\n" + "".join("    " + repr(value) + ",\n" for value in keys) + "})\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    target = Path(__file__).resolve().parents[1] / "backend/app/core/_account_password_blocklist.py"
    expected = render(args.source.read_bytes())
    if args.check:
        if target.read_text() != expected:
            raise SystemExit("generated blocklist differs")
        print("Pinned offline account-password blocklist: OK")
    else:
        target.write_text(expected)


if __name__ == "__main__":
    main()
