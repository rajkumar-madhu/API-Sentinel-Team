"""Admin flows behind the SSO and Custom Roles settings pages."""

from sqlalchemy import select

from server.models.core import User


async def _create_role(client, auth_headers, name="COMPLIANCE_REVIEWER"):
    resp = await client.post(
        "/api/custom-roles/",
        json={"name": name, "permissions": ["endpoints:read"], "description": "test"},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


async def test_custom_role_can_be_assigned_on_invite(client, auth_headers):
    await _create_role(client, auth_headers)

    resp = await client.post(
        "/api/auth/users/invite",
        json={"email": "reviewer@example.com", "role": "compliance_reviewer"},
        headers=auth_headers,
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["role"] == "COMPLIANCE_REVIEWER"


async def test_unknown_role_rejected_on_invite(client, auth_headers):
    resp = await client.post(
        "/api/auth/users/invite",
        json={"email": "nobody@example.com", "role": "NOT_A_ROLE"},
        headers=auth_headers,
    )

    assert resp.status_code == 400


async def test_role_update_accepts_ui_payload_and_custom_role(client, auth_headers):
    await _create_role(client, auth_headers)
    invite = await client.post(
        "/api/auth/users/invite",
        json={"email": "dev@example.com", "role": "DEVELOPER"},
        headers=auth_headers,
    )
    user_id = invite.json()["user_id"]

    resp = await client.patch(
        f"/api/auth/users/{user_id}/role",
        json={"role": "COMPLIANCE_REVIEWER"},
        headers=auth_headers,
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["role"] == "COMPLIANCE_REVIEWER"


async def test_custom_role_from_other_account_not_assignable(client, auth_headers, db_session):
    from server.models.core import CustomRole

    db_session.add(CustomRole(id="other-role", account_id=42, name="FOREIGN_ROLE", permissions=["endpoints:read"]))
    await db_session.commit()

    resp = await client.post(
        "/api/auth/users/invite",
        json={"email": "x@example.com", "role": "FOREIGN_ROLE"},
        headers=auth_headers,
    )

    assert resp.status_code == 400


async def test_delete_in_use_custom_role_is_blocked(client, auth_headers, db_session):
    role = await _create_role(client, auth_headers)
    invite = await client.post(
        "/api/auth/users/invite",
        json={"email": "held@example.com", "role": role["name"]},
        headers=auth_headers,
    )
    assert invite.status_code == 200

    blocked = await client.delete(f"/api/custom-roles/{role['id']}", headers=auth_headers)
    assert blocked.status_code == 409

    user = await db_session.scalar(select(User).where(User.email == "held@example.com"))
    user.role = "VIEWER"
    await db_session.commit()

    freed = await client.delete(f"/api/custom-roles/{role['id']}", headers=auth_headers)
    assert freed.status_code == 200


async def test_sso_setup_info_lists_idp_urls(client, auth_headers, account_id):
    resp = await client.get("/api/oauth/providers/setup-info", headers=auth_headers)

    assert resp.status_code == 200
    body = resp.json()
    assert body["account_id"] == account_id
    assert body["urls"]["oidc"]["callback_url"].endswith("/api/oauth/oidc/callback")
    assert body["urls"]["saml"]["acs_url"].endswith(f"/api/oauth/saml/{account_id}/acs")
    assert body["login"]["saml"] == f"/api/oauth/saml/{account_id}/login"


async def test_sso_provider_lifecycle(client, auth_headers):
    create = await client.post(
        "/api/oauth/providers",
        json={
            "provider": "oidc",
            "client_id": "cid",
            "client_secret": "shh",
            "allowed_domains": ["example.com"],
            "config": {"issuer": "https://idp.example.com"},
        },
        headers=auth_headers,
    )
    assert create.status_code == 200, create.text
    provider_id = create.json()["id"]

    duplicate = await client.post(
        "/api/oauth/providers",
        json={"provider": "oidc", "config": {"issuer": "https://other.example.com"}},
        headers=auth_headers,
    )
    assert duplicate.status_code == 409

    listed = (await client.get("/api/oauth/providers", headers=auth_headers)).json()["providers"]
    assert len(listed) == 1
    assert listed[0]["has_client_secret"] is True
    assert "client_secret" not in listed[0]
    assert listed[0]["setup"]["callback_url"].endswith("/api/oauth/oidc/callback")

    disabled = await client.patch(
        f"/api/oauth/providers/{provider_id}", json={"enabled": False}, headers=auth_headers
    )
    assert disabled.status_code == 200
    listed = (await client.get("/api/oauth/providers", headers=auth_headers)).json()["providers"]
    assert listed[0]["enabled"] is False

    deleted = await client.delete(f"/api/oauth/providers/{provider_id}", headers=auth_headers)
    assert deleted.status_code == 200


async def test_guest_is_reserved_role_name(client, auth_headers):
    resp = await client.post(
        "/api/custom-roles/",
        json={"name": "guest", "permissions": ["endpoints:read"]},
        headers=auth_headers,
    )

    assert resp.status_code == 400
