"""Opt-in real PostgreSQL operations; retain only freshly registered test data.

The shared fixture binds every app/inspection connection to the approved Phase5
disposable target at revision 0004. No migration, cleanup, existing-account
lookup, auth override, or production fallback is performed here.
"""

from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
import hashlib
import json
import os
import secrets
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, select, text

from app.models import (
    AuthRefreshToken, AuthSession, BudgetProfile, DataOperationReceipt, Owner,
    Preferences, Subscription, Transaction, User,
)


pytestmark = pytest.mark.skipif(
    os.environ.get("RUN_DATABASE_TESTS") != "1",
    reason="requires separately approved disposable PostgreSQL at revision 0004",
)
CSRF = {"Origin": "http://127.0.0.1:5173", "X-CSRF-Protection": "1"}
FINANCIAL = (Transaction, Subscription, BudgetProfile, Preferences)
APP_TRANSACTION_CONTROLS = frozenset({
    "SET TRANSACTION ISOLATION LEVEL READ COMMITTED",
    "SET LOCAL lock_timeout = '5s'",
    "SET LOCAL statement_timeout = '60s'",
    "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY",
})


def transaction_control_adapter(original):
    """Allow only app transaction setup; preserve every routing/DML guard."""
    def checked(statement, mode):
        if mode == "target_write" and statement in APP_TRANSACTION_CONTROLS:
            return True
        return original(statement, mode)
    return checked


@dataclass(repr=False)
class Account:
    user_id: UUID
    owner_id: UUID
    password: str = field(repr=False)
    token: str = field(repr=False)

    @property
    def headers(self):
        return {"Authorization": "Bearer " + self.token}


@pytest.fixture
def api(guarded_app, phase5_engine, monkeypatch):
    # Fresh application means independent, unmodified production rate limiters.
    from verification import db_safety
    monkeypatch.setattr(db_safety, "_checked_statement",
                        transaction_control_adapter(db_safety._checked_statement))
    with TestClient(guarded_app(), raise_server_exceptions=False) as client:
        yield client, phase5_engine


def expect(response, status):
    # Never include request/response bodies, credentials or tokens in failures.
    assert response.status_code == status
    return response.json() if status != 204 else None


def register(api):
    client, engine = api
    password = secrets.token_urlsafe(24)
    body = expect(client.post("/api/v1/auth/register", headers=CSRF, json={
        "email": "ops-" + uuid4().hex + "@example.test", "password": password,
    }), 201)
    user_id = UUID(body["user"]["id"])
    # Lookup only the UUID returned by this test's successful registration.
    with engine.connect() as connection:
        owner = connection.scalar(select(User.owner_id).where(User.id == user_id))
    assert isinstance(owner, UUID)
    return Account(user_id, owner, password, body["access_token"])


def seed(api, account):
    client, _ = api
    tx = expect(client.post("/api/v1/transactions", headers=account.headers, json={
        "title": "Disposable operation sentinel", "amount_usd": "12.12345678",
        "type": "expense", "category": "Synthetic", "transaction_date": "2026-10-25",
    }), 201)
    expect(client.post("/api/v1/subscriptions", headers=account.headers, json={
        "service_name": "Disposable subscription", "amount_usd": "0.00000001",
        "next_payment_date": "2026-11-01", "icon": "S", "status": "active",
    }), 201)
    expect(client.patch("/api/v1/budget", headers=account.headers, json={
        "monthly_income_usd": "10.00000001", "needs_spent_usd": "1.00000000",
        "wants_spent_usd": "2.00000000", "savings_usd": "3.00000000",
    }), 200)
    expect(client.patch("/api/v1/preferences", headers=account.headers,
                        json={"display_currency": "EUR"}), 200)
    return tx["id"]


def _value(value):
    if isinstance(value, Decimal):
        return format(value, ".8f")
    if isinstance(value, (UUID, date, datetime)):
        return str(value)
    return value


