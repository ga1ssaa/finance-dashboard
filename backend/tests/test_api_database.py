"""Opt-in HTTP/PostgreSQL tests. Every write is rolled back, never cleaned up."""
from datetime import date
from decimal import Decimal
import os
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.config import Settings
from app.db import create_database_engine, get_session
from app.main import create_app
from app.models import Owner, Subscription, Transaction

pytestmark = pytest.mark.skipif(os.environ.get("RUN_DATABASE_TESTS") != "1", reason="requires explicit approved local database opt-in")
TABLES = {"owners", "transactions", "subscriptions", "budget_profiles", "preferences"}


@pytest.fixture(scope="module")
def engine():
    settings = Settings()
    url = make_url(settings.database_url.get_secret_value())
    assert (url.drivername, url.host, url.port, url.database) == ("postgresql+psycopg", "127.0.0.1", 5434, "finance_dashboard"), "Refusing unapproved database target"
    value = create_database_engine(settings)
    try:
        with value.connect() as connection:
            connection.execute(text("SET TRANSACTION READ ONLY"))
            assert connection.scalar(text("SELECT current_database()")) == "finance_dashboard"
            assert set(inspect(connection).get_table_names(schema="public")) == TABLES | {"alembic_version"}
            assert connection.execute(text("SELECT version_num FROM alembic_version")).scalars().all() == ["0002_models"]
            for table in TABLES:
                assert connection.scalar(text(f'SELECT count(*) FROM "{table}"')) == 0, "Requires empty local business tables; never deletes existing rows"
        yield value
        with value.connect() as connection:
            for table in TABLES:
                assert connection.scalar(text(f'SELECT count(*) FROM "{table}"')) == 0, "Test writes escaped rollback"
    finally:
        value.dispose()


@pytest.fixture
def api(engine):
    owner_id = uuid4()
    settings = Settings(SINGLE_OWNER_ID=owner_id)
    app = create_app(settings)
    with engine.connect() as connection:
        outer = connection.begin()
        session = Session(bind=connection, join_transaction_mode="create_savepoint", expire_on_commit=False)
        def override():
            with Session(bind=connection, join_transaction_mode="create_savepoint", expire_on_commit=False) as request_session:
                yield request_session
        app.dependency_overrides[get_session] = override
        try:
            with TestClient(app) as client:
                yield client, session, owner_id
        finally:
            session.close()
            outer.rollback()


def tx(**changes):
    return dict(title="Lunch", amount_usd="12.12345678", type="expense", category="Food", transaction_date="2026-10-24") | changes


def sub(**changes):
    return dict(service_name="Music", amount_usd="10.12345678", next_payment_date="2026-11-01") | changes


def post(client, resource, body):
    response = client.post(f"/api/v1/{resource}", json=body)
    assert response.status_code == 201, response.text
    result = response.json()
    assert "owner_id" not in result
    return result


def test_transaction_crud_decimal_precision_and_missing_ids(api):
    client, session, owner_id = api
    created = post(client, "transactions", tx())
    assert created["amount_usd"] == "12.12345678"
    assert created["transaction_date"] == "2026-10-24"
    assert created["created_at"].endswith(("Z", "+00:00"))
    url = f'/api/v1/transactions/{created["id"]}'
    assert client.get(url).json() == created
    changed = client.patch(url, json={"title": "Dinner", "amount_usd": "999999999999.99999999"})
    assert changed.status_code == 200, changed.text
    assert changed.json()["amount_usd"] == "999999999999.99999999"
    assert changed.json()["category"] == "Food"
    assert session.get(Transaction, UUID(created["id"])) is not None
    session.commit()
    response = client.delete(url)
    assert response.status_code == 204 and response.content == b""
    for method in (client.get, client.patch, client.delete):
        kwargs = {"json": {"title": "Missing"}} if method == client.patch else {}
        assert method(url, **kwargs).status_code == 404
    assert client.get("/api/v1/transactions/not-a-uuid").status_code == 422


