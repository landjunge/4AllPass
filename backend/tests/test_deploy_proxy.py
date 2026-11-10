"""E03/P03: the shipped server deployment must rate-limit per client, not globally.

Built from the files that are actually deployed: the host nginx in
``deploy/nginx-vault.conf`` and the backend command in ``deploy/compose.yml``.
Before the fix nginx sent only ``X-Real-IP`` (uvicorn ignores it) and uvicorn
trusted forwarded headers only from 127.0.0.1, while the request arrives from
the Docker gateway. Every caller then shared one bucket: ten anonymous logins a
minute locked everyone out, and one account's writes throttled all others.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from app.core.config import get_settings
from app.main import app

pytestmark = pytest.mark.asyncio(loop_scope="session")

DEPLOY = Path(__file__).resolve().parents[2] / "deploy"
DOCKER_GATEWAY = ("172.18.0.1", 51000)


def _nginx_api_headers() -> dict[str, str]:
    conf = (DEPLOY / "nginx-vault.conf").read_text(encoding="utf-8")
    block = re.search(r"location /api/ \{(.*?)\}", conf, re.S)
    assert block, "nginx /api/ location missing"
    return dict(re.findall(r"proxy_set_header\s+(\S+)\s+(\S+);", block.group(1)))


def _uvicorn_trusted_hosts() -> str:
    compose = (DEPLOY / "compose.yml").read_text(encoding="utf-8")
    command = re.search(r"uvicorn app\.main:app[^\n]*", compose)
    assert command, "backend uvicorn command missing"
    match = re.search(r"--forwarded-allow-ips[= ]'?([^'\s]+)'?", command.group(0))
    return match.group(1) if match else "127.0.0.1"  # uvicorn default


def _as_nginx_would_send(client_ip: str) -> dict[str, str]:
    values = {"$remote_addr": client_ip, "$host": "vault.example.invalid", "$scheme": "https"}
    return {name: values.get(value, value) for name, value in _nginx_api_headers().items()}


async def test_login_rate_limit_is_per_client_behind_the_shipped_proxy(client):
    # `client` only installs the throwaway-database override on `app`.
    proxied = ProxyHeadersMiddleware(app, trusted_hosts=_uvicorn_trusted_hosts())
    transport = ASGITransport(app=proxied, client=DOCKER_GATEWAY)
    body = {"email": "nobody@example.com", "password": "not-the-right-one-at-all"}
    limit = get_settings().auth_login_rate_limit
    async with AsyncClient(transport=transport, base_url="http://test") as proxy_client:
        async def login(ip: str) -> int:
            headers = {**_as_nginx_would_send(ip), "X-Device-Id": "dev_proxytest00000001"}
            return (await proxy_client.post("/api/v1/auth/login", json=body, headers=headers)).status_code

        for _ in range(limit):
            assert await login("203.0.113.10") == 401
        assert await login("203.0.113.10") == 429, "the attacker is limited"
        assert await login("198.51.100.20") == 401, "another client must not share the bucket"
