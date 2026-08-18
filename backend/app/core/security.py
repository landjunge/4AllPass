from pwdlib import PasswordHash


# Account-password hashing is deliberately independent from the vault's
# Argon2id protocol. This verifier is only for backend account authentication.
_password_hash = PasswordHash.recommended()


def hash_account_password(password: str) -> str:
    return _password_hash.hash(password)


def verify_account_password(password: str, password_hash: str) -> bool:
    return _password_hash.verify(password, password_hash)
