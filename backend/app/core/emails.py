"""Account e-mail parsing and canonicalization.

An account e-mail is an identity label, never vault key material
(architecture.md §3, crypto-protocol.md Hard Invariant #5).

Two deliberate deviations from ``pydantic.EmailStr``:

* **Special-use domains are accepted.** A 4AllPass instance normally runs on
  a LAN, in a homelab, or behind a VPN, where ``admin@vault.internal`` and
  ``ops@box.test`` are the ordinary addresses. Rejecting every RFC 2606 /
  RFC 6761 domain would lock those deployments out of their own server.
* **Deliverability is never checked.** A DNS lookup during registration
  would fail closed on an air-gapped host and would turn the endpoint into
  a DNS side-channel that reports which domains were just typed in.

The whole address is lower-cased, not only the domain. RFC 5321 leaves the
local part case-sensitive, but treating ``Ada@example.com`` and
``ada@example.com`` as two accounts is a footgun for a self-hosted tool: the
user who registered one and logs in as the other would silently see an empty
vault list. ``ck_users_email_is_lowercase`` holds the same invariant in the
database, which is what makes the unique index on ``users.email`` a
*case-insensitive* unique index.
"""

from __future__ import annotations

from typing import Annotated

import email_validator
from email_validator import EmailNotValidError, validate_email
from pydantic import AfterValidator

# Matches the users.email column width.
MAX_EMAIL_LENGTH = 320

# Special-use suffixes a self-hosted instance is expected to see. `.local` is
# mDNS/Bonjour (`ada@nas.local`) and `.test` is RFC 2606 — between them they
# cover most homelab and CI deployments. `.internal` is not on IANA's list at
# all, so it needs no exemption.
#
# Everything else in the library's list stays rejected: `invalid` is reserved
# to *never* resolve, `onion` is a Tor service name rather than a mail domain,
# and `arpa` is reverse-DNS infrastructure. None of them names a person.
_ALLOWED_SPECIAL_USE_SUFFIXES = frozenset({"local", "test"})

# Documented extension point: "These global attributes are a part of the
# library's API and can be changed by library users."
email_validator.SPECIAL_USE_DOMAIN_NAMES = [
    name
    for name in email_validator.SPECIAL_USE_DOMAIN_NAMES
    if name not in _ALLOWED_SPECIAL_USE_SUFFIXES
]


def normalize_account_email(value: str) -> str:
    try:
        result = validate_email(value.strip(), check_deliverability=False, test_environment=True)
    except EmailNotValidError as exc:
        raise ValueError(str(exc)) from exc

    normalized = result.normalized.strip().lower()
    if len(normalized) > MAX_EMAIL_LENGTH:
        raise ValueError(f"email address must be at most {MAX_EMAIL_LENGTH} characters")
    return normalized


AccountEmail = Annotated[str, AfterValidator(normalize_account_email)]
