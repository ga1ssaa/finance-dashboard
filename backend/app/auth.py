"""Cryptography, access-token verification and bounded local auth protection."""

from collections import OrderedDict, deque
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
import math
import secrets
import threading
import time
from typing import Annotated
from uuid import UUID, uuid4

from argon2 import PasswordHasher, Type
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import Depends, HTTPException, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
import jwt
from sqlalchemy import select
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from app.auth_schemas import normalized_email
from app.models import AuthSession, User


ACCESS_SECONDS = 300
REFRESH_SECONDS = 7 * 24 * 60 * 60
COOKIE_NAME = "fd_refresh"
COOKIE_PATH = "/api/v1/auth"
ISSUER = "finance-dashboard"
AUDIENCE = "finance-dashboard-web"
PASSWORD_HASHER = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=1, hash_len=32, salt_len=16, type=Type.ID)
DUMMY_PASSWORD_HASH = PASSWORD_HASHER.hash(secrets.token_urlsafe(32))
bearer = HTTPBearer(auto_error=False)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def unauthorized() -> HTTPException:
    return HTTPException(status_code=401, detail="Authentication required", headers={"WWW-Authenticate": "Bearer"})


def password_matches(encoded: str, password: str) -> bool:
    try:
        return PASSWORD_HASHER.verify(encoded, password)
    except (VerificationError, InvalidHashError):
        return False


def token_hash(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def valid_refresh_cookie(raw_token: str | None) -> bool:
    return isinstance(raw_token, str) and len(raw_token) == 43 and all(
        char in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_" for char in raw_token
    )


def issue_access_token(settings, user_id: UUID, session_id: UUID, now: datetime | None = None) -> str:
    now = now or utcnow()
    timestamp = int(now.timestamp())
    return jwt.encode({
        "sub": str(user_id), "sid": str(session_id), "jti": str(uuid4()),
        "iat": timestamp, "nbf": timestamp, "exp": timestamp + ACCESS_SECONDS,
        "type": "access", "iss": ISSUER, "aud": AUDIENCE,
    }, settings.auth_jwt_secret.get_secret_value(), algorithm="HS256")


@dataclass(frozen=True)
class AuthenticatedUser:
    id: UUID
    email: str
    owner_id: UUID
    session_id: UUID | None = None


def get_current_user(request: Request, credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]) -> AuthenticatedUser:
    if credentials is None or len(credentials.credentials) > 4096:
        raise unauthorized()
    try:
        claims = jwt.decode(
            credentials.credentials, request.app.state.settings.auth_jwt_secret.get_secret_value(),
            algorithms=["HS256"], issuer=ISSUER, audience=AUDIENCE, leeway=5,
            options={"require": ["sub", "sid", "jti", "iat", "nbf", "exp", "type", "iss", "aud"]},
        )
        if claims["type"] != "access" or any(type(claims[key]) is not int for key in ("iat", "nbf", "exp")):
            raise ValueError("Invalid claims")
        user_id, session_id = UUID(claims["sub"]), UUID(claims["sid"])
        UUID(claims["jti"])
    except (jwt.PyJWTError, ValueError, TypeError, AttributeError):
        raise unauthorized() from None
    # Deliberately separate, short-lived read session: finance routes retain
    # ownership of their request session's explicit transaction boundary.
    with request.app.state.session_factory() as session:
        user = session.scalar(select(User).join(AuthSession, AuthSession.user_id == User.id).where(
            User.id == user_id, AuthSession.id == session_id,
            AuthSession.revoked_at.is_(None), AuthSession.expires_at > utcnow(),
        ))
        if user is None:
            raise unauthorized()
        return AuthenticatedUser(id=user.id, email=user.email, owner_id=user.owner_id, session_id=session_id)


def cookie_options(production: bool) -> dict:
    return {"key": COOKIE_NAME, "path": COOKIE_PATH, "httponly": True,
            "secure": production, "samesite": "lax"}


def set_refresh_cookie(response: Response, raw_token: str, expires_at: datetime, production: bool) -> None:
    max_age = max(0, min(REFRESH_SECONDS, math.floor((expires_at - utcnow()).total_seconds())))
    response.set_cookie(value=raw_token, max_age=max_age, expires=expires_at, **cookie_options(production))


def clear_refresh_cookie(response: Response, production: bool) -> None:
    response.delete_cookie(**cookie_options(production))


class AuthRateLimiter:
    """Bounded, process-local limits. Production startup is explicitly blocked."""

    def __init__(self, max_keys: int = 10000):
        self.max_keys = max_keys
        self._buckets: OrderedDict[str, tuple[deque[float], int]] = OrderedDict()
        self._lock = threading.Lock()

    def check(self, rules: list[tuple[str, int, int]]) -> int | None:
        now = time.monotonic()
        retry = 0
        with self._lock:
            for key in list(self._buckets):
                values, window = self._buckets[key]
                while values and values[0] <= now - window:
                    values.popleft()
                if not values:
                    del self._buckets[key]
            for key, limit, window in rules:
                bucket = self._buckets.get(key)
                if bucket is None:
                    if len(self._buckets) >= self.max_keys:
                        # Fail closed instead of evicting active limits.
                        retry = max(retry, 60)
                        continue
                    bucket = (deque(), window)
                    self._buckets[key] = bucket
                values, _ = bucket
                if len(values) >= limit:
                    retry = max(retry, max(1, math.ceil(values[0] + window - now)))
                else:
                    values.append(now)
        return retry or None


class AuthProtectionMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if not request.url.path.startswith("/api/v1/auth/"):
            return await call_next(request)
        response = None
        if request.method == "POST":
            settings = request.app.state.settings
            if request.headers.get("origin") not in settings.cors_allowed_origins or request.headers.get("x-csrf-protection") != "1":
                # Reject cross-site requests before body parsing or quota use;
                # a hostile page must not consume a local user's auth limits.
                return JSONResponse(status_code=403, content={"detail": "Request origin or CSRF protection is invalid"},
                                    headers={"Cache-Control": "no-store", "Pragma": "no-cache"})
            action = request.url.path.rsplit("/", 1)[-1]
            ip = request.client.host if request.client else "unknown"
            rules = []
            if action == "login":
                rules.append((f"login:ip:{ip}", 20, 60))
            elif action == "register":
                rules.append((f"register:ip:{ip}", 5, 3600))
            elif action in {"refresh", "logout"}:
                rules.append((f"{action}:ip:{ip}", 30, 60))
            # Read a bounded body before framework validation so malformed JSON
            # and invalid credentials also count against the attempt limit.
            data = bytearray()
            too_large = False
            async for chunk in request.stream():
                data.extend(chunk)
                if len(data) > 8192:
                    too_large = True
                    break
            if not too_large:
                request._body = bytes(data)
                if action == "login":
                    try:
                        body = json.loads(data)
                        email = normalized_email(body.get("email")) if isinstance(body, dict) else None
                    except (ValueError, TypeError, UnicodeDecodeError):
                        email = None
                    if email:
                        rules.append(("login:email:" + token_hash(email), 5, 60))
            retry = request.app.state.auth_rate_limiter.check(rules)
            if retry:
                response = JSONResponse(status_code=429, content={"detail": "Too many authentication attempts"}, headers={"Retry-After": str(retry)})
            elif too_large:
                response = JSONResponse(status_code=422, content={"detail": "Invalid authentication request"})
            elif action in {"register", "login"} and request.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "application/json":
                response = JSONResponse(status_code=415, content={"detail": "Content-Type must be application/json"})
        response = response if response is not None else await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["Pragma"] = "no-cache"
        return response
