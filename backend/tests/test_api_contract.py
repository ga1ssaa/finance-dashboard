"""HTTP contract checks without connecting to any database."""
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.api.finance import get_owner_id
from app.config import Settings
from app.db import get_session
from app.main import create_app


@pytest.fixture
def client(monkeypatch):
    settings = Settings(_env_file=None, DATABASE_URL="postgresql+psycopg://test:unused@127.0.0.1:65432/test", SINGLE_OWNER_ID=uuid4())
    engine = MagicMock()
    monkeypatch.setattr("app.main.create_database_engine", lambda _: engine)
    app = create_app(settings)
    app.dependency_overrides[get_owner_id] = lambda: uuid4()
    session = MagicMock()
    app.dependency_overrides[get_session] = lambda: session
    with TestClient(app) as value:
        yield value
    engine.connect.assert_not_called()


def payload(**changes):
    return dict(title="Lunch", amount_usd="12.12345678", type="expense", category="Food", transaction_date="2026-10-24") | changes


@pytest.mark.parametrize("changes", [
    {"amount_usd": 12.5}, {"amount_usd": "0"}, {"amount_usd": "-1"},
    {"amount_usd": "NaN"}, {"amount_usd": "Infinity"},
    {"amount_usd": "0.000000001"}, {"amount_usd": "1000000000000"},
    {"title": " \t\n"}, {"category": "\n"}, {"type": "refund"},
    {"transaction_date": "2026-02-30"}, {"transaction_date": "2026-10-24T00:00:00Z"},
    {"owner_id": str(uuid4())}, {"unexpected": "value"},
])
def test_transaction_rejects_invalid_or_unowned_inputs(client, changes):
    assert client.post("/api/v1/transactions", json=payload(**changes)).status_code == 422


@pytest.mark.parametrize("route,body", [
    ("transactions", {}), ("subscriptions", {}),
    ("subscriptions", {"service_name": "X", "amount_usd": "-1", "next_payment_date": "2026-11-01"}),
    ("budget", {"monthly_income_usd": 1.5}),
    ("budget", {"savings_usd": None}),
    ("preferences", {"display_currency": "GBP"}),
    ("preferences", {"owner_id": str(uuid4())}),
])
def test_invalid_resource_bodies(client, route, body):
    method = client.patch if route in {"budget", "preferences"} else client.post
    assert method(f"/api/v1/{route}", json=body).status_code == 422


@pytest.mark.parametrize("resource", ["transactions", "subscriptions"])
@pytest.mark.parametrize("query", ["limit=101", "limit=0", "offset=-1", "sort_direction=sideways", "sort_by=owner_id", "date_from=2026-11-01&date_to=2026-01-01"])
def test_list_rejects_invalid_bounds_and_sort(client, resource, query):
    assert client.get(f"/api/v1/{resource}?{query}").status_code == 422


def test_docs_and_openapi_describe_business_api(client):
    assert client.get("/docs").status_code == 200
    schema = client.get("/openapi.json").json()
    paths = schema["paths"]
    for route in ("transactions", "subscriptions", "subscriptions/summary", "budget", "preferences", "dashboard"):
        assert f"/api/v1/{route}" in paths
    for route in ("transactions", "subscriptions"):
        assert "201" in paths[f"/api/v1/{route}"]["post"]["responses"]
        detail = next(v for k,v in paths.items() if k.startswith(f"/api/v1/{route}/{{"))
        assert "204" in detail["delete"]["responses"]
    # Ownership must never be accepted in a public request body.
    for definition in schema["components"]["schemas"].values():
        assert "owner_id" not in definition.get("properties", {})


@pytest.mark.parametrize("resource,body", [
    ("transactions", payload(owner_id=str(uuid4()))),
    ("subscriptions", {"owner_id": str(uuid4())}),
    ("budget", {}), ("preferences", {}),
    ("budget", {"savings_usd": None}),
])
def test_patch_disallows_owner_empty_and_null(client, resource, body):
    target = f"/api/v1/{resource}"
    if resource in {"transactions", "subscriptions"}:
        target += f"/{uuid4()}"
    assert client.patch(target, json=body).status_code == 422


def test_openapi_money_inputs_are_strings(client):
    schemas = client.get("/openapi.json").json()["components"]["schemas"]
    for name, field in [("TransactionCreate", "amount_usd"), ("SubscriptionCreate", "amount_usd")]:
        money = schemas[name]["properties"][field]
        assert money["type"] == "string"
        assert "pattern" in money


@pytest.mark.parametrize("resource,field", [
    ("transactions", "title"), ("transactions", "category"),
    ("subscriptions", "service_name"), ("subscriptions", "icon"),
])
def test_stored_text_rejects_embedded_nul_before_database(client, resource, field):
    body = payload() if resource == "transactions" else {"service_name": "Music", "amount_usd": "1", "next_payment_date": "2026-11-01"}
    body[field] = "text\x00value"
    assert client.post(f"/api/v1/{resource}", json=body).status_code == 422
    assert client.patch(f"/api/v1/{resource}/{uuid4()}", json={field: body[field]}).status_code == 422


@pytest.mark.parametrize("field", ["q", "category"])
def test_transaction_text_filters_reject_nul(client, field):
    assert client.get("/api/v1/transactions", params={field: "text\x00value"}).status_code == 422


def test_openapi_patch_money_optional_nonnull_and_precise_patterns(client):
    import re
    schemas = client.get("/openapi.json").json()["components"]["schemas"]
    budget = schemas["BudgetPatch"]
    for name in ("monthly_income_usd", "needs_spent_usd", "wants_spent_usd", "savings_usd"):
        money = budget["properties"][name]
        assert name not in budget.get("required", [])
        assert money["type"] == "string"
        assert "anyOf" not in money and "default" not in money
        assert re.fullmatch(money["pattern"], "999999999999.12345678")
        assert not re.fullmatch(money["pattern"], "1000000000000")
        assert not re.fullmatch(money["pattern"], "1.123456789")
    positive = schemas["TransactionCreate"]["properties"]["amount_usd"]["pattern"]
    assert not re.fullmatch(positive, "0.00000000")
    assert re.fullmatch(positive, "0.00000001")
