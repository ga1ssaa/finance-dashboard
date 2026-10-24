"""Explicitly approved disposable auth fixture; importing this file performs no IO.

prepare --database EXACT_NAME creates/migrates only a reserved Phase5 namespace.
serve uses only a completed manifest, inspect/verify perform read-only inspection.
All operations require a separate user approval; none execute at import time.
"""
import argparse
from pathlib import Path
import secrets
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from sqlalchemy import inspect, text
from sqlalchemy.engine import make_url
from verification.db_safety import (
    SafetyError, canonical_source_url, canonical_test_url, create_reserved_database,
    guarded_engine, load_manifest, preservation_snapshot, reserve_manifest,
    update_manifest, verify_database,
)

STATE = ROOT / "tests/.phase5-state.local"
AUTH_DATABASE = "finance_dashboard_phase5_f0e1554a4e98"
TABLES = {"owners", "transactions", "subscriptions", "budget_profiles", "preferences",
          "users", "auth_sessions", "auth_refresh_tokens", "alembic_version"}


def source_settings():
    from app.config import Settings
    settings = Settings()
    return settings, canonical_source_url(settings.database_url.get_secret_value())


def fingerprint(source):
    engine = guarded_engine(source, "finance_dashboard", mode="readonly")
    try:
        with engine.connect() as connection:
            verify_database(connection, "finance_dashboard")
            return preservation_snapshot(connection)
    finally:
        engine.dispose()


def ready_state():
    state = load_manifest(STATE, require_stage="ready")
    if state["database"] != AUTH_DATABASE:
        raise SafetyError("The auth fixture requires its separately approved database")
    nonce = state.get("run_nonce")
    if not isinstance(nonce, str) or len(nonce) != 64 or any(char not in "0123456789abcdef" for char in nonce):
        raise SafetyError("Invalid test run identity")
    return state


def verify_target(engine, database):
    with engine.connect() as connection:
        verify_database(connection, database)
        if set(inspect(connection).get_table_names(schema="public")) != TABLES:
            raise SafetyError("Unexpected disposable schema")
        if connection.execute(text("SELECT version_num FROM alembic_version")).scalars().all() != ["0003_auth"]:
            raise SafetyError("Unexpected disposable schema revision")


def prepare(source, database):
    if database != AUTH_DATABASE:
        raise SafetyError("The auth fixture requires its separately approved database")
    canonical_test_url(source, database)
    before = fingerprint(source)
    # The helper exclusively creates and fsyncs the manifest and its directory
    # before it allows CREATE DATABASE. Existing paths are never resumed.
    reserve_manifest(STATE, database)
    update_manifest(STATE, {"dev_fingerprint": before, "run_nonce": secrets.token_hex(32)})
    create_reserved_database(source, STATE)
    engine = guarded_engine(source, database, mode="target_write")
    try:
        from alembic import command
        from alembic.config import Config
        config = Config(str(ROOT / "backend/alembic.ini"))
        with engine.begin() as connection:
            verify_database(connection, database)
            config.attributes["connection"] = connection
            command.upgrade(config, "0003_auth")
        verify_target(engine, database)
    finally:
        engine.dispose()
    if fingerprint(source) != before:
        raise SafetyError("Development database fingerprint changed")
    update_manifest(STATE, {"stage": "ready"})
    print("Prepared isolated Phase5 auth database " + database)


def build_app(settings, source, state):
    """Bind all application connections to the same checked test-only factory."""
    import app.main as application
    expected = canonical_test_url(source, state["database"])
    if make_url(settings.database_url.get_secret_value()) != expected:
        raise SafetyError("Runtime application URL differs from the approved target")

    def runtime_engine(configured):
        if make_url(configured.database_url.get_secret_value()) != expected:
            raise SafetyError("Runtime application URL changed")
        return guarded_engine(source, state["database"], mode="target_write")

    # This override exists only in this isolated fixture process, never in app code.
    application.create_database_engine = runtime_engine
    app = application.create_app(settings)
    from fastapi import Request

    @app.get("/__phase5__/identity", include_in_schema=False)
    def identity(request: Request):
        with request.app.state.engine.connect() as connection:
            verify_database(connection, state["database"])
            actual = connection.scalar(text("SELECT current_database()"))
            revision = connection.scalar(text("SELECT version_num FROM alembic_version"))
        return {"database": actual, "run_nonce": state["run_nonce"], "revision": revision}
    return app


def serve(settings, source):
    from pydantic import SecretStr
    state = ready_state()
    target = canonical_test_url(source, state["database"])
    engine = guarded_engine(source, state["database"], mode="target_write")
    try:
        verify_target(engine, state["database"])
    finally:
        engine.dispose()
    configured = settings.model_copy(update={"database_url": SecretStr(target.render_as_string(hide_password=False)), "cors_allowed_origins": ("http://127.0.0.1:5174",)})
    app = build_app(configured, source, state)
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=18085, access_log=False, proxy_headers=False)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_subparsers(dest="mode", required=True)
    preparing = actions.add_parser("prepare")
    preparing.add_argument("--database", required=True)
    for action in ("serve", "inspect", "verify"):
        actions.add_parser(action)
    args = parser.parse_args()
    settings, source = source_settings()
    if args.mode == "prepare":
        prepare(source, args.database)
    elif args.mode == "serve":
        serve(settings, source)
    elif args.mode == "inspect":
        import json
        print(json.dumps(fingerprint(source), sort_keys=True))
    else:
        state = ready_state()
        if fingerprint(source) != state.get("dev_fingerprint"):
            raise SafetyError("Development database fingerprint changed")
        print("Development database fingerprint unchanged")


if __name__ == "__main__":
    main()
