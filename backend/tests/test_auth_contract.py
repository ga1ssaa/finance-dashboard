"""Offline auth policy and HTTP rejection checks; never opens a database."""
from datetime import timedelta
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from starlette.responses import Response

from app.auth import AuthRateLimiter, clear_refresh_cookie, cookie_options, password_matches, PASSWORD_HASHER, set_refresh_cookie, utcnow
from app.auth_schemas import Credentials
from app.config import Settings
from app.main import create_app

CSRF = {"Origin": "http://127.0.0.1:5173", "X-CSRF-Protection": "1"}


@pytest.fixture
def client(monkeypatch):
    engine = MagicMock()
    monkeypatch.setattr("app.main.create_database_engine", lambda _: engine)
    settings = Settings(_env_file=None, DATABASE_URL="postgresql+psycopg://test:unused@127.0.0.1:65432/unused")
    with TestClient(create_app(settings)) as value:
        yield value
    engine.connect.assert_not_called()


@pytest.mark.parametrize("path", ["register", "login", "refresh", "logout"])
@pytest.mark.parametrize("headers", [{}, {"Origin": "null", "X-CSRF-Protection": "1"}, {"Origin": "https://foreign.example", "X-CSRF-Protection": "1"}, {"Origin": "http://127.0.0.1:5173"}])
def test_auth_post_requires_allowed_origin_and_csrf_header(client, path, headers):
    response = client.post("/api/v1/auth/" + path, headers=headers, json={})
    assert response.status_code == 403
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["pragma"] == "no-cache"


@pytest.mark.parametrize("route", ["register", "login"])
def test_auth_credentials_require_json_and_sanitize_invalid_body(client, route):
    invalid = client.post("/api/v1/auth/" + route, headers=CSRF | {"Content-Type": "text/plain"}, content="synthetic secret password")
    assert invalid.status_code == 415
    secret = "Sensitive-invalid-password-marker"
    response = client.post("/api/v1/auth/" + route, headers=CSRF, json={"email": "invalid", "password": secret, "token": secret})
    assert response.status_code == 422
    assert secret not in response.text and '"input"' not in response.text
    for detail in response.json()["detail"]:
        assert set(detail) <= {"loc", "msg", "type"}


@pytest.mark.parametrize("password", ["x" * 14, "x" * 129, 123, "\ud800" * 15])
def test_password_policy_rejects_invalid_length_type_and_unicode(password):
    with pytest.raises(ValidationError):
        Credentials(email="valid@example.test", password=password)


def test_password_boundaries_unicode_and_whitespace_are_preserved():
    assert Credentials(email=" A@Example.Test ", password=" " + "x" * 14).password.get_secret_value() == " " + "x" * 14
    assert Credentials(email="valid@example.test", password="x" * 15).email == "valid@example.test"
    assert len(Credentials(email="valid@example.test", password="😀" * 128).password.get_secret_value().encode()) == 512


def test_argon2id_hash_is_salted_and_verifies_without_plaintext():
    password = "Synthetic-only-password-42!"
    first = PASSWORD_HASHER.hash(password)
    second = PASSWORD_HASHER.hash(password)
    assert first != second and first.startswith("$argon2id$v=19$m=65536,t=3,p=1$")
    assert password_matches(first, password)
    assert not password_matches(first, password + "wrong")


def test_cookie_secure_helper_and_deletion_keep_scope_and_http_only():
    assert cookie_options(True)["secure"] is True
    assert cookie_options(False)["secure"] is False
    response = Response()
    set_refresh_cookie(response, "synthetic-token", utcnow() + timedelta(days=30), production=True)
    cookie = response.headers["set-cookie"]
    assert "Secure" in cookie and "HttpOnly" in cookie and "SameSite=lax" in cookie
    assert "Path=/api/v1/auth" in cookie and "Domain=" not in cookie
    assert 0 < int(cookie.split("Max-Age=")[1].split(";")[0]) <= 604800
    cleared = Response()
    clear_refresh_cookie(cleared, production=True)
    assert "Max-Age=0" in cleared.headers["set-cookie"]
    assert "Path=/api/v1/auth" in cleared.headers["set-cookie"]
    assert "Secure" in cleared.headers["set-cookie"]


def test_limiter_window_and_bounded_cardinality_fail_closed(monkeypatch):
    now = [100.0]
    monkeypatch.setattr("app.auth.time.monotonic", lambda: now[0])
    limiter = AuthRateLimiter(max_keys=2)
    for _ in range(5):
        assert limiter.check([("email:A", 5, 60)]) is None
    assert limiter.check([("email:A", 5, 60)]) == 60
    assert limiter.check([("email:B", 5, 60)]) is None
    assert limiter.check([("email:C", 5, 60)]) == 60
    now[0] += 61
    assert limiter.check([("email:C", 5, 60)]) is None


def test_production_startup_fails_closed_without_distributed_limiter():
    configured = Settings(_env_file=None, DATABASE_URL="postgresql+psycopg://test:unused@127.0.0.1:65432/unused", APP_ENV="production")
    with pytest.raises(RuntimeError, match="distributed"):
        with TestClient(create_app(configured)):
            pass


def test_cross_site_rejections_cannot_consume_registration_quota(client):
    for _ in range(8):
        assert client.post("/api/v1/auth/register", headers={"Origin": "https://foreign.example", "X-CSRF-Protection": "1"}, json={}).status_code == 403
        assert client.post("/api/v1/auth/register", headers={"Origin": CSRF["Origin"]}, json={}).status_code == 403
    valid_origin_attempts = [client.post("/api/v1/auth/register", headers=CSRF, json={}) for _ in range(6)]
    assert [response.status_code for response in valid_origin_attempts[:5]] == [422] * 5
    assert valid_origin_attempts[5].status_code == 429
    assert int(valid_origin_attempts[5].headers["retry-after"]) > 0
