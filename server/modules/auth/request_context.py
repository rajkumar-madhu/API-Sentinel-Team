"""Per-request client context (IP, user agent) for audit logging.

`log_action` is called from dozens of routers that don't have the Request
object at hand; this lets it record who made the change without threading
the request through every call site.
"""

from __future__ import annotations

import contextvars
from typing import Optional

from server.modules.ingestion.client_context import client_ip_from

_request_client: contextvars.ContextVar[tuple[Optional[str], Optional[str]]] = contextvars.ContextVar(
    "request_client", default=(None, None)
)


def get_request_client() -> tuple[Optional[str], Optional[str]]:
    """(client_ip, user_agent) of the HTTP request being handled, if any."""
    return _request_client.get()


class RequestClientContextMiddleware:
    """Pure ASGI middleware: records the caller's IP and user agent."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        headers = {k.decode("latin-1"): v.decode("latin-1") for k, v in scope.get("headers") or []}
        peer = (scope.get("client") or (None, None))[0]
        user_agent = (headers.get("user-agent") or "")[:512] or None
        token = _request_client.set((client_ip_from(headers, peer), user_agent))
        try:
            await self.app(scope, receive, send)
        finally:
            _request_client.reset(token)
