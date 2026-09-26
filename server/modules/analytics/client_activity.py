"""Client / application context for log, event, and threat-actor detail views.

Every query here is scoped by account_id. Paths are redacted before they
leave this module; client identifiers are already fingerprints (see
server.modules.ingestion.client_context).
"""

from __future__ import annotations

import datetime
from collections import Counter
from typing import Any, Iterable, Optional

from sqlalchemy import desc, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from server.models.core import APICollection, APIEndpoint, MaliciousEventRecord, RequestLog
from server.modules.ingestion.redaction import redact_ingestion_path
from server.modules.utils.redactor import Redactor

_ACTIVITY_WINDOW = datetime.timedelta(days=7)
_ACTIVITY_SCAN_LIMIT = 2000
_TOP_N = 5


def _iso(value: Any) -> Optional[str]:
    return value.isoformat() if isinstance(value, datetime.datetime) else (str(value) if value else None)


async def applications_for_endpoints(
    db: AsyncSession, account_id: int, endpoint_ids: Iterable[Optional[str]]
) -> dict[str, dict[str, Any]]:
    """endpoint_id -> {"id", "name", "host"} of the application it belongs to."""
    ids = {eid for eid in endpoint_ids if eid}
    if not ids:
        return {}
    rows = await db.execute(
        select(APIEndpoint.id, APICollection.id, APICollection.name, APICollection.host)
        .join(APICollection, APICollection.id == APIEndpoint.collection_id)
        .where(
            APIEndpoint.account_id == account_id,
            APICollection.account_id == account_id,
            APIEndpoint.id.in_(ids),
        )
    )
    return {
        endpoint_id: {"id": collection_id, "name": name, "host": host}
        for endpoint_id, collection_id, name, host in rows.all()
    }


def serialize_request_log(log: RequestLog, application: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    return {
        "id": log.id,
        "ip": log.source_ip,
        "client_ip": log.client_ip or log.source_ip,
        "client_id": log.client_id,
        "user_agent": log.user_agent,
        "method": log.method,
        "path": redact_ingestion_path(log.path),
        "host": log.host or "",
        "status": log.response_code,
        "latency_ms": log.response_time_ms,
        "timestamp": _iso(log.created_at),
        "endpoint_id": log.endpoint_id,
        "application": application,
    }


async def client_activity(
    db: AsyncSession, account_id: int, client: str, *, recent: int = 10
) -> dict[str, Any]:
    """What one client (IP or actor id) did over the last 7 days."""
    since = datetime.datetime.now(datetime.timezone.utc) - _ACTIVITY_WINDOW
    result = await db.execute(
        select(RequestLog)
        .where(
            RequestLog.account_id == account_id,
            or_(RequestLog.client_ip == client, RequestLog.source_ip == client),
            RequestLog.created_at >= since,
        )
        .order_by(desc(RequestLog.created_at))
        .limit(_ACTIVITY_SCAN_LIMIT)
    )
    logs = result.scalars().all()
    applications = await applications_for_endpoints(db, account_id, (log.endpoint_id for log in logs))

    user_agents: Counter[str] = Counter()
    hosts: Counter[str] = Counter()
    apps: Counter[str] = Counter()
    endpoints: Counter[str] = Counter()
    statuses: Counter[str] = Counter()
    client_ids: set[str] = set()
    latencies: list[int] = []
    for log in logs:
        if log.user_agent:
            user_agents[log.user_agent] += 1
        if log.host:
            hosts[log.host] += 1
        app = applications.get(log.endpoint_id or "")
        if app:
            apps[app["name"]] += 1
        endpoints[f"{log.method or 'GET'} {redact_ingestion_path(log.path or '/').split('?', 1)[0]}"] += 1
        if log.response_code:
            statuses[f"{log.response_code // 100}xx"] += 1
        if log.client_id:
            client_ids.add(log.client_id)
        if log.response_time_ms is not None:
            latencies.append(log.response_time_ms)

    def top(counter: Counter[str]) -> list[dict[str, Any]]:
        return [{"value": value, "count": count} for value, count in counter.most_common(_TOP_N)]

    return {
        "client": client,
        "window_days": _ACTIVITY_WINDOW.days,
        "request_count": len(logs),
        "truncated": len(logs) >= _ACTIVITY_SCAN_LIMIT,
        "first_seen": _iso(logs[-1].created_at) if logs else None,
        "last_seen": _iso(logs[0].created_at) if logs else None,
        "avg_latency_ms": round(sum(latencies) / len(latencies)) if latencies else None,
        "user_agents": top(user_agents),
        "hosts": top(hosts),
        "applications": top(apps),
        "endpoints": top(endpoints),
        "status_classes": dict(statuses),
        "client_ids": sorted(client_ids)[:_TOP_N],
        "recent_requests": [
            serialize_request_log(log, applications.get(log.endpoint_id or "")) for log in logs[:recent]
        ],
    }


def serialize_security_event(event: MaliciousEventRecord) -> dict[str, Any]:
    return {
        "id": event.id,
        "ip": event.ip or event.actor,
        "actor": event.actor,
        "method": event.method or "GET",
        "url": Redactor.redact_text(event.url or ""),
        "host": event.host or "",
        "category": event.category or event.event_type,
        "sub_category": event.sub_category,
        "severity": event.severity,
        "status": event.status,
        "type": event.type,
        "label": event.label,
        "context_source": event.context_source,
        "session_id": event.session_id,
        "successful_exploit": event.successful_exploit,
        "country_code": event.country_code,
        "dest_country_code": event.dest_country_code,
        "detected_at": event.detected_at,
        "created_at": _iso(event.created_at),
        "payload": Redactor.redact_text(event.payload or "")[:4000] if isinstance(event.payload, str) else None,
        "metadata": Redactor.redact_json(event.event_metadata) if event.event_metadata else None,
    }


async def events_for_client(db: AsyncSession, account_id: int, client: str, limit: int = 20) -> list[dict[str, Any]]:
    result = await db.execute(
        select(MaliciousEventRecord)
        .where(
            MaliciousEventRecord.account_id == account_id,
            or_(MaliciousEventRecord.ip == client, MaliciousEventRecord.actor == client),
        )
        .order_by(desc(MaliciousEventRecord.detected_at))
        .limit(limit)
    )
    return [serialize_security_event(event) for event in result.scalars().all()]


async def request_log_near_event(
    db: AsyncSession, account_id: int, event: MaliciousEventRecord
) -> Optional[RequestLog]:
    """The request that most likely produced this event (same client + path)."""
    client = event.ip or event.actor
    if not client:
        return None
    path = (event.url or "/").split("?", 1)[0]
    result = await db.execute(
        select(RequestLog)
        .where(
            RequestLog.account_id == account_id,
            or_(RequestLog.client_ip == client, RequestLog.source_ip == client),
            RequestLog.path.startswith(path, autoescape=True),
        )
        .order_by(desc(RequestLog.created_at))
        .limit(1)
    )
    return result.scalars().first()