def snapshot(engine, account):
    """Independent RO snapshot of this fresh namespace, never global rows."""
    queries = {
        model.__tablename__: select(*model.__table__.columns).where(
            model.owner_id == account.owner_id).order_by(model.id)
        for model in FINANCIAL
    }
    queries.update({
        "owners": select(*Owner.__table__.columns).where(Owner.id == account.owner_id),
        "users": select(*User.__table__.columns).where(User.id == account.user_id),
        "auth_sessions": select(*AuthSession.__table__.columns).where(
            AuthSession.user_id == account.user_id).order_by(AuthSession.id),
        "auth_refresh_tokens": select(*AuthRefreshToken.__table__.columns).where(
            AuthRefreshToken.session_id.in_(select(AuthSession.id).where(
                AuthSession.user_id == account.user_id))).order_by(AuthRefreshToken.id),
        "receipts": select(*DataOperationReceipt.__table__.columns).where(
            DataOperationReceipt.owner_id == account.owner_id).order_by(
                DataOperationReceipt.idempotency_key),
    })
    result = {}
    with engine.connect().execution_options(isolation_level="REPEATABLE READ") as connection:
        tx = connection.begin()
        try:
            connection.execute(text("SET TRANSACTION READ ONLY"))
            for name, query in queries.items():
                digest, count = hashlib.sha256(), 0
                for row in connection.execute(query):
                    raw = json.dumps([_value(v) for v in row], sort_keys=True,
                                     ensure_ascii=False, separators=(",", ":")).encode()
                    digest.update(len(raw).to_bytes(8, "big") + raw)
                    count += 1
                result[name] = {"count": count, "sha256": digest.hexdigest()}
        finally:
            tx.rollback()
    return result


def unchanged_auth(before, after):
    for table in ("owners", "users", "auth_sessions", "auth_refresh_tokens"):
        assert after[table] == before[table]


def document():
    # Duplicate legitimate rows must stay distinct; canonical values remain exact.
    transaction = {"title": "Imported duplicate", "amount_usd": "999999999999.99999999",
                   "type": "income", "category": "Synthetic", "transaction_date": "2026-10-25"}
    return json.dumps({
        "format": "finance-dashboard", "schema_version": 1,
        "exported_at": "2026-10-25T12:00:00Z", "base_currency": "USD",
        "data": {"transactions": [transaction, transaction], "subscriptions": [{
            "service_name": "Imported service", "amount_usd": "0.00000001",
            "next_payment_date": "2026-11-01", "icon": "I", "status": "paused",
        }], "budget": {"monthly_income_usd": "0.00000001", "needs_spent_usd": "0.00000000",
                        "wants_spent_usd": "0.00000000", "savings_usd": "0.00000000"},
                 "preferences": {"display_currency": "KZT"}},
    }, separators=(",", ":"))


def preview(api, account, kind, raw=None):
    body = {} if kind == "reset" else {"mode": "replace", "source_format": "v1", "document": raw}
    return expect(api[0].post("/api/v1/data/" + ("reset/preview" if kind == "reset" else "import/preview"),
                              headers=account.headers, json=body), 200)


def apply(api, account, kind, authorization, key, raw=None, **changes):
    body = {"preview_token": authorization["preview_token"], "password": account.password,
            "confirmation": "RESET MY FINANCIAL DATA" if kind == "reset" else "REPLACE MY FINANCIAL DATA"}
    if kind == "import":
        body.update(mode="replace", source_format="v1", document=raw)
    body.update(changes)
    return api[0].post("/api/v1/data/" + kind, headers={
        **account.headers, **CSRF, "Idempotency-Key": str(key),
    }, json=body)


def test_real_import_replaces_all_resources_exactly_without_touching_other_owner(api):
    a, b = register(api), register(api)
    old_id = seed(api, a)
    seed(api, b)
    before_a, before_b = snapshot(api[1], a), snapshot(api[1], b)
    raw, key = document(), uuid4()
    authorization = preview(api, a, "import", raw)
    assert snapshot(api[1], a) == before_a  # Preview has zero durable side effects.
    result = expect(apply(api, a, "import", authorization, key, raw), 200)
    assert result["removed"] == {"transactions": 1, "subscriptions": 1, "budget_profiles": 1, "preferences": 1}
    assert result["created"] == {"transactions": 2, "subscriptions": 1, "budget_profiles": 1, "preferences": 1}
    assert result["document_sha256"] == hashlib.sha256(raw.encode()).hexdigest()
    listing = expect(api[0].get("/api/v1/transactions", headers=a.headers), 200)
    assert listing["total"] == 2
    assert len({row["id"] for row in listing["items"]}) == 2
    assert all(row["id"] != old_id and row["amount_usd"] == "999999999999.99999999" for row in listing["items"])
    exported = expect(api[0].get("/api/v1/data/export", headers=a.headers), 200)
    assert hashlib.sha256(json.dumps(exported["data"], sort_keys=True).encode()).digest() == hashlib.sha256(
        json.dumps(json.loads(raw)["data"], sort_keys=True).encode()).digest()
    after_a = snapshot(api[1], a)
    unchanged_auth(before_a, after_a)
    assert after_a["receipts"]["count"] == 1
    assert snapshot(api[1], b) == before_b


