"""Opaque-blob ceilings. Must stay in lockstep with packages/crypto constants.ts."""

# packages/crypto ID_BYTES_MAX
ID_CHARS_MAX = 256
# packages/crypto MANIFEST_ENTRIES_MAX / MANIFEST_ENVELOPES_MAX
ENTRIES_MAX = 100_000
ENVELOPES_MAX = 1_000
# 12-byte nonce / 16-byte tag as standard base64
NONCE_B64_MAX = 24
TAG_B64_MAX = 32
# ~1 MiB decoded ciphertext per field
CIPHERTEXT_B64_MAX = 1_400_000
# Whole snapshot JSON
REQUEST_BODY_MAX = 32 * 1024 * 1024