def test_scope_foreign_ids_and_full_dashboard_aggregation(api):
    client, session, owner_id = api
    foreign = Owner()
    session.add(foreign); session.flush()
    foreign_tx = Transaction(owner_id=foreign.id, **(tx(amount_usd=Decimal("999"), transaction_date=date(2026,10,24))))
    foreign_sub = Subscription(owner_id=foreign.id, **(sub(amount_usd=Decimal("999"), next_payment_date=date(2026,11,1))))
    session.add_all([foreign_tx, foreign_sub]); session.commit()
    for resource, obj in [("transactions", foreign_tx), ("subscriptions", foreign_sub)]:
        url = f"/api/v1/{resource}/{obj.id}"
        assert client.get(url).status_code == 404
        assert client.patch(url, json={"amount_usd": "1"}).status_code == 404
        assert client.delete(url).status_code == 404
        assert client.get(f"/api/v1/{resource}").json()["total"] == 0
    post(client, "transactions", tx(amount_usd="100", type="income", category="Salary"))
    post(client, "transactions", tx(amount_usd="0.00000001"))
    post(client, "transactions", tx(amount_usd="2.12345678", category="Travel"))
    assert len(client.get("/api/v1/transactions?limit=1").json()["items"]) == 1
    data = client.get("/api/v1/dashboard").json()
    assert data["transaction_count"] == 3
    assert data["income_usd"] == "100.00000000"
    assert data["expenses_usd"] == "2.12345679"
    assert data["balance_usd"] == "97.87654321"
    assert {row["category"]: row["amount_usd"] for row in data["expense_by_category"]} == {"Food": "0.00000001", "Travel": "2.12345678"}


def test_server_filters_sort_and_pagination(api):
    client, _, _ = api
    for amount, title, kind, category, day in [("3", "Alpha", "expense", "Food", "2026-10-20"), ("1", "Beta", "income", "Pay", "2026-10-21"), ("2", "Alpha two", "expense", "Food", "2026-10-22")]:
        post(client, "transactions", tx(amount_usd=amount, title=title, type=kind, category=category, transaction_date=day))
    data = client.get("/api/v1/transactions?sort_by=amount_usd&sort_direction=asc&limit=1&offset=1").json()
    assert data["total"] == 3 and data["limit"] == 1 and data["offset"] == 1
    assert data["items"][0]["amount_usd"] == "2.00000000"
    filtered = client.get("/api/v1/transactions?type=expense&category=Food&q=Alpha&date_from=2026-10-21&date_to=2026-10-22").json()
    assert filtered["total"] == 1 and filtered["items"][0]["title"] == "Alpha two"
    default = client.get("/api/v1/transactions").json()
    assert default["limit"] == 50 and default["offset"] == 0
    assert client.get("/api/v1/transactions?limit=100").status_code == 200


def test_subscription_crud_summary_status_filters(api):
    client, _, _ = api
    first = post(client, "subscriptions", sub())
    paused = post(client, "subscriptions", sub(service_name="Video", amount_usd="99", status="paused", next_payment_date="2026-12-01"))
    data = client.get("/api/v1/subscriptions?status=active&date_to=2026-11-01&sort_by=amount_usd&sort_direction=desc").json()
    assert data["total"] == 1 and data["items"][0]["id"] == first["id"]
    summary = client.get("/api/v1/subscriptions/summary")
    assert summary.status_code == 200
    assert summary.json() == {"active_count": 1, "paused_count": 1, "monthly_cost_usd": "10.12345678"}
    url = f'/api/v1/subscriptions/{first["id"]}'
    assert client.get(url).json()["status"] == "active"
    assert client.patch(url, json={"amount_usd": "0", "status": "paused"}).json()["amount_usd"] == "0.00000000"
    assert client.delete(url).status_code == 204
    assert client.get(url).status_code == 404
    assert client.get(f'/api/v1/subscriptions/{paused["id"]}').status_code == 200


def test_singleton_defaults_partial_updates_and_validation_atomicity(api):
    client, session, owner_id = api
    # Ordinary read operations do not persist an owner.
    assert client.get("/api/v1/dashboard").status_code == 200
    assert client.get("/api/v1/transactions").json()["total"] == 0
    assert session.get(Owner, owner_id) is None
    session.commit()
    budget = client.get("/api/v1/budget")
    assert budget.status_code == 200
    for field in ("monthly_income_usd", "needs_spent_usd", "wants_spent_usd", "savings_usd"):
        assert budget.json()[field] == "0.00000000"
    changed = client.patch("/api/v1/budget", json={"monthly_income_usd": "100.12345678", "savings_usd": "1"})
    assert changed.status_code == 200
    assert changed.json()["needs_spent_usd"] == "0.00000000"
    assert client.get("/api/v1/preferences").json()["display_currency"] == "USD"
    assert client.patch("/api/v1/preferences", json={"display_currency": "KZT"}).status_code == 200
    before = client.get("/api/v1/budget").json()
    assert client.patch("/api/v1/budget", json={"savings_usd": "-1", "monthly_income_usd": "2"}).status_code == 422
    assert client.get("/api/v1/budget").json() == before
    assert client.get("/api/v1/preferences").json()["display_currency"] == "KZT"
    assert client.get("/api/v1/transactions").json()["total"] == 0


