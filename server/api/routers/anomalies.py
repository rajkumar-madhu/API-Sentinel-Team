"""Anomaly inspection routes.

Every route here is authenticated and tenant-scoped. ``RequestLog`` rows carry
``account_id``, so reads filter on it and writes stamp it from the caller's
token rather than trusting the request body.

``/train`` and ``/tune`` mutate **process-global** detector state shared by all
tenants, so they are restricted to ADMIN. Per-tenant model isolation is not yet
modelled — until it is, treat these as operator controls, not tenant features.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc

from server.modules.persistence.database import get_db
from server.modules.anomaly_detector.rate_detector import RateDetector
from server.modules.anomaly_detector.isolation_forest_scorer import IsolationForestScorer
from server.modules.auth.rbac import RBAC, Permission, require_admin
from server.models.core import APIEndpoint, RequestLog

router = APIRouter()
_rate_detector = RateDetector()
_scorer = IsolationForestScorer()


async def _owned_endpoint_id(db: AsyncSession, account_id: int, endpoint_id: str) -> str:
    """Return ``endpoint_id`` if it belongs to ``account_id``, else 404.

    Mirrors the not-found response for foreign endpoints so the API does not
    confirm that another tenant's endpoint exists.
    """
    result = await db.execute(
        select(APIEndpoint.id).where(
            APIEndpoint.account_id == account_id,
            APIEndpoint.id == endpoint_id,
        )
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Endpoint not found")
    return endpoint_id


@router.get("/")
async def get_anomalies(
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(RBAC.require_permission(Permission.TRAFFIC_READ)),
):
    """Return this account's recent request logs with anomaly scores."""
    account_id = payload["account_id"]
    result = await db.execute(
        select(RequestLog)
        .where(RequestLog.account_id == account_id)
        .order_by(desc(RequestLog.created_at))
        .limit(limit)
    )
    logs = result.scalars().all()
    return {"total": len(logs), "anomalies": [
        {
            "id": r.id,
            "endpoint_id": r.endpoint_id,
            "source_ip": r.source_ip,
            "method": r.method,
            "path": r.path,
            "response_code": r.response_code,
            "response_time_ms": r.response_time_ms,
            "created_at": str(r.created_at),
        } for r in logs
    ]}


@router.get("/rate-check")
async def check_rate(
    source_ip: str = Query(...),
    endpoint_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(RBAC.require_permission(Permission.TRAFFIC_READ)),
):
    """Check if a source IP is hitting one of this account's endpoints at anomalous rate."""
    await _owned_endpoint_id(db, payload["account_id"], endpoint_id)
    return await _rate_detector.check_rate(source_ip, endpoint_id, db)


@router.get("/sequential-enumeration/{endpoint_id}")
async def detect_sequential_enumeration(
    endpoint_id: str,
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(RBAC.require_permission(Permission.TRAFFIC_READ)),
):
    """Detect BOLA-style sequential ID enumeration against one of this account's endpoints."""
    await _owned_endpoint_id(db, payload["account_id"], endpoint_id)
    return await _rate_detector.detect_sequential_enumeration(endpoint_id, db)


@router.post("/score")
async def score_request(
    features: dict,
    payload: dict = Depends(RBAC.require_permission(Permission.TRAFFIC_READ)),
):
    """
    Score a request for anomaly using Isolation Forest.
    Body keys: requests_per_sec, unique_paths, payload_entropy,
               param_count, error_rate, response_time_ms
    """
    del payload
    score = _scorer.score(features)
    return {"anomaly_score": score, "anomalous": score > 0.7}


@router.post("/train")
async def train_model(
    feature_vectors: list[list],
    payload: dict = Depends(require_admin),
):
    """Train the Isolation Forest model on historical feature vectors.

    ADMIN-only: the scorer is process-global, so training affects every tenant
    served by this worker.
    """
    del payload
    _scorer.fit(feature_vectors)
    return {"status": "trained", "samples": len(feature_vectors)}


@router.post("/tune")
async def tune_anomaly_thresholds(
    sensitivity: float,
    payload: dict = Depends(require_admin),
):
    """Retune rate-detector sensitivity.

    ADMIN-only: the detector is process-global, so tuning affects every tenant
    served by this worker.
    """
    del payload
    global _rate_detector
    _rate_detector = RateDetector(threshold_multiplier=max(1.0, 4.0 - sensitivity * 3))
    return {"status": "tuned", "new_sensitivity": sensitivity}


@router.post("/log")
async def log_request(
    endpoint_id: str,
    source_ip: str,
    method: str,
    path: str,
    response_code: int = 200,
    response_time_ms: int = 0,
    db: AsyncSession = Depends(get_db),
    payload: dict = Depends(RBAC.require_permission(Permission.TRAFFIC_MANAGE)),
):
    """Ingest a single request log entry into the caller's account."""
    account_id = payload["account_id"]
    await _owned_endpoint_id(db, account_id, endpoint_id)
    log = RequestLog(
        account_id=account_id,
        endpoint_id=endpoint_id,
        source_ip=source_ip,
        method=method,
        path=path,
        response_code=response_code,
        response_time_ms=response_time_ms,
    )
    db.add(log)
    await db.commit()
    return {"status": "logged", "id": log.id}
