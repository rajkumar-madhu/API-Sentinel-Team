"""Generic OpenID Connect SSO (Okta, Azure AD, Google Workspace, or any
standards-compliant IdP), using OIDC discovery + the authorization code flow.

This is the authorization-code + userinfo-endpoint profile: it does not
verify the ID token's signature locally, matching the trust model the rest
of this codebase already uses for GitHub OAuth (server/modules/auth/oauth_github.py)
— the access token is only ever used server-side, over TLS, to call the
IdP's own userinfo endpoint, so a forged/unsigned ID token cannot be used to
impersonate a user.
"""
import logging
from typing import Any, Dict, Optional

import httpx

logger = logging.getLogger(__name__)


class OIDCDiscoveryError(Exception):
    pass


class GenericOIDC:
    """
    1. discover() → fetch authorization_endpoint / token_endpoint / userinfo_endpoint
    2. get_authorization_url(state) → redirect user
    3. exchange_code_for_token(code) → access_token
    4. get_user_info(access_token) → user profile
    """

    def __init__(self, issuer: str, client_id: str, client_secret: str, redirect_uri: str, scopes: Optional[list] = None):
        self.issuer = issuer.rstrip("/")
        self.client_id = client_id
        self.client_secret = client_secret
        self.redirect_uri = redirect_uri
        self.scopes = scopes or ["openid", "email", "profile"]
        self._discovery: Optional[Dict[str, Any]] = None

    async def discover(self) -> Dict[str, Any]:
        if self._discovery is not None:
            return self._discovery
        url = f"{self.issuer}/.well-known/openid-configuration"
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(url)
                resp.raise_for_status()
                self._discovery = resp.json()
                return self._discovery
        except Exception as exc:
            raise OIDCDiscoveryError(f"OIDC discovery failed for {self.issuer}: {exc}") from exc

    async def get_authorization_url(self, state: str = "") -> str:
        discovery = await self.discover()
        scope = "%20".join(self.scopes)
        params = (
            f"response_type=code&client_id={self.client_id}"
            f"&redirect_uri={self.redirect_uri}&scope={scope}&state={state}"
        )
        return f"{discovery['authorization_endpoint']}?{params}"

    async def exchange_code_for_token(self, code: str) -> Optional[str]:
        discovery = await self.discover()
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.post(
                    discovery["token_endpoint"],
                    data={
                        "grant_type": "authorization_code",
                        "code": code,
                        "redirect_uri": self.redirect_uri,
                        "client_id": self.client_id,
                        "client_secret": self.client_secret,
                    },
                    headers={"Accept": "application/json"},
                )
                resp.raise_for_status()
                return resp.json().get("access_token")
        except Exception as exc:
            logger.error(f"OIDC token exchange failed ({self.issuer}): {exc}")
            return None

    async def get_user_info(self, access_token: str) -> Optional[Dict[str, Any]]:
        discovery = await self.discover()
        headers = {"Authorization": f"Bearer {access_token}", "Accept": "application/json"}
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.get(discovery["userinfo_endpoint"], headers=headers)
                resp.raise_for_status()
                claims = resp.json()
                return {
                    "provider": "oidc",
                    "provider_id": claims.get("sub"),
                    "email": claims.get("email"),
                    "name": claims.get("name") or claims.get("preferred_username"),
                }
        except Exception as exc:
            logger.error(f"OIDC get_user_info failed ({self.issuer}): {exc}")
            return None
