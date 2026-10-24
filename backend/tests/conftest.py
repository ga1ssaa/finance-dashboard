"""Test-only configuration; production always requires an explicit signing key."""
import secrets
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest


@pytest.fixture(autouse=True, scope="session")
def signing_key():
    value = secrets.token_urlsafe(48)
    with pytest.MonkeyPatch.context() as monkeypatch:
        monkeypatch.setenv("AUTH_JWT_SECRET", value)
        yield value


@pytest.fixture(scope="session")
def phase5_state():
    from pathlib import Path
    from verification.db_safety import SafetyError, load_manifest
    state = load_manifest(Path(__file__).resolve().parents[2] / "tests/.phase5-state.local", require_stage="ready")
    if state["database"] != "finance_dashboard_phase5_f0e1554a4e98":
        raise SafetyError("Auth integration is limited to the separately approved auth database")
    nonce = state.get("run_nonce")
    if not isinstance(nonce, str) or len(nonce) != 64 or any(char not in "0123456789abcdef" for char in nonce):
        raise SafetyError("Missing isolated test identity")
    return state


@pytest.fixture(scope="session")
def phase5_source(signing_key):
    from app.config import Settings
    from verification.db_safety import canonical_source_url
    return canonical_source_url(Settings().database_url.get_secret_value())


@pytest.fixture(scope="session")
def phase5_settings(phase5_source, phase5_state):
    from pydantic import SecretStr
    from app.config import Settings
    from verification.db_safety import canonical_test_url
    target = canonical_test_url(phase5_source, phase5_state["database"])
    return Settings().model_copy(update={"database_url": SecretStr(target.render_as_string(hide_password=False))})


@pytest.fixture(scope="session")
def phase5_engine(phase5_source, phase5_state):
    from sqlalchemy import inspect, text
    from verification.db_safety import SafetyError, guarded_engine, verify_database
    engine = guarded_engine(phase5_source, phase5_state["database"], mode="target_write")
    tables = {"owners", "transactions", "subscriptions", "budget_profiles", "preferences", "users", "auth_sessions", "auth_refresh_tokens", "alembic_version"}
    try:
        with engine.connect() as connection:
            verify_database(connection, phase5_state["database"])
            if set(inspect(connection).get_table_names(schema="public")) != tables:
                raise SafetyError("Unexpected disposable schema")
            if connection.execute(text("SELECT version_num FROM alembic_version")).scalars().all() != ["0003_auth"]:
                raise SafetyError("Unexpected disposable revision")
        yield engine
    finally:
        engine.dispose()


@pytest.fixture
def guarded_app(phase5_source, phase5_state, phase5_settings, phase5_engine, monkeypatch):
    """Real app behavior, with every test-runtime connection guarded identically."""
    import app.main as application
    from sqlalchemy.engine import make_url
    from verification.db_safety import SafetyError, canonical_test_url, guarded_engine
    expected = canonical_test_url(phase5_source, phase5_state["database"])
    def runtime_engine(configured):
        if make_url(configured.database_url.get_secret_value()) != expected:
            raise SafetyError("Test runtime URL changed")
        return guarded_engine(phase5_source, phase5_state["database"], mode="target_write")
    monkeypatch.setattr(application, "create_database_engine", runtime_engine)
    return lambda: application.create_app(phase5_settings)
