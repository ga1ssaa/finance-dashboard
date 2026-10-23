"""Infrastructure checks use fakes and never connect to a configured database."""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy.exc import OperationalError

from app.config import Settings
from app.db import get_session
from app.main import create_app


OWNER_ID = "9c857913-8adc-4ee9-ac17-3c5c15af63ed"
URL = "postgresql+psycopg://qa:private-test-password@127.0.0.1:65432/disposable_qa"


@pytest.fixture
def settings(monkeypatch):
    monkeypatch.setenv("SINGLE_OWNER_ID", OWNER_ID)
    monkeypatch.setenv("DATABASE_URL", URL)
    return Settings(_env_file=None)


@pytest.fixture
def engine(monkeypatch):
    fake = MagicMock()
    monkeypatch.setattr("app.main.create_database_engine", lambda settings: fake)
    return fake


def test_liveness_starts_without_connecting_to_database(settings, engine):
    engine.connect.side_effect = OperationalError(None, None, Exception("offline"))
    with TestClient(create_app(settings)) as client:
        assert client.get("/api/v1/health").json() == {"status": "ok"}
        engine.connect.assert_not_called()
    engine.dispose.assert_called_once_with()


def test_readiness_executes_probe_and_releases_connection(settings, engine):
    with TestClient(create_app(settings)) as client:
        response = client.get("/api/v1/health/ready")
        assert response.status_code == 200
        assert response.json() == {"status": "ready"}
        connection = engine.connect.return_value.__enter__.return_value
        assert str(connection.execute.call_args.args[0]) == "SELECT 1"
        engine.connect.return_value.__exit__.assert_called_once()


@pytest.mark.parametrize("failure_stage", ["connect", "execute"])
def test_readiness_failure_is_sanitized(settings, engine, failure_stage):
    error = OperationalError("SELECT 1", {}, Exception(URL))
    if failure_stage == "connect":
        engine.connect.side_effect = error
    else:
        engine.connect.return_value.__enter__.return_value.execute.side_effect = error
    with TestClient(create_app(settings)) as client:
        response = client.get("/api/v1/health/ready")
        assert response.status_code == 503
        assert response.json() == {"status": "not_ready"}
        assert "private-test-password" not in response.text
        assert client.get("/api/v1/health").status_code == 200
    engine.dispose.assert_called_once_with()


@pytest.mark.parametrize("raised", [False, True])
def test_request_session_closes_on_completion_and_error(raised):
    factory = MagicMock()
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(session_factory=factory)))
    dependency = get_session(request)
    assert next(dependency) is factory.return_value.__enter__.return_value
    if raised:
        with pytest.raises(RuntimeError, match="request failed"):
            dependency.throw(RuntimeError("request failed"))
    else:
        with pytest.raises(StopIteration):
            next(dependency)
    factory.return_value.__exit__.assert_called_once()


@pytest.mark.parametrize("url", [None, "private-test-password", "sqlite:///private-test-password", "postgresql+psycopg:///private-test-password"])
def test_configuration_rejects_missing_or_invalid_url_without_disclosure(monkeypatch, url):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    if url is not None:
        monkeypatch.setenv("DATABASE_URL", url)
    with pytest.raises(ValidationError) as caught:
        Settings(_env_file=None)
    assert "private-test-password" not in str(caught.value)


def test_environment_overrides_dotenv_without_disclosing_url(monkeypatch, tmp_path):
    dotenv = tmp_path / ".env"
    dotenv.write_text("DATABASE_URL=postgresql+psycopg://file:unused@127.0.0.1/file_db\n")
    monkeypatch.setenv("SINGLE_OWNER_ID", OWNER_ID)
    monkeypatch.setenv("DATABASE_URL", URL)
    configured = Settings(_env_file=dotenv)
    assert configured.database_url.get_secret_value() == URL
    assert "private-test-password" not in repr(configured)


@pytest.mark.parametrize("owner_id", [None, "not-a-uuid", "", "123"])
def test_configuration_requires_explicit_valid_owner(monkeypatch, owner_id):
    monkeypatch.setenv("DATABASE_URL", URL)
    monkeypatch.delenv("SINGLE_OWNER_ID", raising=False)
    if owner_id is not None:
        monkeypatch.setenv("SINGLE_OWNER_ID", owner_id)
    with pytest.raises(ValidationError):
        Settings(_env_file=None)