def test_tied_sort_is_stable_across_pages_and_queries_do_not_change_totals(api):
    client, _, _ = api
    ids = [post(client, "transactions", tx(title=f"Tie {index}", amount_usd="1"))["id"] for index in range(3)]
    pages = [client.get(f"/api/v1/transactions?sort_by=amount_usd&sort_direction=desc&limit=1&offset={index}").json() for index in range(3)]
    assert [page["items"][0]["id"] for page in pages] == sorted(ids)
    assert [page["total"] for page in pages] == [3, 3, 3]
    assert client.get("/api/v1/transactions?offset=999").json()["items"] == []


def test_invalid_create_does_not_bootstrap_owner_and_valid_followup_succeeds(api):
    client, session, owner_id = api
    assert client.post("/api/v1/transactions", json=tx(amount_usd="0.000000001")).status_code == 422
    assert session.get(Owner, owner_id) is None
    session.commit()
    created = post(client, "transactions", tx(amount_usd="0.00000001"))
    assert created["amount_usd"] == "0.00000001"
    assert client.get("/api/v1/dashboard").json()["transaction_count"] == 1


def test_database_unique_conflict_rolls_back_owner_and_allows_followup(api, monkeypatch):
    from app.services import finance
    client, session, owner_id = api
    foreign = Owner()
    session.add(foreign); session.flush()
    existing = Transaction(owner_id=foreign.id, **tx(amount_usd=Decimal("1"), transaction_date=date(2026, 10, 24)))
    session.add(existing); session.flush()
    duplicate_id = existing.id
    session.commit()
    original = finance.create_record
    def conflicting(database_session, model, selected_owner, values):
        return original(database_session, model, selected_owner, values | {"id": duplicate_id})
    with monkeypatch.context() as context:
        context.setattr(finance, "create_record", conflicting)
        response = client.post("/api/v1/transactions", json=tx())
    assert response.status_code == 409, response.text
    assert "INSERT" not in response.text and str(duplicate_id) not in response.text
    assert session.get(Owner, owner_id) is None
    session.commit()
    assert post(client, "transactions", tx())["amount_usd"] == "12.12345678"
    assert client.get("/api/v1/dashboard").json()["transaction_count"] == 1


def test_database_check_failure_rolls_back_bootstrap_owner(api, monkeypatch):
    from app.services import finance
    client, session, owner_id = api
    original = finance.create_record
    def invalid_after_validation(database_session, model, selected_owner, values):
        return original(database_session, model, selected_owner, values | {"type": "invalid"})
    with monkeypatch.context() as context:
        context.setattr(finance, "create_record", invalid_after_validation)
        response = client.post("/api/v1/transactions", json=tx())
    assert response.status_code == 422, response.text
    assert "INSERT" not in response.text and "ck_transactions" not in response.text
    assert session.get(Owner, owner_id) is None
    session.commit()
    assert post(client, "transactions", tx())["amount_usd"] == "12.12345678"


def test_search_literals_do_not_broaden_owner_scoped_results(api):
    client, session, _ = api
    percent = post(client, "transactions", tx(title="100% literal"))
    underscore = post(client, "transactions", tx(title="under_score"))
    injection = "' OR 1=1 --"
    sql_text = post(client, "transactions", tx(title=injection))
    post(client, "transactions", tx(title="Ordinary"))
    foreign = Owner()
    session.add(foreign); session.flush()
    session.add(Transaction(owner_id=foreign.id, **tx(title="100% under_score " + injection, amount_usd=Decimal("99"), transaction_date=date(2026, 10, 24))))
    session.commit()
    for query, expected in [("%", percent["id"]), ("_", underscore["id"]), (injection, sql_text["id"])]:
        result = client.get("/api/v1/transactions", params={"q": query}).json()
        assert result["total"] == 1
        assert result["items"][0]["id"] == expected
