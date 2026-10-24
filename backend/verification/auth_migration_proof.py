"""Explicitly approved, disposable-only migration preservation proof.

Review before running. Importing this module performs no IO.
Required target: --database finance_dashboard_phase5_<12 lowercase hex digits>
A reservation and creation claim are retained after every failure. No reuse,
resume, downgrade, reset or deletion is implemented.
"""

import argparse
import json
from pathlib import Path
import sys


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", required=True, help="Exact disposable identifier separately approved for this execution")
    args = parser.parse_args(argv)
    root = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(root / "backend"))
    from datetime import date
    from decimal import Decimal
    from alembic import command
    from alembic.autogenerate import compare_metadata
    from alembic.config import Config
    from alembic.migration import MigrationContext
    from sqlalchemy import text
    from sqlalchemy.orm import Session
    from app.config import Settings
    from app.db import Base
    from app.models import BudgetProfile, Owner, Preferences, Subscription, Transaction
    from verification.db_safety import (
        BUSINESS_TABLES, SafetyError, canonical_source_url, create_reserved_database,
        guarded_engine, preservation_snapshot, reserve_manifest, update_manifest,
        validate_test_database, verify_database,
    )
    manifest = root / "backend/auth-migration-proof.local"
    reserved = False
    target = None
    try:
        database = validate_test_database(args.database)
        settings = Settings()
        source = canonical_source_url(settings.database_url.get_secret_value())
        development = guarded_engine(source, "finance_dashboard", mode="readonly")
        try:
            with development.connect() as connection:
                development_before = preservation_snapshot(connection)
        finally:
            development.dispose()
        reserve_manifest(manifest, database)
        reserved = True
        update_manifest(manifest, {"development_before": development_before})
        # This helper never connects to the target after duplicate CREATE or any
        # uncertain creation outcome. A durable claim prevents another attempt.
        create_reserved_database(source, manifest)
        target = guarded_engine(source, database, mode="target_write")
        config = Config(str(root / "backend/alembic.ini"))
        config.set_main_option("script_location", str(root / "backend/alembic"))
        with target.begin() as connection:
            verify_database(connection, database)
            config.attributes["connection"] = connection
            command.upgrade(config, "0002_models")
        with Session(target) as session:
            with session.begin():
                verify_database(session.connection(), database)
                owner = Owner()
                session.add(owner)
                session.flush()
                legacy_owner = owner.id
                session.add_all([
                    Transaction(owner_id=legacy_owner, title="Synthetic legacy", amount_usd=Decimal("12.12345678"), type="expense", category="Synthetic", transaction_date=date(2026, 10, 24)),
                    Subscription(owner_id=legacy_owner, service_name="Synthetic service", amount_usd=Decimal("9.00000001"), next_payment_date=date(2026, 11, 1)),
                    BudgetProfile(owner_id=legacy_owner, monthly_income_usd=Decimal("1234.56789012"), needs_spent_usd=Decimal("12.00000001"), wants_spent_usd=Decimal("3.4"), savings_usd=Decimal("5.00000009")),
                    Preferences(owner_id=legacy_owner, display_currency="EUR"),
                ])
        with target.connect() as connection:
            before = preservation_snapshot(connection, database)
            if before["revision"] != ["0002_models"] or set(before["tables"]) != set(BUSINESS_TABLES) | {"alembic_version"}:
                raise SafetyError("The disposable baseline schema is unexpected")
            if any(item["count"] != 1 for item in before["business"].values()):
                raise SafetyError("Synthetic baseline counts are unexpected")
        update_manifest(manifest, {"stage": "seeded_at_0002", "before": before})
        with target.begin() as connection:
            verify_database(connection, database)
            config.attributes["connection"] = connection
            command.upgrade(config, "0003_auth")
        with target.connect() as connection:
            after = preservation_snapshot(connection, database)
            if after["business"] != before["business"]:
                raise SafetyError("Legacy financial rows changed")
            expected_tables = set(BUSINESS_TABLES) | {"alembic_version", "users", "auth_sessions", "auth_refresh_tokens"}
            if after["revision"] != ["0003_auth"] or set(after["tables"]) != expected_tables:
                raise SafetyError("The disposable authentication schema is unexpected")
            if connection.scalar(text("SELECT count(*) FROM users WHERE owner_id=:owner"), {"owner": legacy_owner}) != 0:
                raise SafetyError("Legacy ownership was claimed")
            drift = compare_metadata(MigrationContext.configure(connection, opts={"compare_type": True, "compare_server_default": True}), Base.metadata)
            if drift:
                raise SafetyError("ORM and migration metadata do not match")
        development = guarded_engine(source, "finance_dashboard", mode="readonly")
        try:
            with development.connect() as connection:
                development_after = preservation_snapshot(connection)
        finally:
            development.dispose()
        if development_after != development_before:
            raise SafetyError("Development preservation fingerprint changed")
        result = update_manifest(manifest, {
            "stage": "verified_at_0003", "after": after, "financial_preserved": True,
            "legacy_owner_unclaimed": True, "metadata_matches": True,
            "development_preserved": True, "development_after": development_after,
        })
        print(json.dumps(result, sort_keys=True))
        return 0
    except Exception:
        if reserved:
            try:
                update_manifest(manifest, {"stage": "failed"})
            except Exception:
                pass  # Retain the original reservation even if an update fails.
        print("PROOF_FAILED: retain the reservation and any created database; do not reuse the target")
        return 1
    finally:
        if target is not None:
            target.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
