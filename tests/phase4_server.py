"""Run a local API on a new disposable database; never mutate the dev database.

Usage: backend/.venv/bin/python tests/phase4_server.py serve|verify|seed
State contains database identity/fingerprints only; credentials stay in Settings.
The disposable database is deliberately retained for review.
"""
from hashlib import sha256
import json
from pathlib import Path
import re
import secrets
import sys
from uuid import UUID, uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from app.config import Settings

STATE = Path(__file__).resolve().parent / ".phase4-state.local"
TABLES = ("owners", "transactions", "subscriptions", "budget_profiles", "preferences")


def read_state():
    state = json.loads(STATE.read_text())
    assert re.fullmatch(r"finance_dashboard_phase4_[a-f0-9]{12}", state["database"]), "Not a disposable database"
    UUID(state["owner_id"])
    assert re.fullmatch(r"[a-f0-9]{64}", state["run_nonce"]), "Missing test run identity"
    return state


def config():
    settings = Settings()
    url = make_url(settings.database_url.get_secret_value())
    assert (url.drivername, url.host, url.port, url.database) == ("postgresql+psycopg", "127.0.0.1", 5434, "finance_dashboard"), "Refusing unapproved local source"
    return settings, url


def fingerprint(url):
    engine = create_engine(url, hide_parameters=True)
    try:
        with engine.connect() as connection:
            connection.execute(text("SET TRANSACTION READ ONLY"))
            assert connection.scalar(text("SELECT version_num FROM alembic_version")) == "0002_models"
            return {table: {"count": connection.scalar(text(f'SELECT count(*) FROM "{table}"')),
                           "sha256": sha256(connection.scalar(text(f"SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text, '[]') FROM {table} t")).encode()).hexdigest()}
                    for table in TABLES}
    finally:
        engine.dispose()


def main():
    raise RuntimeError("The Phase4 database fixture is retired. Use the separately approved Phase5 fixture workflow.")
    settings, source = config()
    mode = sys.argv[1]
    if mode == "verify":
        state = read_state()
        assert fingerprint(source) == state["dev_fingerprint"], "Development database changed"
        print("Development database counts and row hashes unchanged")
        return
    if mode == "seed":
        from app.models import Owner, Transaction
        from sqlalchemy.orm import Session
        from datetime import date
        from decimal import Decimal
        state = read_state()
        engine = create_engine(source.set(database=state["database"]), hide_parameters=True)
        try:
            with Session(engine) as session, session.begin():
                owner_id = UUID(state["owner_id"])
                if session.get(Owner, owner_id) is None:
                    session.add(Owner(id=owner_id)); session.flush()
                session.add_all([Transaction(owner_id=owner_id, title=f"Page fixture {index:03}", amount_usd=Decimal("1.00000001"), type="expense", category="Page fixture", transaction_date=date(2026, 10, 24)) for index in range(125)])
            print("Seeded 125 disposable pagination records")
        finally:
            engine.dispose()
        return
    assert mode in {"serve", "resume"}
    before = fingerprint(source)
    if mode == "resume":
        # Resume only a previously created disposable namespace; never migrate it.
        database = sys.argv[2]
        assert re.fullmatch(r"finance_dashboard_phase4_[a-f0-9]{12}", database)
        assert all(value["count"] == 0 for value in before.values()), "Resume requires the confirmed empty development baseline"
        engine = create_engine(source.set(database=database), hide_parameters=True)
        try:
            with engine.connect() as connection:
                connection.execute(text("SET TRANSACTION READ ONLY"))
                assert connection.scalar(text("SELECT current_database()")) == database
                assert connection.scalar(text("SELECT version_num FROM alembic_version")) == "0002_models"
                owners = connection.execute(text("SELECT id FROM owners")).scalars().all()
                assert len(owners) == 1, "Resume requires one disposable owner"
                owner = str(owners[0])
        finally:
            engine.dispose()
    else:
        database = "finance_dashboard_phase4_" + uuid4().hex[:12]
        owner = str(uuid4())
        admin = create_engine(source, isolation_level="AUTOCOMMIT", hide_parameters=True)
        try:
            with admin.connect() as connection:
                connection.execute(text(f'CREATE DATABASE "{database}"'))
        finally:
            admin.dispose()
        engine = create_engine(source.set(database=database), hide_parameters=True)
        try:
            from alembic import command
            from alembic.config import Config
            migration_config = Config(str(Path(__file__).resolve().parents[1] / "backend/alembic.ini"))
            with engine.begin() as connection:
                migration_config.attributes["connection"] = connection
                command.upgrade(migration_config, "head")
        finally:
            engine.dispose()
    test_url = source.set(database=database)
    run_nonce = secrets.token_hex(32)
    STATE.write_text(json.dumps({"database": database, "owner_id": owner, "run_nonce": run_nonce, "dev_fingerprint": before}, indent=2))
    configured = Settings(_env_file=None, DATABASE_URL=test_url.render_as_string(hide_password=False), SINGLE_OWNER_ID=owner, CORS_ALLOWED_ORIGINS=["http://127.0.0.1:5174"])
    assert fingerprint(source) == before
    print(f"Disposable API ready: http://127.0.0.1:18084 database={database}", flush=True)
    from app.main import create_app
    from fastapi import Request
    import uvicorn
    app = create_app(configured)

    @app.get("/__phase4__/identity", include_in_schema=False)
    def identity(request: Request):
        with request.app.state.engine.connect() as connection:
            actual_database = connection.scalar(text("SELECT current_database()"))
        return {"database": actual_database, "owner_id": str(configured.single_owner_id), "run_nonce": run_nonce}

    uvicorn.run(app, host="127.0.0.1", port=18084, access_log=False)


if __name__ == "__main__":
    main()
