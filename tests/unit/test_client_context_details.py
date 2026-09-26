"""Client context capture on request logs and the detail views built on it."""

import datetime

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

import server.modules.ingestion.processors as processors
from server.models import core as models
from server.modules.ingestion.client_context import extract_client_context
from server.modules.ingestion.processors import _resolve_actor, process_event_batch
from server.modules.ingestion.schema import APIRequest, APIResponse, APITrafficEvent, EventBatch

ACCOUNT = 1000000


def test_extract_client_context_fingerprints_credentials():
    ctx = extract_client_context(
        {"User-Agent": "curl/8.4", "x-api-key": "sk_live_secret"}, "203.0.113.7"
    )

    assert ctx["client_ip"] == "203.0.113.7"
    assert ctx["user_agent"] == "curl/8.4"
    assert ctx["client_id"].startswith("key:")
    assert "sk_live_secret" not in ctx["client_id"]

    bearer = extract_client_context({"authorization": "Bearer abc.def.ghi"})
    assert bearer["client_id"].startswith("bearer:")
    assert "abc.def.ghi" not in bearer["client_id"]


def test_extract_client_context_ip_fallbacks_and_limits():
    ctx = extract_client_context({"x-forwarded-for": "198.51.100.4, 10.0.0.1", "user-agent": "x" * 900}, "not-an-ip")

    assert ctx["client_ip"] == "198.51.100.4"
    assert len(ctx["user_agent"]) == 512
    assert extract_client_context({}, None) == {"client_ip": None, "user_agent": None, "client_id": None}


def test_resolve_actor_never_returns_raw_api_key():
    actor = _resolve_actor({"request": {"headers": {"x-api-key": "sk_live_secret"}}})

    assert actor.startswith("key:")
    assert "sk_live_secret" not in actor
    assert _resolve_actor({"request": {"headers": {"x-api-client-id": "svc-a"}}}) == "svc-a"


async def test_event_batch_records_client_context(test_engine, monkeypatch):
    session_factory = async_sessionmaker(bind=test_engine, expire_on_commit=False)
    monkeypatch.setattr(processors, "AsyncSessionLocal", session_factory)

    async def noop(account_id):
        return None

    monkeypatch.setattr(processors, "bump_cache_version", noop)
    event = APITrafficEvent(
        account_id=ACCOUNT,
        observed_at=1710000000000,
        source_ip="198.51.100.9",
        request=APIRequest(
            method="GET",
            path="/orders",
            host="shop.example.com",
            scheme="https",
            headers={"user-agent": "Mobile/2.1", "x-api-key": "sk_live_secret"},
        ),
        response=APIResponse(status_code=200),
    )

    await process_event_batch("ctx-job", ACCOUNT, EventBatch(events=[event]).model_dump(mode="json"))

    async with session_factory() as db:
        log = (await db.execute(select(models.RequestLog))).scalar_one()

    assert log.host == "shop.example.com"
    assert log.client_ip == "198.51.100.9"
    assert log.user_agent == "Mobile/2.1"
    assert log.client_id.startswith("key:")
    assert "sk_live_secret" not in (log.source_ip or "")


async def _seed_traffic(db_session):
    now = datetime.datetime.now(datetime.timezone.utc)
    db_session.add(models.APICollection(id="app-1", account_id=ACCOUNT, name="Checkout API", host="shop.example.com"))
    db_session.add(models.APIEndpoint(
        id="ep-1", account_id=ACCOUNT, collection_id="app-1", method="POST",
        path="/orders", path_pattern="/orders", host="shop.example.com",
    ))
    for i in range(3):
        db_session.add(models.RequestLog(
            id=f"log-{i}", account_id=ACCOUNT, endpoint_id="ep-1", source_ip="203.0.113.5",
            client_ip="203.0.113.5", user_agent="sqlmap/1.7", client_id="key:abc123",
            method="POST", path="/orders", host="shop.example.com", response_code=403 if i else 200,
            response_time_ms=40 + i, created_at=now - datetime.timedelta(minutes=i),
        ))
    db_session.add(models.MaliciousEventRecord(
        id="evt-1", account_id=ACCOUNT, actor="203.0.113.5", ip="203.0.113.5", url="/orders?id=1' OR 1=1",
        method="POST", host="shop.example.com", category="SQL Injection", severity="HIGH",
        detected_at=int(now.timestamp() * 1000),
    ))
    db_session.add(models.ThreatActor(
        id="actor-1", account_id=ACCOUNT, source_ip="203.0.113.5", status="MONITORING", event_count=3, risk_score=8.0,
    ))
    # Another tenant's data must never appear.
    db_session.add(models.RequestLog(
        id="other-log", account_id=42, source_ip="203.0.113.5", client_ip="203.0.113.5",
        user_agent="other-tenant-agent", method="GET", path="/secret", created_at=now,
    ))
    await db_session.commit()


