"""Every route is authenticated unless it is on the public allowlist.

This is the regression gate for the class of bug found in the 2026-08-23 audit,
where all seven ``/api/anomalies`` routes shipped with no authentication and no
tenant filter and served production request logs to anonymous callers.

Adding a router is a two-step edit (define it, then include it in
``routers/__init__.py``), and it is easy to land a new endpoint without an auth
dependency. This test walks the real dependency tree of every registered route
and fails on anything unguarded that is not listed below with a reason.

If this test fails, the fix is almost always to add an auth dependency:

    payload: dict = Depends(RBAC.require_permission(Permission.SOMETHING_READ))

Only add to ``PUBLIC_ROUTES`` when a route is genuinely meant to serve
unauthenticated callers, and give it a reason. A route that authenticates
itself by other means (a sensor key, a webhook signature) still belongs here,
because this gate can only see FastAPI dependencies.
"""
from fastapi.routing import APIRoute

from server.api.main import app
from server.modules.auth.rbac import RBAC

# (method, path) -> why it is allowed to serve unauthenticated callers.
PUBLIC_ROUTES: dict[tuple[str, str], str] = {
    # ── Deploy and liveness probes ───────────────────────────────────────
    ("GET", "/api/health"): "kubernetes probe; inventory counts live on /stats (admin-only)",
    ("GET", "/api/health/"): "same handler as /api/health",
    ("GET", "/api/health/live"): "kubernetes liveness probe",
    ("GET", "/api/health/ready"): "kubernetes readiness probe",

    # ── Credential exchange: public by definition ────────────────────────
    ("GET", "/api/auth/public-config"): "returns only signup_enabled; login page needs it pre-auth",
    ("POST", "/api/auth/login"): "issues the session; cannot require one",
    ("POST", "/api/auth/signup"): "gated by SIGNUP_ENABLED, forced off when DEBUG=False",
    ("GET", "/api/oauth/github/authorize"): "starts the OAuth redirect",
    ("GET", "/api/oauth/github/callback"): "OAuth provider calls this, not a logged-in user",

    # ── Webhooks: authenticated by signature, not by JWT ──────────────────
    ("POST", "/api/billing/webhook/stripe"): "verified by Stripe signature header",
    ("POST", "/api/cicd/webhook/github"): "verified by GitHub HMAC signature",
    ("POST", "/api/cicd/webhook/gitlab"): "verified by GitLab token header",

    # ── Sensor data plane: authenticated by sensor key ───────────────────
    ("POST", "/v1/events"): "eBPF sensor ingest; sensor API key as bearer",
    ("POST", "/"): "legacy eBPF ingest alias; sensor API key as bearer",
    ("POST", "/api/ingestion/v2/events"): "canonical ingest; sensor key or JWT resolved in-handler",
    ("POST", "/api/ingestion/v2/heartbeat"): "sensor key resolved in-handler",
    ("POST", "/api/sensors/heartbeat"): "sensor key resolved from header",
    ("GET", "/api/sensors/status"): "sensor key resolved from header",
    ("POST", "/api/sensors/{sensor_key}/heartbeat"): "sensor key in path is the credential",
    ("GET", "/api/sensors/{sensor_key}/status"): "sensor key in path is the credential",
    ("POST", "/api/stream/ingest"): "log shipper; sensor key required in body or header",
    ("POST", "/api/stream/ingest/ebpf"): "eBPF batch ingest; sensor key required",

    # ── Deliberately public, with a caveat ───────────────────────────────
    # Serves an SVG showing only PASSED / FAILED / unknown, so it can be
    # embedded in a public README the way a CI badge is. It does take a
    # sequential account_id, so last-gate status is enumerable across tenants.
    # Tracked as a low-severity disclosure; the fix is an unguessable badge
    # token rather than authentication, which would defeat the purpose.
    ("GET", "/api/cicd/badge/{account_id}"): "public CI badge; see note above",
}


def _is_guarded(dependant, seen: set[int] | None = None) -> bool:
    """True if RBAC.require_auth appears anywhere in this route's dependency tree.

    Walking the whole tree rather than the top level is what makes the check
    robust: ``require_role`` and ``require_permission`` both return closures
    that depend on ``require_auth``, so the guard shows up nested rather than
    directly on the route.
    """
    seen = seen if seen is not None else set()
    if id(dependant) in seen:
        return False
    seen.add(id(dependant))
    if getattr(dependant, "call", None) is RBAC.require_auth:
        return True
    return any(_is_guarded(sub, seen) for sub in getattr(dependant, "dependencies", []))


def _registered_routes() -> list[tuple[str, str]]:
    routes: list[tuple[str, str]] = []
    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        for method in sorted(route.methods - {"HEAD", "OPTIONS"}):
            routes.append((method, route.path))
    return routes


def _unguarded_routes() -> list[tuple[str, str]]:
    unguarded: list[tuple[str, str]] = []
    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        if _is_guarded(route.dependant):
            continue
        for method in sorted(route.methods - {"HEAD", "OPTIONS"}):
            unguarded.append((method, route.path))
    return unguarded


def test_no_unauthenticated_routes_outside_the_allowlist():
    offenders = sorted(set(_unguarded_routes()) - set(PUBLIC_ROUTES))
    assert not offenders, (
        "These routes have no authentication dependency and are not on the "
        "public allowlist:\n"
        + "\n".join(f"  {method} {path}" for method, path in offenders)
        + "\n\nAdd an auth dependency, e.g.\n"
        "  payload: dict = Depends(RBAC.require_permission(Permission.SOMETHING_READ))\n"
        "or, if the route is genuinely public, add it to PUBLIC_ROUTES in "
        f"{__file__} with a reason."
    )


def test_allowlist_has_no_stale_entries():
    """A public route that was removed or renamed must leave the allowlist too.

    Without this, the allowlist silently accumulates entries that no longer
    match anything, and a future route reusing one of those paths would be
    exempted by accident.
    """
    registered = set(_registered_routes())
    stale = sorted(set(PUBLIC_ROUTES) - registered)
    assert not stale, (
        "PUBLIC_ROUTES lists routes that are no longer registered:\n"
        + "\n".join(f"  {method} {path}" for method, path in stale)
        + "\n\nRemove them so the allowlist cannot exempt a future route by accident."
    )


def test_the_anomalies_routes_are_guarded():
    """Explicit regression pin for the 2026-08-23 finding.

    The generic test above would catch this too, but naming it means a future
    reader sees why the gate exists rather than only that it does.
    """
    anomaly_routes = [
        (method, path)
        for method, path in _unguarded_routes()
        if path.startswith("/api/anomalies")
    ]
    assert not anomaly_routes, (
        "/api/anomalies routes regressed to unauthenticated: " f"{anomaly_routes}"
    )


def test_the_gate_can_actually_fail():
    """Guard against the check silently passing because the walk is broken.

    If ``_is_guarded`` ever returned True unconditionally — a refactor that
    breaks the traversal, say — every test above would pass while checking
    nothing. Anchor on a route known to be public.
    """
    assert ("POST", "/api/auth/login") in set(_unguarded_routes()), (
        "_is_guarded no longer detects an unauthenticated route, so this "
        "entire gate is inert. Fix the dependency-tree walk."
    )
