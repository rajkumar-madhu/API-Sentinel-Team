"""Generic SAML 2.0 SSO, built on the OneLogin python3-saml toolkit.

python3-saml does the security-critical work (XML signature verification,
canonicalization, replay/expiry checks) — this module only adapts our
FastAPI Request/OAuthProvider config into the shapes that library expects.
Do not hand-roll SAML XML parsing or signature checks outside this module.
"""
import logging
from typing import Any, Dict, Optional

from fastapi import Request

logger = logging.getLogger(__name__)

try:
    from onelogin.saml2.auth import OneLogin_Saml2_Auth
    SAML_AVAILABLE = True
except ImportError:  # python3-saml (and its xmlsec system dependency) not installed
    OneLogin_Saml2_Auth = None  # type: ignore
    SAML_AVAILABLE = False


class SAMLNotAvailableError(Exception):
    """Raised when python3-saml (or its xmlsec native dependency) isn't installed."""


async def build_saml_request_data(request: Request, post_data: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Adapt a FastAPI Request into the request dict OneLogin_Saml2_Auth expects."""
    query_params = dict(request.query_params)
    return {
        "https": "on" if request.url.scheme == "https" else "off",
        "http_host": request.headers.get("host", request.url.hostname or ""),
        "server_port": str(request.url.port or (443 if request.url.scheme == "https" else 80)),
        "script_name": request.url.path,
        "get_data": query_params,
        "post_data": post_data or {},
    }


def build_saml_settings(
    *,
    sp_entity_id: str,
    acs_url: str,
    idp_entity_id: str,
    idp_sso_url: str,
    idp_x509_cert: str,
) -> Dict[str, Any]:
    return {
        "strict": True,
        "debug": False,
        "sp": {
            "entityId": sp_entity_id,
            "assertionConsumerService": {
                "url": acs_url,
                "binding": "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST",
            },
            "NameIDFormat": "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
        },
        "idp": {
            "entityId": idp_entity_id,
            "singleSignOnService": {
                "url": idp_sso_url,
                "binding": "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect",
            },
            "x509cert": idp_x509_cert,
        },
    }


class SAMLProvider:
    def __init__(self, request_data: Dict[str, Any], settings: Dict[str, Any]):
        if not SAML_AVAILABLE:
            raise SAMLNotAvailableError(
                "python3-saml is not installed. Add it (and the xmlsec1 system package) "
                "to run SAML SSO — see requirements.txt."
            )
        self._auth = OneLogin_Saml2_Auth(request_data, settings)

    def login_url(self) -> str:
        """Returns the IdP SSO URL to redirect the user's browser to."""
        return self._auth.login()

    def process_response(self) -> None:
        self._auth.process_response()

    @property
    def errors(self) -> list:
        return self._auth.get_errors()

    @property
    def last_error_reason(self) -> Optional[str]:
        return self._auth.get_last_error_reason()

    def is_authenticated(self) -> bool:
        return self._auth.is_authenticated()

    def get_nameid(self) -> Optional[str]:
        return self._auth.get_nameid()

    def get_attributes(self) -> Dict[str, Any]:
        return self._auth.get_attributes() or {}

    def get_email(self) -> Optional[str]:
        """NameID is configured as the emailAddress format; fall back to a
        common SAML email attribute name if an IdP sends it as an attribute
        instead."""
        nameid = self.get_nameid()
        if nameid and "@" in nameid:
            return nameid
        attrs = self.get_attributes()
        for key in ("email", "emailAddress", "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"):
            values = attrs.get(key)
            if values:
                return values[0] if isinstance(values, list) else values
        return None