def test_real_reset_removes_only_own_finances_preserving_account_sessions_and_foreign_rows(api):
    a, b = register(api), register(api)
    seed(api, a)
    seed(api, b)
    before_a, before_b = snapshot(api[1], a), snapshot(api[1], b)
    result = expect(apply(api, a, "reset", preview(api, a, "reset"), uuid4()), 200)
    assert result["document_sha256"] is None
    after = snapshot(api[1], a)
    assert all(after[model.__tablename__]["count"] == 0 for model in FINANCIAL)
    assert after["receipts"]["count"] == 1
    unchanged_auth(before_a, after)
    assert snapshot(api[1], b) == before_b
    expect(api[0].get("/api/v1/auth/me", headers=a.headers), 200)


def test_wrong_password_confirmation_and_foreign_preview_leave_every_row_unchanged(api):
    a, b = register(api), register(api)
    seed(api, a)
    before = snapshot(api[1], a)
    own, foreign = preview(api, a, "reset"), preview(api, b, "reset")
    for authorization, changes, code in [
        (own, {"password": secrets.token_urlsafe(24)}, "CONFIRMATION_FAILED"),
        (own, {"confirmation": "RESET"}, "CONFIRMATION_FAILED"),
        (foreign, {}, "PREVIEW_INVALID"),
    ]:
        rejected = expect(apply(api, a, "reset", authorization, uuid4(), **changes), 403)
        assert rejected["code"] == code
        assert snapshot(api[1], a) == before
    expect(api[0].get("/api/v1/auth/me", headers=a.headers), 200)


def test_stale_preview_rejects_after_a_real_committed_financial_edit(api):
    a = register(api)
    record_id = seed(api, a)
    authorization = preview(api, a, "reset")
    expect(api[0].patch("/api/v1/transactions/" + record_id, headers=a.headers,
                       json={"title": "Committed after preview"}), 200)
    before = snapshot(api[1], a)
    rejected = expect(apply(api, a, "reset", authorization, uuid4()), 409)
    assert rejected["code"] == "STATE_CHANGED"
    assert snapshot(api[1], a) == before


def test_committed_lost_response_receipt_replay_conflict_and_status_are_owner_scoped(api):
    a, b = register(api), register(api)
    seed(api, a)
    raw, key = document(), uuid4()
    authorization = preview(api, a, "import", raw)
    # Discard the completed response: recovery must rely on durable DB receipt.
    expect(apply(api, a, "import", authorization, key, raw), 200)
    committed = snapshot(api[1], a)
    status_url = "/api/v1/data/operations/" + str(key)
    status = expect(api[0].get(status_url, headers=a.headers), 200)
    replay = expect(apply(api, a, "import", authorization, key, raw,
                         preview_token="invalid-old-preview", password=secrets.token_urlsafe(24),
                         confirmation="not-confirmed"), 200)
    assert replay == status and status["idempotency_key"] == str(key)
    assert snapshot(api[1], a) == committed
    conflict = expect(apply(api, a, "import", authorization, key, raw + " "), 409)
    assert conflict["code"] == "IDEMPOTENCY_CONFLICT"
    reused = expect(apply(api, a, "import", authorization, uuid4(), raw), 409)
    assert reused["code"] == "PREVIEW_USED"
    foreign = expect(api[0].get(status_url, headers=b.headers), 404)
    assert foreign["code"] == "OPERATION_NOT_OBSERVED"
    assert snapshot(api[1], a) == committed


def test_actual_post_delete_failure_rolls_back_financial_rows_and_receipt_then_same_key_can_succeed(api):
    a = register(api)
    seed(api, a)
    before = snapshot(api[1], a)
    raw, key = document(), uuid4()
    authorization = preview(api, a, "import", raw)
    fired = []

    def fail_after_delete(connection, cursor, statement, parameters, context, many):
        if statement.lstrip().upper().startswith("DELETE FROM TRANSACTIONS"):
            values = parameters.values() if isinstance(parameters, dict) else parameters
            assert a.owner_id in values
            fired.append(True)
            raise RuntimeError("Synthetic post-delete rollback probe")

    engine = api[0].app.state.engine
    event.listen(engine, "after_cursor_execute", fail_after_delete)
    try:
        expect(apply(api, a, "import", authorization, key, raw), 500)
    finally:
        event.remove(engine, "after_cursor_execute", fail_after_delete)
    assert fired == [True]  # DELETE reached real PG before the controlled fault.
    assert snapshot(api[1], a) == before
    missing = expect(api[0].get("/api/v1/data/operations/" + str(key), headers=a.headers), 404)
    assert missing["code"] == "OPERATION_NOT_OBSERVED"
    expect(apply(api, a, "import", authorization, key, raw), 200)
    assert snapshot(api[1], a)["receipts"]["count"] == 1
