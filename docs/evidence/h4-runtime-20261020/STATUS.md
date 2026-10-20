# H4 private native evidence — 20 October 2026

Frozen runtime source `10c8772`, reviewed as `6e1a838` (documentation-only final
delta), integrated `fb14e34`. Fresh private copies were signed; frozen originals
and installed app/core hashes stayed identical before/after.

Independent Codex review verified parent signatures and actual isolated core
health/database checks. Baseline adhoc and runtime/no-exception core both
started on separate ephemeral ports. No library-validation failure was found;
no exception was added based on speculation.

Combined native journey: runtime parent with network keys, runtime core with no
entitlements,11.616s. Separate exact-source-plist run: **both** targets with the
current two network keys,10.992s. Both actual CodeDirectories0x10002,
strict/deep valid, no three CS exceptions. Signup/Create/kit download/manual
lock/master unlock/real CSV parser-review-confirm/lock-unlock/two decrypted
titles passed. Separate WASM42 returned42; actual KDF remained JS Argon2id
32768KiB/t3/p1/version19/hash32.

Fresh private DB:1 user/1 vault/2 snapshots/2 encrypted entries; synthetic
plaintext markers absent. Incognito WK store and empty browser fixture, no
real profile/credential/grant/project read. Port8788 released and owned process
group empty. Hashes are listed in adjacent SHA256SUMS, not private kit values.

Root's six native signature-policy test methods pass. First attempt failed:
codesign `--entitlements -` emitted display text and the synthetic app needed
a proper Info.plist seal. Corrected guard uses `:-`; fixture signs its bundle
before verification. Initial failures are not counted as passing evidence.

Private debug probe, not release app/DMG/notarization/install. Test-only strict
occupied-port refusal does not exercise ordinary orphan reaping. DOM File
input is not the OS picker; incognito is not persistent WK restart. WASM42 is
not a KDF/JIT-tier/hardware proof. Outer core signing does not independently
harden archived Python libraries. Apple Silicon and other Mac versions still
need their own candidate checks. Installed bytes and credentials unchanged.
