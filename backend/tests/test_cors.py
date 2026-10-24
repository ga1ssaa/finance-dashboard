"""Local browser CORS policy; no database connection is required."""

from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.config import Settings
from app.main import create_app


def configured_settings(**overrides):
    return Settings(
        _env_file=None,
        DATABASE_URL="postgresql+psycopg://local:unused@127.0.0.1:65432/unused",
        SINGLE_OWNER_ID="78d61a5b-4979-41ed-b602-9441c8c1bdb3",
        **overrides,
    )


@pytest.fixture
def engine(monkeypatch):
    engine = MagicMock()
    monkeypatch.setattr("app.main.create_database_engine", lambda settings: engine)
    monkeypatch.delenv("CORS_ALLOWED_ORIGINS", raising=False)
    return engine


@pytest.mark.parametrize("origin", ["http://localhost:5173", "http://127.0.0.1:5173"])
def test_default_local_origin_preflight_and_response(origin, engine):
    with TestClient(create_app(configured_settings())) as client:
        preflight = client.options("/api/v1/transactions", headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type, authorization, x-csrf-protection",
        })
        assert preflight.status_code == 200
        assert preflight.headers["access-control-allow-origin"] == origin
        assert set(preflight.headers["access-control-allow-methods"].split(", ")) == {"GET", "POST", "PATCH", "DELETE"}
        assert preflight.headers["access-control-allow-credentials"] == "true"
        response = client.get("/api/v1/health", headers={"Origin": origin})
        assert response.json() == {"status": "ok"}
        assert response.headers["access-control-allow-origin"] == origin
        assert "Origin" in response.headers["vary"]
        assert response.headers["access-control-allow-credentials"] == "true"
        engine.connect.assert_not_called()


@pytest.mark.parametrize("origin", [
    "https://example.com", "http://localhost:5174", "http://localhost.evil:5173", "null",
])
def test_unconfigured_origins_receive_no_cors_access(origin, engine):
    with TestClient(create_app(configured_settings())) as client:
        preflight = client.options("/api/v1/transactions", headers={
            "Origin": origin, "Access-Control-Request-Method": "POST",
        })
        assert preflight.status_code == 400
        assert "access-control-allow-origin" not in preflight.headers
        response = client.get("/api/v1/health", headers={"Origin": origin})
        assert response.status_code == 200
        assert "access-control-allow-origin" not in response.headers
        engine.connect.assert_not_called()


@pytest.mark.parametrize("method,header", [("PUT", "content-type"), ("POST", "x-custom")])
def test_preflight_rejects_unneeded_methods_and_headers(method, header, engine):
    with TestClient(create_app(configured_settings())) as client:
        response = client.options("/api/v1/transactions", headers={
            "Origin": "http://localhost:5173", "Access-Control-Request-Method": method,
            "Access-Control-Request-Headers": header,
        })
        assert response.status_code == 400
        engine.connect.assert_not_called()


def test_custom_loopback_origin_overrides_defaults(monkeypatch, engine):
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", '["https://[::1]:5174"]')
    settings = configured_settings()
    assert settings.cors_allowed_origins == ("https://[::1]:5174",)
    with TestClient(create_app(settings)) as client:
        response = client.get("/api/v1/health", headers={"Origin": "https://[::1]:5174"})
        assert response.headers["access-control-allow-origin"] == "https://[::1]:5174"
        old_origin = client.get("/api/v1/health", headers={"Origin": "http://localhost:5173"})
        assert "access-control-allow-origin" not in old_origin.headers


def test_empty_allowlist_disables_browser_access(engine):
    with TestClient(create_app(configured_settings(CORS_ALLOWED_ORIGINS=[]))) as client:
        response = client.get("/api/v1/health", headers={"Origin": "http://localhost:5173"})
        assert "access-control-allow-origin" not in response.headers


@pytest.mark.parametrize("origin", [
    "*", "null", "https://example.com:5173", "http://0.0.0.0:5173",
    "http://127.0.0.2:5173", "http://localhost.evil:5173", "http://localhost",
    "http://localhost:0", "http://localhost:65536", "http://localhost:05173",
    "http://localhost:5173/", "http://localhost:5173/path", "http://localhost:5173?x=1",
    "http://localhost:5173#fragment", "http://user@localhost:5173", "file://localhost:5173",
    " http://localhost:5173", "http://localhost:5173\n",
])
def test_cors_configuration_rejects_nonlocal_or_nonorigin_values(origin):
    with pytest.raises(ValidationError):
        configured_settings(CORS_ALLOWED_ORIGINS=[origin])


def test_cors_configuration_deduplicates_explicit_origins():
    settings = configured_settings(CORS_ALLOWED_ORIGINS=["http://localhost:5173"] * 2)
    assert settings.cors_allowed_origins == ("http://localhost:5173",)
