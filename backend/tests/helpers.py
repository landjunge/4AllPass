"""Shared setup for the API tests.

Two authentication modes have to be exercised everywhere, because they have
different exposure: the browser's HttpOnly cookie (ambient, therefore CSRF
relevant) and the opt-in bearer token (explicit, therefore not).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from httpx import AsyncClient

from app.core.config import get_settings

PASSWORD = "account-password-1234"
API = "/api/v1"


def unique_email(prefix: str = "user") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}@example.test"


@dataclass(frozen=True)
class Account:
    client: AsyncClient
    email: str
    account_id: str
    token: str | None

    @property
    def auth(self) -> dict[str, str]:
        """Headers that authenticate this account, whichever mode it uses."""
        if self.token is not None:
            return {"Authorization": f"Bearer {self.token}"}
        return self.csrf

    @property
    def csrf(self) -> dict[str, str]:
        settings = get_settings()
        value = self.client.cookies.get(settings.csrf_cookie_name)
        return {"X-CSRF-Token": value} if value else {}


async def register(
    client: AsyncClient,
    *,
    email: str | None = None,
    password: str = PASSWORD,
    bearer: bool = True,
) -> Account:
    email = email or unique_email("owner")
    response = await client.post(
        f"{API}/auth/register",
        json={"email": email, "password": password, "issueBearerToken": bearer},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    return Account(
        client=client, email=email, account_id=body["accountId"], token=body.get("token")
    )


async def login(
    client: AsyncClient, email: str, password: str = PASSWORD, *, bearer: bool = True
) -> Account:
    response = await client.post(
        f"{API}/auth/login",
        json={"email": email, "password": password, "issueBearerToken": bearer},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    return Account(
        client=client, email=email, account_id=body["accountId"], token=body.get("token")
    )


async def create_vault(account: Account) -> str:
    response = await account.client.post(f"{API}/vaults", headers=account.auth)
    assert response.status_code == 201, response.text
    return response.json()["vaultId"]


def master_envelope() -> dict:
    """A syntactically valid master envelope.

    The bytes are filler: these tests are about who may reach the endpoint,
    and the server never inspects envelope plaintext — it cannot.
    """
    return {
        "version": 1,
        "type": "master",
        "vaultKeyVersion": 1,
        "encryption": "AES-256-GCM",
        "nonce": "AAAAAAAAAAAAAAAA",
        "ciphertext": "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=",
        "tag": "AgICAgICAgICAgICAgICAg==",
        "kdf": {
            "algorithm": "argon2id",
            "version": 19,
            "memory": 65536,
            "iterations": 3,
            "parallelism": 4,
            "hashLen": 32,
            "salt": "ABEiM0RVZneImaq7zN3u/w==",
        },
    }
