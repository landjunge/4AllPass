"""Native signature negatives; signs private copies and never executes them."""

from pathlib import Path
import json
import plistlib
import platform
import shutil
import subprocess
import sys
import tempfile
import unittest

from macos_runtime_policy import CS_EXCEPTIONS, inspect_bundle_runtime, inspect_runtime

ROOT = Path(__file__).resolve().parent.parent


class SourcePolicy(unittest.TestCase):
    def test_runtime_config_and_exception_free_source(self):
        config = json.loads((ROOT / "src-tauri/tauri.conf.json").read_text())
        self.assertIs(config["bundle"]["macOS"]["hardenedRuntime"], True)
        entitlements = plistlib.loads((ROOT / "src-tauri/entitlements.plist").read_bytes())
        self.assertFalse(any(entitlements.get(key) for key in CS_EXCEPTIONS))


@unittest.skipUnless(sys.platform == "darwin", "actual macOS codesign required")
class NativeSignaturePolicy(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="4allpass-runtime-policy-")
        self.addCleanup(self.temporary.cleanup)
        self.folder = Path(self.temporary.name)

    def signed_copy(self, name, *, runtime=True, entitlements=None, identifier=None):
        target = self.folder / name
        architectures = subprocess.check_output(["lipo", "-archs", "/usr/bin/true"], text=True).split()
        host = next((a for a in architectures if a.startswith(platform.machine())), architectures[0])
        if len(architectures) > 1:
            subprocess.run(["lipo", "/usr/bin/true", "-thin", host, "-output", str(target)],
                           check=True, capture_output=True)
        else:
            shutil.copyfile("/usr/bin/true", target)
        command = ["codesign", "--force", "--sign", "-", "--timestamp=none"]
        if runtime:
            command += ["--options", "runtime"]
        if identifier is not None:
            command += ["--identifier", identifier]
        if entitlements is not None:
            profile = target.with_suffix(".plist")
            profile.write_bytes(plistlib.dumps(entitlements))
            command += ["--entitlements", str(profile)]
        subprocess.run(command + [str(target)], check=True, capture_output=True)
        return target

    def test_runtime_with_current_profile_accepted(self):
        profile = plistlib.loads((ROOT / "src-tauri/entitlements.plist").read_bytes())
        result = inspect_runtime(self.signed_copy("current", entitlements=profile))
        self.assertTrue(result["hardened_runtime"])
        self.assertEqual(result["code_directory_flags"] & 0x10000, 0x10000)

    def test_valid_adhoc_signature_without_runtime_rejected(self):
        with self.assertRaisesRegex(RuntimeError, "Hardened runtime missing"):
            inspect_runtime(self.signed_copy("old", runtime=False))

    def test_each_enabled_exception_rejected(self):
        for index, key in enumerate(CS_EXCEPTIONS):
            with self.subTest(key=key):
                executable = self.signed_copy("exception-" + str(index), entitlements={key: True})
                with self.assertRaisesRegex(RuntimeError, "Unapproved code-signing exception"):
                    inspect_runtime(executable)

    def test_missing_signature_rejected(self):
        executable = self.signed_copy("unsigned")
        subprocess.run(["codesign", "--remove-signature", str(executable)], check=True, capture_output=True)
        with self.assertRaises(subprocess.CalledProcessError):
            inspect_runtime(executable)

    def test_runtime_flags_in_identifier_or_path_cannot_spoof_code_directory(self):
        for name, identifier in [("identifier-spoof", "flags=0x10000"), ("flags=0x10000", None)]:
            with self.subTest(name=name):
                executable = self.signed_copy(name, runtime=False, identifier=identifier)
                with self.assertRaisesRegex(RuntimeError, "Hardened runtime missing"):
                    inspect_runtime(executable)

    def test_bundle_checks_final_core_independently(self):
        app = self.folder / "fixture.app"
        macos = app / "Contents/MacOS"
        macos.mkdir(parents=True)
        (app / "Contents/Info.plist").write_bytes(plistlib.dumps({
            "CFBundleExecutable": "fixture", "CFBundleIdentifier": "invalid.example.runtime-policy",
            "CFBundlePackageType": "APPL", "CFBundleVersion": "1",
        }))
        shutil.copyfile(self.signed_copy("parent"), macos / "fixture")
        shutil.copyfile(self.signed_copy("core", runtime=False), macos / "fourallpass-core")
        for path in macos.iterdir():
            path.chmod(0o755)
        def seal():
            subprocess.run(["codesign", "--force", "--sign", "-", "--options", "runtime",
                            "--timestamp=none", str(app)], check=True, capture_output=True)
        seal()
        with self.assertRaisesRegex(RuntimeError, "Hardened runtime missing: fourallpass-core"):
            inspect_bundle_runtime(app)
        shutil.copyfile(self.signed_copy("good-core"), macos / "fourallpass-core")
        seal()
        self.assertEqual(set(inspect_bundle_runtime(app)), {"parent", "bundled_core"})

    def test_universal_binary_is_explicitly_outside_profile(self):
        if len(subprocess.check_output(["lipo", "-archs", "/usr/bin/true"], text=True).split()) < 2:
            self.skipTest("universal native fixture unavailable")
        target = self.folder / "universal"
        shutil.copyfile("/usr/bin/true", target)
        subprocess.run(["codesign", "--force", "--sign", "-", "--options", "runtime",
                        "--timestamp=none", str(target)], check=True, capture_output=True)
        with self.assertRaisesRegex(RuntimeError, "Universal executables are outside"):
            inspect_runtime(target)


if __name__ == "__main__":
    unittest.main()
