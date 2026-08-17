"""4AllPass backend — FastAPI application.

Zero-Knowledge password manager server. This service never sees plaintext
vault entries, the Master Password, the Vault Key, or any key material that
could decrypt a vault. See ``docs/crypto-protocol.md`` and
``docs/threat-model.md`` at the repository root for the authoritative rules.
"""
