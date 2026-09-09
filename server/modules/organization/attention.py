"""Tenant attention inbox — factual posture, inventory traits, ranked open findings.

Risk model ``open_finding_severity_v1`` matches ``GET /api/dashboard``
``summary.risk_score``: ``min(100, critical*20 + high*10 + medium*3)``.
It counts open findings only. Exposure and auth are listed as facts on each
finding, not mixed into the integer, until those inputs are first-class.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from server.config import settings
from server.models.core import APIEndpoint, Alert, Vulnerability

OPEN_FINDING_STATUSES = {"OPEN", "TRIAGED", "IN_REMEDIATION"}
CLOSED_FINDING_STATUSES = {"CLOSED", "RESOLVED", "FALSE_POSITIVE", "ACCEPTED_RISK"}
SHADOW_STATUSES = {"SHADOW", "ROGUE"}
SEVERITY_POINTS = {"CRITICAL": 20, "HIGH": 10, "MEDIUM": 3, "LOW": 0}
SEVERITY_RANK = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3, "INFO": 4}

RISK_MODEL = {
    "id": "open_finding_severity_v1",
    "formula": "min(100, critical*20 + high*10 + medium*3)",
    "rationale": (
        "Same weights as GET /api/dashboard summary.risk_score. "
        "Counts open findings only. Internet exposure, authentication, and "
        "sensitive-data flags are shown as facts, not extra points."
    ),
}


def _norm(value: Any, default: str = "") -> str:
    return str(value or default).strip().upper()


def _auth_missing(auth_types: Any) -> bool:
    if not auth_types:
        return True
    if not isinstance(auth_types, list):
        return True
    cleaned = [str(item).strip().upper() for item in auth_types if str(item).strip()]
    return not cleaned or cleaned == ["UNAUTHENTICATED"]


def _confidence_rank(value: Any) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    mapping = {"HIGH": 3.0, "MEDIUM": 2.0, "LOW": 1.0}
    return mapping.get(_norm(value), 0.0)


def _has_evidence(evidence: Any) -> bool:
    if evidence is None:
        return False
    if isinstance(evidence, dict):
        return any(value not in (None, "", [], {}) for value in evidence.values())
    if isinstance(evidence, str):
        return bool(evidence.strip())
    return True


def _finding_facts(vulnerability: Vulnerability, endpoint: APIEndpoint | None) -> list[dict[str, str]]:
    facts: list[dict[str, str]] = []
    severity = _norm(vulnerability.severity, "UNKNOWN")
    if severity:
        facts.append({"label": "Severity", "value": severity})
    if vulnerability.confidence is not None:
        facts.append({"label": "Confidence", "value": str(vulnerability.confidence)})
    if endpoint is not None:
        access = _norm(endpoint.access_type, "PRIVATE")
        if access == "PUBLIC":
            facts.append({"label": "Exposure", "value": "Internet exposed"})
        elif access:
            facts.append({"label": "Exposure", "value": access.title()})
        if _auth_missing(endpoint.auth_types_found):
            facts.append({"label": "Authentication", "value": "Unauthenticated"})
        elif endpoint.auth_types_found:
            facts.append({
                "label": "Authentication",
                "value": ", ".join(str(item) for item in endpoint.auth_types_found),
            })
        if endpoint.is_sensitive:
            facts.append({"label": "Data", "value": "Sensitive"})
        if endpoint.status and _norm(endpoint.status) in SHADOW_STATUSES:
            facts.append({"label": "Inventory", "value": str(endpoint.status)})
    if _has_evidence(vulnerability.evidence):
        facts.append({"label": "Evidence", "value": "Present"})
    else:
        facts.append({"label": "Evidence", "value": "Not persisted on this finding"})
    return facts


async def build_attention(
    db: AsyncSession,
    account_id: int,
    window_hours: int = 24,
) -> dict[str, Any]:
    window_hours = 24 if window_hours not in {24, 168} else window_hours
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=window_hours)

    endpoints = (
        await db.execute(
            select(APIEndpoint).where(APIEndpoint.account_id == account_id)
        )
    ).scalars().all()

    discovered = len(endpoints)
    internet_facing = 0
    shadow = 0
    unauthenticated = 0
    sensitive = 0
    by_id: dict[str, APIEndpoint] = {}
    for endpoint in endpoints:
        by_id[str(endpoint.id)] = endpoint
        if _norm(endpoint.access_type) == "PUBLIC":
            internet_facing += 1
        if _norm(endpoint.status) in SHADOW_STATUSES:
            shadow += 1
        if _auth_missing(endpoint.auth_types_found):
            unauthenticated += 1
        if endpoint.is_sensitive:
            sensitive += 1

    vulnerabilities = (
        await db.execute(
            select(Vulnerability).where(Vulnerability.account_id == account_id)
        )
    ).scalars().all()

    open_by_severity = {"CRITICAL": 0, "HIGH": 0, "MEDIUM": 0, "LOW": 0}
    open_findings: list[Vulnerability] = []
    resolved_count = 0
    new_in_window = 0
    # Resolve time is not persisted on Vulnerability; do not invent a window
    # counter from created_at (that mislabels old findings closed recently).
    resolved_in_window = 0
    for vulnerability in vulnerabilities:
        status = _norm(vulnerability.status, "OPEN")
        created = vulnerability.created_at
        if created is not None and created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        if status in CLOSED_FINDING_STATUSES:
            resolved_count += 1
            continue
        if status in OPEN_FINDING_STATUSES or not status:
            open_findings.append(vulnerability)
            severity = _norm(vulnerability.severity, "LOW")
            if severity in open_by_severity:
                open_by_severity[severity] += 1
            if created is not None and created >= cutoff:
                new_in_window += 1

    critical = open_by_severity["CRITICAL"]
    high = open_by_severity["HIGH"]
    medium = open_by_severity["MEDIUM"]
    posture_reasons = [
        {"factor": "Open critical findings", "count": critical, "points": critical * SEVERITY_POINTS["CRITICAL"]},
        {"factor": "Open high findings", "count": high, "points": high * SEVERITY_POINTS["HIGH"]},
        {"factor": "Open medium findings", "count": medium, "points": medium * SEVERITY_POINTS["MEDIUM"]},
    ]
    posture_score = min(100, sum(item["points"] for item in posture_reasons))

    open_alerts = await db.scalar(
        select(func.count(Alert.id)).where(
            Alert.account_id == account_id,
            Alert.status == "OPEN",
        )
    ) or 0

    open_findings.sort(
        key=lambda item: (
            SEVERITY_RANK.get(_norm(item.severity), 9),
            -_confidence_rank(item.confidence),
            item.created_at or now,
        )
    )

    top_risks = []
    for vulnerability in open_findings[:10]:
        endpoint = by_id.get(str(vulnerability.endpoint_id)) if vulnerability.endpoint_id else None
        top_risks.append({
            "id": vulnerability.id,
            "title": vulnerability.type or vulnerability.template_id or "Finding",
            "severity": _norm(vulnerability.severity, "LOW"),
            "status": _norm(vulnerability.status, "OPEN"),
            "confidence": vulnerability.confidence,
            "api": {
                "endpoint_id": vulnerability.endpoint_id,
                "method": vulnerability.method or (endpoint.method if endpoint else None),
                "url": vulnerability.url or (endpoint.path if endpoint else None),
                "host": endpoint.host if endpoint else None,
            },
            "has_evidence": _has_evidence(vulnerability.evidence),
            "facts": _finding_facts(vulnerability, endpoint),
            "next_action": "Investigate",
        })

    notes: list[str] = []
    if discovered == 0:
        notes.append("No APIs discovered yet. Connect a sensor or import traffic before posture scores are meaningful.")
    elif not open_findings:
        if settings.STARTUP_ENABLE_CONTINUOUS_TESTING or settings.CONTINUOUS_TESTING_ENABLED:
            notes.append(
                f"{discovered} APIs are in inventory and there are 0 open findings. "
                "Treat this as a baseline, not proof the estate is safe."
            )
        else:
            notes.append(
                f"{discovered} APIs are in inventory and there are 0 open findings. "
                "Confirmatory testing is not running, so absence of findings is not a clean bill of health."
            )

    return {
        "window_hours": window_hours,
        "risk_model": RISK_MODEL,
        "posture": {
            "score": posture_score,
            "scale": "0-100, higher is more risk",
            "reasons": posture_reasons,
        },
        "severity": {
            "critical": critical,
            "high": high,
            "medium": medium,
            "low": open_by_severity["LOW"],
        },
        "inventory": {
            "apis_discovered": discovered,
            "internet_facing": internet_facing,
            "shadow": shadow,
            "unauthenticated": unauthenticated,
            "sensitive": sensitive,
        },
        "activity": {
            "open_findings": len(open_findings),
            "resolved_findings": resolved_count,
            "new_findings": new_in_window,
            "resolved_in_window": resolved_in_window,
            "open_alerts": int(open_alerts),
        },
        "top_risks": top_risks,
        "notes": notes,
        "continuous_testing_enabled": bool(
            settings.STARTUP_ENABLE_CONTINUOUS_TESTING or settings.CONTINUOUS_TESTING_ENABLED
        ),
    }
