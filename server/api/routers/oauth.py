"""OAuth2 SSO endpoints - GitHub OAuth flow plus provider management."""

import logging
import secrets
import uuid
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from server.models.core import OAuthProvider, User
from server.modules.auth.jwt_issuer import JWTIssuer
from server.modules.auth.oauth_secrets import OAuthProviderSecretCodec
from server.modules.auth.oauth_github import GitHubOAuth
from server.modules.auth.oauth_oidc import GenericOIDC, OIDCDiscoveryError
from server.modules.auth.oauth_saml import (
    SAMLNotAvailableError,
    SAMLProvider,
    build_saml_request_data,
    build_saml_settings,
)
from server.modules.auth.rbac import require_admin
from server.modules.persistence.database import get_db

router = APIRouter(tags=["OAuth SSO"])
logger = logging.getLogger(__name__)

_STATE_TTL = 600
_oauth_states_fallback: dict = {}
_redis_client = None


def _get_redis():
    global _redis_client
    if _redis_client is not None:
        return _redis_client
    try:
        from server.config import settings

        if settings.REDIS_URL:
            import redis.asyncio as aioredis

            _redis_client = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
            return _redis_client
    except Exception as exc:
        logger.warning("Redis unavailable for OAuth state store, using in-memory fallback: %s", exc)
    return None


async def _state_set(state: str, account_id: int) -> None:
    redis_client = _get_redis()
    if redis_client:
        try:
            await redis_client.setex(f"oauth_state:{state}", _STATE_TTL, str(account_id))
            return
        except Exception:
            pass
    _oauth_states_fallback[state] = account_id


async def _state_pop(state: str) -> Optional[int]:
    redis_client = _get_redis()
    if redis_client:
        try:
            value = await redis_client.getdel(f"oauth_state:{state}")
            if value is not None:
                return int(value)
        except Exception:
            pass
    return _oauth_states_fallback.pop(state, None)


def _redirect_base() -> str:
    try:
        from server.config import settings

        return settings.OAUTH_REDIRECT_BASE_URL
    except Exception:
        return "http://localhost:8000"


def _make_github_oauth(provider: OAuthProvider) -> GitHubOAuth:
    base = _redirect_base()
    return GitHubOAuth(
        client_id=provider.client_id or "",
        client_secret=OAuthProviderSecretCodec.client_secret(provider),
        redirect_uri=f"{base}/api/oauth/github/callback",
    )


def _make_oidc(provider: OAuthProvider) -> GenericOIDC:
    base = _redirect_base()
    cfg = provider.config or {}
    return GenericOIDC(
        issuer=cfg.get("issuer", ""),
        client_id=provider.client_id or "",
        client_secret=OAuthProviderSecretCodec.client_secret(provider),
        redirect_uri=f"{base}/api/oauth/oidc/callback",
        scopes=provider.scopes or None,
    )


