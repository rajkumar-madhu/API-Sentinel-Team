"""In shadow mode the unified pipeline only observes; the legacy detectors stay
authoritative. Only active mode hands alerting and enforcement to the pipeline.

Covers the three legacy entry points that used to return early in shadow mode
and so silently dropped alerts, threat-actor tracking and auto-blocking.
"""

import asyncio

import pytest
from sqlalchemy import select

from server.config import settings
from server.models.core import Alert, ThreatActor
from server.modules.detection import engine
from server.modules.detection.correlation_engine import correlate_threat
from server.modules.detection.engine import detect_api_behavior
from server.modules.response.incident_orchestrator import handle_incident


@pytest.fixture
def shadow_mode(monkeypatch):
    monkeypatch.setattr(settings, "UNIFIED_PIPELINE_MODE", "shadow")


async def _burst(db, actor_id: str) -> None:
    ts = int(asyncio.get_event_loop().time() * 1000)
    for i in range(3):
        await detect_api_behavior(
            db,
            account_id=1000000,
            actor_id=actor_id,
            endpoint_id="endpoint-burst",
            path="/login",
            timestamp_ms=ts + i * 10,
            latency_ms=50,
        )
    await db.commit()


@pytest.mark.asyncio
async def test_detect_api_behavior_still_alerts_in_shadow_mode(shadow_mode, monkeypatch, db_session):
    monkeypatch.setattr(settings, "DETECTION_WINDOW_SECONDS", 5)
    monkeypatch.setattr(settings, "DETECTION_BURST_THRESHOLD", 2)
    monkeypatch.setattr(settings, "DETECTION_ALERT_COOLDOWN_SECONDS", 0)

    await _burst(db_session, "10.0.0.50")

    alerts = (
        await db_session.execute(select(Alert).where(Alert.source_ip == "10.0.0.50"))
    ).scalars().all()
    assert alerts, "legacy detector must still raise the alert in shadow mode"


@pytest.mark.asyncio
async def test_detect_api_behavior_defers_to_pipeline_in_active_mode(monkeypatch, db_session):
    monkeypatch.setattr(settings, "UNIFIED_PIPELINE_MODE", "active")
    monkeypatch.setattr(settings, "DETECTION_WINDOW_SECONDS", 5)
    monkeypatch.setattr(settings, "DETECTION_BURST_THRESHOLD", 2)
    monkeypatch.setattr(settings, "DETECTION_ALERT_COOLDOWN_SECONDS", 0)
    sentinel = {"handled_by": "unified"}

    async def fake_process(*args, **kwargs):
        return sentinel

    monkeypatch.setattr(engine.unified_detection_pipeline, "process", fake_process)

    result = await detect_api_behavior(
        db_session,
        account_id=1000000,
        actor_id="10.0.0.51",
        endpoint_id="endpoint-burst",
        path="/login",
        timestamp_ms=int(asyncio.get_event_loop().time() * 1000),
        latency_ms=50,
    )
    await db_session.commit()

    assert result is sentinel
    alerts = (
        await db_session.execute(select(Alert).where(Alert.source_ip == "10.0.0.51"))
    ).scalars().all()
    assert alerts == [], "active mode must not also run the legacy detector"


@pytest.mark.asyncio
async def test_correlate_threat_tracks_actor_in_shadow_mode(shadow_mode, db_session):
    result = await correlate_threat(
        db_session,
        account_id=1000000,
        source_ip="10.0.0.60",
        event_type="suspicious_access",
        severity="HIGH",
    )
    await db_session.commit()

    assert result["risk_score"] == pytest.approx(0.20)
    assert result["event_count"] == 1
    actor = (
        await db_session.execute(select(ThreatActor).where(ThreatActor.source_ip == "10.0.0.60"))
    ).scalar_one()
    assert actor.risk_score == pytest.approx(0.20)


@pytest.mark.asyncio
async def test_handle_incident_creates_alert_in_shadow_mode(shadow_mode, db_session):
    result = await handle_incident(
        db_session,
        1000000,
        "alert.rate_burst",
        "HIGH",
        "10.0.0.70",
        "endpoint_123",
        {"reason": "High request rate detected"},
    )
    await db_session.commit()

    assert result["alert_id"] is not None
    assert result["actor_risk_score"] == pytest.approx(0.20)
    alert = (
        await db_session.execute(select(Alert).where(Alert.id == result["alert_id"]))
    ).scalar_one()
    assert alert.source_ip == "10.0.0.70"