async def test_recent_includes_client_and_application(client, auth_headers, db_session):
    await _seed_traffic(db_session)

    rows = (await client.get("/api/stream/recent?limit=10", headers=auth_headers)).json()

    row = next(r for r in rows if r["id"] == "log-0")
    assert row["user_agent"] == "sqlmap/1.7"
    assert row["client_id"] == "key:abc123"
    assert row["application"]["name"] == "Checkout API"
    assert all(r["id"] != "other-log" for r in rows)


async def test_request_log_detail(client, auth_headers, db_session):
    await _seed_traffic(db_session)

    resp = await client.get("/api/stream/logs/log-0", headers=auth_headers)

    assert resp.status_code == 200
    body = resp.json()
    assert body["log"]["application"]["name"] == "Checkout API"
    assert body["endpoint"]["path_pattern"] == "/orders"
    activity = body["client_activity"]
    assert activity["request_count"] == 3
    assert activity["user_agents"][0] == {"value": "sqlmap/1.7", "count": 3}
    assert activity["applications"][0]["value"] == "Checkout API"
    assert "other-tenant-agent" not in resp.text

    assert (await client.get("/api/stream/logs/other-log", headers=auth_headers)).status_code == 404


async def test_threat_actor_and_event_detail(client, auth_headers, db_session):
    await _seed_traffic(db_session)

    actor = (await client.get("/api/threat-actors/203.0.113.5/detail", headers=auth_headers)).json()
    assert actor["actor"]["status"] == "MONITORING"
    assert actor["client_activity"]["hosts"][0]["value"] == "shop.example.com"
    assert actor["events"][0]["category"] == "SQL Injection"

    event = (await client.get("/api/threat-actors/events/evt-1", headers=auth_headers)).json()
    assert event["event"]["host"] == "shop.example.com"
    assert event["request"]["application"]["name"] == "Checkout API"
    assert event["request"]["user_agent"] == "sqlmap/1.7"

    assert (await client.get("/api/threat-actors/198.51.100.99/detail", headers=auth_headers)).status_code == 404
    assert (await client.get("/api/threat-actors/events/missing", headers=auth_headers)).status_code == 404


async def test_audit_log_records_caller_context(client, auth_headers):
    resp = await client.post(
        "/api/auth/users/invite",
        json={"email": "audited@example.com", "role": "VIEWER"},
        headers={**auth_headers, "User-Agent": "AdminConsole/1.0", "X-Forwarded-For": "198.51.100.23"},
    )
    assert resp.status_code == 200

    logs = (await client.get("/api/audit-logs/", headers=auth_headers)).json()["logs"]
    entry = next(log for log in logs if log["action"] == "USER_INVITED")
    assert entry["user_agent"] == "AdminConsole/1.0"
    # The transport peer wins over a client-supplied X-Forwarded-For (spoofable);
    # in production uvicorn --proxy-headers resolves trusted proxies into the peer.
    assert entry["ip_address"] == "127.0.0.1"
    assert entry["user_email"] is None or "@" in entry["user_email"]

    legacy = (await client.post("/api/fetchAuditData", json={"skip": 0, "limit": 20}, headers=auth_headers)).json()
    row = next(log for log in legacy["auditLogs"] if log["action"] == "USER_INVITED")
    assert row["userAgent"] == "AdminConsole/1.0"
    assert row["ipAddress"] == "127.0.0.1"
