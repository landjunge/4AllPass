"""Zero-knowledge hygiene for anything the server persists."""

# Mirrors packages/crypto FORBIDDEN_WIRE_KEYS (camelCase on the wire).
FORBIDDEN_WIRE_KEYS = frozenset(
    {
        "vaultKey",
        "wrappingKey",
        "deviceKey",
        "deviceWrappingKey",
        "prfOutput",
        "dwk",
        "masterPassword",
        "masterKey",
        "recoveryKey",
        "plaintext",
    }
)

# Snake_case column names that must never appear on any mapped table.
FORBIDDEN_COLUMN_NAMES = frozenset(
    {
        "vault_key",
        "wrapping_key",
        "device_key",
        "device_wrapping_key",
        "prf_output",
        "dwk",
        "master_password",
        "master_key",
        "recovery_key",
        "plaintext",
    }
)

ENVELOPE_TYPES = ("master", "device", "recovery")
UNLOCK_MECHANISMS = ("prf", "large_blob", "uv_gated_local")
