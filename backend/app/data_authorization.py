"""Purpose-separated ten-minute preview JWTs; never accepted as access tokens."""

from datetime import datetime, timezone
import hashlib
import hmac
from uuid import UUID, uuid4

import jwt

from app.data_operation_errors import DataOperationError, invalid_preview, session_invalid

PREVIEW_SECONDS = 600
PREVIEW_AUDIENCE = "finance-dashboard-data-preview"
EMPTY_DOCUMENT_SHA256 = hashlib.sha256(b"").hexdigest()


def utcnow():
    return datetime.now(timezone.utc)


def require_session_identity(user):
    if type(getattr(user, "session_id", None)) is not UUID:
        raise session_invalid()


def derive_preview_key(settings):
    return hmac.new(settings.auth_jwt_secret.get_secret_value().encode("utf-8"),
                    b"finance-dashboard:data-preview:v1", hashlib.sha256).digest()


def issue_preview_token(settings, user, kind, document_sha256, state_sha256, *, now=None):
    require_session_identity(user)
    timestamp = int((now or utcnow()).timestamp())
    claims = {"iss": "finance-dashboard", "aud": PREVIEW_AUDIENCE, "type": "data_preview",
              "sub": str(user.id), "sid": str(user.session_id), "owner_id": str(user.owner_id),
              "kind": kind, "document_sha256": document_sha256, "state_sha256": state_sha256,
              "iat": timestamp, "nbf": timestamp, "exp": timestamp + PREVIEW_SECONDS, "jti": str(uuid4())}
    token = jwt.encode(claims, derive_preview_key(settings), algorithm="HS256")
    return token, datetime.fromtimestamp(timestamp + PREVIEW_SECONDS, timezone.utc)


def validate_preview_token(settings, token, user, kind, document_sha256, *, state_sha256=None, now=None):
    require_session_identity(user)
    if type(token) is not str or not token or len(token) > 4096:
        raise invalid_preview()
    try:
        claims = jwt.decode(token, derive_preview_key(settings), algorithms=["HS256"],
                            issuer="finance-dashboard", audience=PREVIEW_AUDIENCE,
                            options={"require": ["iss", "aud", "type", "sub", "sid", "owner_id", "kind", "document_sha256", "state_sha256", "iat", "nbf", "exp", "jti"],
                                     "verify_exp": False, "verify_iat": False, "verify_nbf": False})
        if (claims["iss"] != "finance-dashboard" or claims["type"] != "data_preview" or claims["aud"] != PREVIEW_AUDIENCE
                or claims["sub"] != str(user.id) or claims["sid"] != str(user.session_id)
                or claims["owner_id"] != str(user.owner_id) or claims["kind"] != kind
                or kind not in {"import_replace", "reset"} or claims["document_sha256"] != document_sha256
                or any(type(claims[key]) is not int for key in ("iat", "nbf", "exp"))
                or claims["nbf"] != claims["iat"] or claims["exp"] != claims["iat"] + PREVIEW_SECONDS):
            raise ValueError()
        for key in ("sub", "sid", "owner_id", "jti"):
            if type(claims[key]) is not str or str(UUID(claims[key])) != claims[key]:
                raise ValueError()
        for key in ("document_sha256", "state_sha256"):
            if type(claims[key]) is not str or len(claims[key]) != 64 or any(char not in "0123456789abcdef" for char in claims[key]):
                raise ValueError()
        timestamp = int((now or utcnow()).timestamp())
        if claims["iat"] > timestamp:
            raise ValueError()
        if timestamp >= claims["exp"]:
            raise DataOperationError(409, "PREVIEW_EXPIRED", "Preview authorization has expired")
        if state_sha256 is not None and not hmac.compare_digest(claims["state_sha256"], state_sha256):
            raise DataOperationError(409, "STATE_CHANGED", "Financial data changed; request a new preview")
        return claims
    except DataOperationError:
        raise
    except (jwt.PyJWTError, ValueError, TypeError, KeyError, AttributeError):
        raise invalid_preview() from None
