# Account registration password policy — H1 / R03

This is account registration only. New `/api/v1/auth/register` passwords use
15–256 Unicode code points. Existing login keeps its previous 1–256 acceptance
and full Argon2 verification, including older 12–14-character and newly listed
passwords. Local bootstrap has no account password. Vault unlock is separate.
No character-class requirement, periodic reset, trimming, truncation or change
to password hashing/normalization is introduced. Unicode NFC/casefold is used
only for whole-value blocklist comparison, never to rewrite a stored password.

The offline list uses SecLists `Passwords/Common-Credentials/`
`xato-net-10-million-passwords-100000.txt`, commit `b8d455a03742da9037bb2ab8582eec90052cd5b1`.
Source: [pinned SecLists snapshot](https://github.com/danielmiessler/SecLists/blob/b8d455a03742da9037bb2ab8582eec90052cd5b1/Passwords/Common-Credentials/xato-net-10-million-passwords-100000.txt).
SHA256 `1472aafa2561df5e3293aee252aee3ca660c12b399a283cf808bb01b39be388b`; 781879 bytes / 100000 source rows.
The 72 source rows already 15–256 code points long become 70 unique NFC/
casefolded lookup keys. All shorter source values are already rejected by the
minimum; they are omitted from the executable constant. This is a bounded
top-100000 snapshot, not an exhaustive compromise database or a strength score.
The exact whole email/username and two expected whole service derivatives are
also refused. Substrings do not cause rejection. Matching is case-insensitive;
spaces and the full submitted value remain significant.

SecLists copyright 2018 Daniel Miessler, MIT License. Its complete license
notice is retained in the generated Python module. The app's own LICENSE is
unchanged. No third-party request receives a candidate, hash or prefix. No
runtime downloads, extra dependency or separately packaged data file exists.
Offline rebuild command: `python scripts/generate-account-password-blocklist.py`
`--source /path/to/the/pinned/public/source.txt --check`. Source bytes must match
the pinned hash. Source/version changes require review and regeneration.

API errors are fixed 422 detail codes: account_password_too_short,
account_password_too_long, account_password_blocklisted, account_password_invalid.
The registration validation handler never returns rejected password input.
The frontend maps only this allowlist to DE/EN catalog messages. Unknown errors
retain generic safe text. Login/local/vault routes do not use this policy.

Reference checked 20 October 2026: [NIST SP800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html).
Section 3.1.1.2 covers central single-factor minimum 15, full-value blocklists,
code-point counting and rejection guidance. No claim of overall NIST conformity:
other controls and legacy-password lifecycle remain separately scoped.
