"""Determine the caller's address for rate limiting.

The deployment in ``docker-compose.yml`` puts nginx in front of the API, so
``request.client.host`` is the proxy for every request. Bucketing on that
collapses all users into one counter: the login limiter then throttles the
whole instance once any single attacker is busy, and an attacker's attempts
are subsidised by everyone else's quiet traffic.

Reading a forwarded header fixes that only where something trustworthy sets
it. A client can send ``X-Forwarded-For`` itself, so honouring it on a
directly-exposed server hands attackers an unlimited supply of rate-limit
buckets — a worse failure than the one being fixed. It is therefore opt-in via
``FOURALLPASS_TRUST_PROXY_CLIENT_IP``, to be enabled only when every request
passes through a proxy that *overwrites* the header, as the bundled nginx
config does with ``X-Real-IP``.
"""

from __future__ import annotations

from fastapi import Request

from app.core.config import get_settings

UNKNOWN_CLIENT = "unknown"


def client_ip(request: Request) -> str:
    if get_settings().trust_proxy_client_ip:
        real_ip = request.headers.get("x-real-ip")
        if real_ip and real_ip.strip():
            return real_ip.strip()
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            # Left-most entry is the original client; the proxy appends itself.
            first = forwarded.split(",")[0].strip()
            if first:
                return first
    return request.client.host if request.client else UNKNOWN_CLIENT
