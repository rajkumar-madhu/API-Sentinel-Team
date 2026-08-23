"""Auth + tenant-isolation contract for /api/anomalies.

These routes previously required no authentication at all and applied no
account filter, so any unauthenticated caller could read every tenant's
request logs, inject telemetry, retrain the shared anomaly model, and retune
detector sensitivity. This suite pins the fixed contract.
"""
import uuid

import pytest

from server.models.core import APIEndpoint, RequestLog
from server.modules.auth.jwt_issuer import JWTIssuer

TENANT_A = 1000000
TENANT_B = 2000000


def _headers_for_account(account_id: int, role: str = "ADMIN") -> dict[str, str]:
    token = JWTIssuer.create_access_token(
        {
            "sub": f"{role.lower()}-{account_id}",
            "email": f"{role.lower()}-{account_id}@example.com",
            "account_id": account_id,
            "role": role,
        }
    )
    return {"Authorization": f"Bearer {token}"}


async def _seed_request_log(db_session, account_id: int) -> tuple[str, str]:
    endpoint = APIEndpoint(
        id=str(uuid.uuid4()),
        account_id=account_id,
        path=f"/tenant-{account_id}/orders",
        method="GET",
        host="example.test",
    )
    log = RequestLog(
        id=str(uuid.uuid4()),
        account_id=account_id,
        endpoint_id=endpoint.id,
        source_ip="203.0.113.7",
        method="GET",
        path=endpoint.path,
        response_code=200,
        response_time_ms=5,
    )
    db_session.add_all([endpoint, log])
    await db_session.commit()
    return endpoint.id, log.id


ANONYMOUS_READS = [
    ("get", "/api/anomalies/"),
    ("get", "/api/anomalies/rate-check?source_ip=203.0.113.7&endpoint_id=x"),
    ("get", "/api/anomalies/sequential-enumeration/x"),
]

ANONYMOUS_WRITES = [
    ("post", "/api/anomalies/score", {"requests_per_sec": 1}),
    ("post", "/api/anomalies/train", [[1, 2, 3]]),
    ("post", "/api/anomalies/tune", None),
    ("post", "/api/anomalies/log", None),
]


@pytest.mark.asyncio
@pytest.mark.parametrize("method,url", ANONYMOUS_READS)
async def test_anomaly_reads_reject_anonymous(client, method, url):
    resp = await getattr(client, method)(url)
    assert resp.status_code == 401, f"{url} served an unauthenticated caller"


@pytest.mark.asyncio
@pytest.mark.parametrize("method,url,body", ANONYMOUS_WRITES)
async def test_anomaly_writes_reject_anonymous(client, method, url, body):
    resp = await getattr(client, method)(url, json=body)
    assert resp.status_code == 401, f"{url} served an unauthenticated caller"


@pytest.mark.asyncio
async def test_anomaly_list_is_tenant_scoped(client, db_session):
    _, log_id = await _seed_request_log(db_session, TENANT_A)

    own = await client.get("/api/anomalies/", headers=_headers_for_account(TENANT_A))
    assert own.status_code == 200
    assert any(row["id"] == log_id for row in own.json()["anomalies"])

    other = await client.get("/api/anomalies/", headers=_headers_for_account(TENANT_B))
    assert other.status_code == 200
    assert all(row["id"] != log_id for row in other.json()["anomalies"])


@pytest.mark.asyncio
async def test_rate_check_rejects_foreign_endpoint(client, db_session):
    endpoint_id, _ = await _seed_request_log(db_session, TENANT_A)

    own = await client.get(
        f"/api/anomalies/rate-check?source_ip=203.0.113.7&endpoint_id={endpoint_id}",
        headers=_headers_for_account(TENANT_A),
    )
    assert own.status_code == 200

    other = await client.get(
        f"/api/anomalies/rate-check?source_ip=203.0.113.7&endpoint_id={endpoint_id}",
        headers=_headers_for_account(TENANT_B),
    )
    assert other.status_code == 404


@pytest.mark.asyncio
async def test_sequential_enumeration_rejects_foreign_endpoint(client, db_session):
    endpoint_id, _ = await _seed_request_log(db_session, TENANT_A)

    own = await client.get(
        f"/api/anomalies/sequential-enumeration/{endpoint_id}",
        headers=_headers_for_account(TENANT_A),
    )
    assert own.status_code == 200

    other = await client.get(
        f"/api/anomalies/sequential-enumeration/{endpoint_id}",
        headers=_headers_for_account(TENANT_B),
    )
    assert other.status_code == 404


@pytest.mark.asyncio
async def test_logged_request_is_stamped_with_caller_account(client, db_session):
    endpoint_id, _ = await _seed_request_log(db_session, TENANT_A)

    resp = await client.post(
        "/api/anomalies/log",
        params={
            "endpoint_id": endpoint_id,
            "source_ip": "198.51.100.4",
            "method": "GET",
            "path": "/tenant-a/orders",
        },
        headers=_headers_for_account(TENANT_A),
    )
    assert resp.status_code == 200
    new_id = resp.json()["id"]

    # The injected log must be visible to its own tenant only.
    own = await client.get("/api/anomalies/", headers=_headers_for_account(TENANT_A))
    assert any(row["id"] == new_id for row in own.json()["anomalies"])

    other = await client.get("/api/anomalies/", headers=_headers_for_account(TENANT_B))
    assert all(row["id"] != new_id for row in other.json()["anomalies"])


@pytest.mark.asyncio
async def test_model_mutation_routes_require_admin(client):
    viewer = _headers_for_account(TENANT_A, role="VIEWER")

    train = await client.post("/api/anomalies/train", json=[[1, 2, 3]], headers=viewer)
    assert train.status_code == 403

    tune = await client.post("/api/anomalies/tune", params={"sensitivity": 0.5}, headers=viewer)
    assert tune.status_code == 403