async def _upsert_sso_user(db: AsyncSession, account_id: int, email: str, default_role: str = "MEMBER") -> User:
    """Find-or-create the SSO user *within this tenant only*.

    User.email is globally unique, so a naive email-only lookup here would
    let an IdP login for tenant B silently reuse an existing user row that
    actually belongs to tenant A — issuing a JWT with account_id=B against a
    user record that lives under account A. Scope the lookup to this
    account_id, and reject (rather than cross-link) when the email is
    already taken by a different tenant.
    """
    result = await db.execute(
        select(User).where(User.account_id == account_id, User.email == email)
    )
    user = result.scalar_one_or_none()
    if user:
        return user

    existing_elsewhere = await db.execute(select(User).where(User.email == email))
    if existing_elsewhere.scalar_one_or_none():
        raise HTTPException(
            409,
            f"Email '{email}' is already registered under a different account",
        )

    user = User(
        id=str(uuid.uuid4()),
        account_id=account_id,
        email=email,
        password_hash="sso",
        role=default_role,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@router.get("/providers")
async def list_providers(
    payload: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    account_id = payload["account_id"]
    result = await db.execute(select(OAuthProvider).where(OAuthProvider.account_id == account_id))
    providers = result.scalars().all()
    return {
        "providers": [
            {
                "id": provider.id,
                "provider": provider.provider,
                "enabled": provider.enabled,
                "allowed_domains": provider.allowed_domains,
                "created_at": provider.created_at,
            }
            for provider in providers
        ]
    }


SUPPORTED_PROVIDERS = {"github", "oidc", "saml"}


@router.post("/providers")
async def create_provider(
    provider: str = Body(..., description="github | oidc | saml"),
    client_id: str = Body(default=""),
    client_secret: str = Body(default=""),
    allowed_domains: list = Body(default=[]),
    scopes: list = Body(default=[]),
    config: dict = Body(
        default={},
        description=(
            'oidc: {"issuer": "https://idp.example.com"}. '
            'saml: {"idp_entity_id", "idp_sso_url", "idp_x509_cert", "sp_entity_id"?}'
        ),
    ),
    payload: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Register an OAuth/OIDC/SAML provider with encrypted client secret storage."""
    if provider not in SUPPORTED_PROVIDERS:
        raise HTTPException(400, f"Unsupported provider. Supported: {sorted(SUPPORTED_PROVIDERS)}")
    if provider == "oidc" and not (config or {}).get("issuer"):
        raise HTTPException(400, "oidc provider requires config.issuer")
    if provider == "saml":
        missing = [k for k in ("idp_entity_id", "idp_sso_url", "idp_x509_cert") if not (config or {}).get(k)]
        if missing:
            raise HTTPException(400, f"saml provider requires config.{missing[0]}")

    account_id = payload["account_id"]
    provider_row = OAuthProvider(
        id=str(uuid.uuid4()),
        account_id=account_id,
        provider=provider,
        client_id=client_id,
        client_secret_enc=OAuthProviderSecretCodec.encrypt_secret(client_secret),
        allowed_domains=allowed_domains,
        scopes=scopes,
        config=config or {},
    )
    db.add(provider_row)
    await db.commit()
    return {"id": provider_row.id, "provider": provider, "status": "created"}


@router.delete("/providers/{provider_id}")
async def delete_provider(
    provider_id: str,
    payload: dict = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    account_id = payload["account_id"]
    result = await db.execute(
        select(OAuthProvider).where(
            OAuthProvider.id == provider_id,
            OAuthProvider.account_id == account_id,
        )
    )
    provider = result.scalar_one_or_none()
    if not provider:
        raise HTTPException(404, "Provider not found")
    await db.delete(provider)
    await db.commit()
    return {"deleted": provider_id}


@router.get("/github/authorize")
async def github_authorize(
    account_id: int = Query(..., ge=1),
    db: AsyncSession = Depends(get_db),
):
    """Step 1: Return the GitHub authorization URL for a specific account."""
    result = await db.execute(
        select(OAuthProvider).where(
            OAuthProvider.account_id == account_id,
            OAuthProvider.provider == "github",
            OAuthProvider.enabled == True,
        )
    )
    provider = result.scalar_one_or_none()
    if not provider:
        raise HTTPException(404, "GitHub OAuth provider not configured for this account")
    state = secrets.token_urlsafe(16)
    await _state_set(state, account_id)
    oauth = _make_github_oauth(provider)
    return {"authorization_url": oauth.get_authorization_url(state=state), "state": state}


@router.get("/github/callback")
async def github_callback(
    code: str = Query(...),
    state: str = Query(""),
    db: AsyncSession = Depends(get_db),
):
    """Step 2: Exchange code for token, upsert user, return JWT."""
    account_id = await _state_pop(state)
    if account_id is None:
        raise HTTPException(400, "OAuth state is missing or expired")

    result = await db.execute(
        select(OAuthProvider).where(
            OAuthProvider.account_id == account_id,
            OAuthProvider.provider == "github",
        )
    )
    provider = result.scalar_one_or_none()
    if not provider:
        raise HTTPException(400, "GitHub OAuth not configured")

    oauth = _make_github_oauth(provider)
    access_token = await oauth.exchange_code_for_token(code)
    if not access_token:
        raise HTTPException(400, "Failed to exchange OAuth code for token")

    user_info = await oauth.get_user_info(access_token)
    if not user_info or not user_info.get("email"):
        raise HTTPException(400, "Could not retrieve user email from GitHub")

    email = user_info["email"]
    if provider.allowed_domains:
        domain = email.split("@")[-1]
        if domain not in provider.allowed_domains:
            raise HTTPException(403, f"Email domain '{domain}' is not allowed")

    user_result = await db.execute(select(User).where(User.email == email))
    user = user_result.scalar_one_or_none()
    if not user:
        user = User(
            id=str(uuid.uuid4()),
            account_id=account_id,
            email=email,
            password_hash="oauth_github",
            role="MEMBER",
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)

    token = JWTIssuer.create_access_token(
        {
            "sub": user.id,
            "email": email,
            "role": user.role,
            "account_id": account_id,
        }
    )
    return {
        "access_token": token,
        "token_type": "bearer",
        "email": email,
        "provider": "github",
        "name": user_info.get("name"),
    }


# ── Generic OIDC (Okta, Azure AD, Google Workspace, or any OIDC-compliant IdP) ──

@router.get("/oidc/authorize")
async def oidc_authorize(
    account_id: int = Query(..., ge=1),
    db: AsyncSession = Depends(get_db),
):
    """Step 1: Return the IdP authorization URL for a specific account."""
    result = await db.execute(
        select(OAuthProvider).where(
            OAuthProvider.account_id == account_id,
            OAuthProvider.provider == "oidc",
            OAuthProvider.enabled == True,
        )
    )
    provider = result.scalar_one_or_none()
    if not provider:
        raise HTTPException(404, "OIDC provider not configured for this account")
    state = secrets.token_urlsafe(16)
    await _state_set(state, account_id)
    oidc = _make_oidc(provider)
    try:
        authorization_url = await oidc.get_authorization_url(state=state)
    except OIDCDiscoveryError as exc:
        raise HTTPException(502, str(exc))
    return {"authorization_url": authorization_url, "state": state}


@router.get("/oidc/callback")
async def oidc_callback(
    code: str = Query(...),
    state: str = Query(""),
    db: AsyncSession = Depends(get_db),
):
    """Step 2: Exchange code for token, upsert user, return JWT."""
    account_id = await _state_pop(state)
    if account_id is None:
        raise HTTPException(400, "OAuth state is missing or expired")

    result = await db.execute(
        select(OAuthProvider).where(
            OAuthProvider.account_id == account_id,
            OAuthProvider.provider == "oidc",
        )
    )
    provider = result.scalar_one_or_none()
    if not provider:
        raise HTTPException(400, "OIDC not configured")

    oidc = _make_oidc(provider)
    access_token = await oidc.exchange_code_for_token(code)
    if not access_token:
        raise HTTPException(400, "Failed to exchange OIDC code for token")

    user_info = await oidc.get_user_info(access_token)
    if not user_info or not user_info.get("email"):
        raise HTTPException(400, "Could not retrieve user email from identity provider")

    email = user_info["email"]
    if provider.allowed_domains:
        domain = email.split("@")[-1]
        if domain not in provider.allowed_domains:
            raise HTTPException(403, f"Email domain '{domain}' is not allowed")

    user = await _upsert_sso_user(db, account_id, email)
    token = JWTIssuer.create_access_token(
        {"sub": user.id, "email": email, "role": user.role, "account_id": account_id}
    )
    return {
        "access_token": token,
        "token_type": "bearer",
        "email": email,
        "provider": "oidc",
        "name": user_info.get("name"),
    }


# ── Generic SAML 2.0 (any SAML IdP: Okta, Azure AD, OneLogin, PingFederate, …) ──

async def _make_saml(request: Request, provider: OAuthProvider, post_data: Optional[dict] = None) -> SAMLProvider:
    base = _redirect_base()
    cfg = provider.config or {}
    acs_url = f"{base}/api/oauth/saml/{provider.account_id}/acs"
    settings = build_saml_settings(
        sp_entity_id=cfg.get("sp_entity_id") or f"{base}/api/oauth/saml/{provider.account_id}/metadata",
        acs_url=acs_url,
        idp_entity_id=cfg["idp_entity_id"],
        idp_sso_url=cfg["idp_sso_url"],
        idp_x509_cert=cfg["idp_x509_cert"],
    )
    request_data = await build_saml_request_data(request, post_data=post_data)
    return SAMLProvider(request_data, settings)


async def _get_saml_provider(db: AsyncSession, account_id: int) -> OAuthProvider:
    result = await db.execute(
        select(OAuthProvider).where(
            OAuthProvider.account_id == account_id,
            OAuthProvider.provider == "saml",
        )
    )
    provider = result.scalar_one_or_none()
    if not provider:
        raise HTTPException(404, "SAML provider not configured for this account")
    return provider


@router.get("/saml/{account_id}/login")
async def saml_login(
    account_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Step 1: Return the IdP SSO URL to redirect the user's browser to."""
    provider = await _get_saml_provider(db, account_id)
    if not provider.enabled:
        raise HTTPException(404, "SAML provider not configured for this account")
    try:
        saml = await _make_saml(request, provider)
    except SAMLNotAvailableError as exc:
        raise HTTPException(501, str(exc))
    return {"login_url": saml.login_url()}


@router.post("/saml/{account_id}/acs")
async def saml_acs(
    account_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Assertion Consumer Service — the IdP's browser-POST target after the user
    authenticates. Validates the SAML response (signature, audience, expiry —
    all handled by python3-saml) and returns a JWT.

    Note: a production frontend would typically have this endpoint redirect to
    a frontend callback URL with a short-lived one-time code rather than
    returning the JWT directly in the POST response body; this keeps parity
    with this codebase's existing OAuth callback contracts (see
    github_callback / oidc_callback above), which also return the token
    directly to the caller.
    """
    provider = await _get_saml_provider(db, account_id)
    form = await request.form()
    post_data = {key: value for key, value in form.items()}

    try:
        saml = await _make_saml(request, provider, post_data=post_data)
    except SAMLNotAvailableError as exc:
        raise HTTPException(501, str(exc))

    saml.process_response()
    if saml.errors:
        raise HTTPException(400, f"SAML validation failed: {saml.last_error_reason or saml.errors}")
    if not saml.is_authenticated():
        raise HTTPException(401, "SAML authentication failed")

    email = saml.get_email()
    if not email:
        raise HTTPException(400, "Could not determine email from SAML assertion")
    if provider.allowed_domains:
        domain = email.split("@")[-1]
        if domain not in provider.allowed_domains:
            raise HTTPException(403, f"Email domain '{domain}' is not allowed")

    user = await _upsert_sso_user(db, account_id, email)
    token = JWTIssuer.create_access_token(
        {"sub": user.id, "email": email, "role": user.role, "account_id": account_id}
    )
    return {
        "access_token": token,
        "token_type": "bearer",
        "email": email,
        "provider": "saml",
    }
