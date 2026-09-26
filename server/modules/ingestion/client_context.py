"""Client context (network IP, user agent, caller identity) for request logs.

Nothing here returns a raw credential: API keys and bearer tokens become a
short SHA-256 fingerprint so operators can tell callers apart without the
log becoming a credential store.
"""

from __future__ import annotations

import hashlib
import ipaddress
from typing import Any, Mapping, Optional

_MAX_USER_AGENT = 512
_MAX_CLIENT_ID = 128


def _header(headers: Mapping[str, Any] | None, name: str) -> str:
    if not headers:
        return ""
    for key, value in headers.items():
        if str(key).lower() == name:
            return str(value or "").strip()
    return ""


def _fingerprint(prefix: str, secret: str) -> str:
    digest = hashlib.sha256(secret.encode("utf-8")).hexdigest()[:12]
    return f"{prefix}:{digest}"


def _valid_ip(value: str) -> Optional[str]:
    candidate = value.strip()
    if not candidate:
        return None
    try:
        return str(ipaddress.ip_address(candidate))
    except ValueError:
        return None


def client_ip_from(headers: Mapping[str, Any] | None, network_ip: str | None) -> Optional[str]:
    """Prefer the transport address; fall back to the first X-Forwarded-For hop."""
    direct = _valid_ip(network_ip or "")
    if direct:
        return direct
    forwarded = _header(headers, "x-forwarded-for")
    if forwarded:
        return _valid_ip(forwarded.split(",")[0])
    return _valid_ip(_header(headers, "x-real-ip"))


def client_id_from(headers: Mapping[str, Any] | None) -> Optional[str]:
    explicit = _header(headers, "x-api-client-id")
    if explicit:
        return explicit[:_MAX_CLIENT_ID]
    api_key = _header(headers, "x-api-key")
    if api_key:
        return _fingerprint("key", api_key)
    authorization = _header(headers, "authorization")
    if " " in authorization:
        scheme, token = authorization.split(" ", 1)
        if token.strip():
            return _fingerprint(scheme.strip().lower(), token.strip())
    return None


def extract_client_context(headers: Mapping[str, Any] | None, network_ip: str | None = None) -> dict[str, Optional[str]]:
    """Fields for RequestLog(client_ip=..., user_agent=..., client_id=...)."""
    user_agent = _header(headers, "user-agent")
    return {
        "client_ip": client_ip_from(headers, network_ip),
        "user_agent": user_agent[:_MAX_USER_AGENT] or None,
        "client_id": client_id_from(headers),
    }
