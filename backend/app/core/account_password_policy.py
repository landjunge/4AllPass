"""Offline registration-only policy; account authentication is not vault crypto."""
from unicodedata import normalize

from app.core._account_password_blocklist import COMMON_ACCOUNT_PASSWORDS


def registration_password_blocklisted(password: str, email: str) -> bool:
    # Compare the entire candidate, never substrings. This lookup normalization
    # does not change the value passed to Argon2 or existing login verification.
    key = normalize("NFC", password).casefold()
    address = normalize("NFC", email).casefold()
    expected = {address, address.partition("@")[0], "4allpass4allpass", "4allpass123456789"}
    return key in COMMON_ACCOUNT_PASSWORDS or key in expected
