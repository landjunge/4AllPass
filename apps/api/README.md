# `@4allpass` API

FastAPI + PostgreSQL + Redis. The server is an **opaque blob store**.

It may persist Device Envelopes and (optionally) Device-Key Envelopes.
It must never see, derive, or store:

- Master Password / Master Key
- Vault Key, Device Key, Device Wrapping Key
- WebAuthn PRF output

Authoritative rules: `docs/crypto-protocol.md` §11, `docs/webauthn-prf.md`, `docs/vault-revision.md`.

```sh
python3 -m venv .venv
. .venv/bin/activate
pip install -e ".[dev]"
pytest
uvicorn app.main:app --reload --port 8000
```

Apply the schema to PostgreSQL:

```sh
alembic upgrade head
```
