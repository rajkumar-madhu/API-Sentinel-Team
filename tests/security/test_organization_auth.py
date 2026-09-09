import uuid

import pytest

from server.models.core import Account, APIEndpoint, User, Vulnerability
from server.modules.auth.jwt_issuer import JWTIssuer


def _headers(account_id: int, role: str = "ADMIN") -> dict[str, str]:
    token = JWTIssuer.create_access_token(
        {
            "sub": f"{role.lower()}-{account_id}",
            "email": f"{role.lower()}-{account_id}@example.com",
            "account_id": account_id,
            "role": role,
        }
    )
    return {"Authorization": f"Bearer {token}"}


async def _seed_account(db_session, account_id: int, name: str) -> Account:
    account = Account(id=account_id, name=name, plan_tier="FREE")
    db_session.add(account)
    await db_session.commit()
    return account


@pytest.mark.asyncio
async def test_organization_routes_require_auth(client):
    for path, method in (
        ("/api/organization/", "get"),
        ("/api/organization/attention", "get"),
        ("/api/organization/1", "get"),
        ("/api/organization/1/members", "get"),
    ):
        response = await getattr(client, method)(path)
        assert response.status_code == 401, path


@pytest.mark.asyncio
async def test_organization_list_is_tenant_scoped(client, db_session):
    await _seed_account(db_session, 1000000, "Tenant A")
    await _seed_account(db_session, 2000000, "Tenant B")

    own = await client.get("/api/organization/", headers=_headers(1000000))
    assert own.status_code == 200
    body = own.json()
    assert body["total"] == 1
    assert body["organizations"][0]["id"] == 1000000
    assert body["organizations"][0]["name"] == "Tenant A"

    other = await client.get("/api/organization/2000000", headers=_headers(1000000))
    assert other.status_code == 404

    members = await client.get("/api/organization/2000000/members", headers=_headers(1000000))
    assert members.status_code == 404


@pytest.mark.asyncio
async def test_organization_invite_and_members_are_tenant_scoped(client, db_session):
    await _seed_account(db_session, 1000000, "Tenant A")
    await _seed_account(db_session, 2000000, "Tenant B")

    viewer_invite = await client.post(
        "/api/organization/1000000/invite",
        headers=_headers(1000000, "VIEWER"),
        json={"email": "viewer-invite@example.com", "role": "MEMBER"},
    )
    assert viewer_invite.status_code == 403

    cross_invite = await client.post(
        "/api/organization/2000000/invite",
        headers=_headers(1000000),
        json={"email": "cross@example.com", "role": "ADMIN"},
    )
    assert cross_invite.status_code == 404

    invited = await client.post(
        "/api/organization/1000000/invite",
        headers=_headers(1000000),
        json={"email": "analyst@example.com", "role": "AUDITOR"},
    )
    assert invited.status_code == 200
    invite_body = invited.json()
    user_id = invite_body["user_id"]
    assert invite_body.get("temporary_password")
    assert "INVITE_PENDING" not in str(invite_body.get("temporary_password"))

    login = await client.post(
        "/api/auth/login",
        json={"email": "analyst@example.com", "password": invite_body["temporary_password"]},
    )
    assert login.status_code == 200

    own_members = await client.get("/api/organization/1000000/members", headers=_headers(1000000))
    assert own_members.status_code == 200
    emails = {row["email"] for row in own_members.json()["members"]}
    assert "analyst@example.com" in emails

    other_members = await client.get("/api/organization/1000000/members", headers=_headers(2000000))
    assert other_members.status_code == 404

    cross_delete = await client.delete(
        f"/api/organization/1000000/members/{user_id}",
        headers=_headers(2000000),
    )
    assert cross_delete.status_code == 404


@pytest.mark.asyncio
async def test_organization_attention_is_tenant_scoped(client, db_session):
    await _seed_account(db_session, 1000000, "Tenant A")
    endpoint = APIEndpoint(
        id=str(uuid.uuid4()),
        account_id=1000000,
        method="GET",
        path="/payments",
        host="pay.example",
        access_type="PUBLIC",
        auth_types_found=[],
        is_sensitive=True,
        status="ACTIVE",
    )
    db_session.add(endpoint)
    db_session.add(
        Vulnerability(
            id=str(uuid.uuid4()),
            account_id=1000000,
            endpoint_id=endpoint.id,
            url="/payments",
            method="GET",
            severity="CRITICAL",
            type="Authorization anomaly",
            status="OPEN",
            confidence="HIGH",
            evidence={"observation": "scope mismatch on 4 accounts"},
        )
    )
    db_session.add(
        Vulnerability(
            id=str(uuid.uuid4()),
            account_id=2000000,
            url="/other",
            method="GET",
            severity="CRITICAL",
            type="Should not leak",
            status="OPEN",
            evidence={"secret": "nope"},
        )
    )
    await db_session.commit()

    own = await client.get("/api/organization/attention", headers=_headers(1000000))
    assert own.status_code == 200
    body = own.json()
    assert body["inventory"]["apis_discovered"] == 1
    assert body["inventory"]["internet_facing"] == 1
    assert body["inventory"]["unauthenticated"] == 1
    assert body["severity"]["critical"] == 1
    assert body["top_risks"][0]["title"] == "Authorization anomaly"
    assert body["top_risks"][0]["has_evidence"] is True
    assert body["risk_model"]["id"] == "open_finding_severity_v1"

    other = await client.get("/api/organization/attention", headers=_headers(2000000))
    assert other.status_code == 200
    leaked = other.json()
    assert leaked["inventory"]["apis_discovered"] == 0
    assert leaked["severity"]["critical"] == 1
    assert leaked["top_risks"][0]["title"] == "Should not leak"
    assert all(risk["title"] != "Authorization anomaly" for risk in leaked["top_risks"])
