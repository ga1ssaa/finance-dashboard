"""Owner export tests using fake connections only; never opens PostgreSQL."""
from copy import deepcopy
from datetime import date, datetime, timezone
from decimal import Decimal
import json
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.dialects import postgresql

from app.auth import AuthenticatedUser, get_current_user
from app.config import Settings


@pytest.fixture(autouse=True)
def no_live_database(monkeypatch):
    import psycopg
    monkeypatch.setattr(psycopg, "connect", MagicMock(side_effect=AssertionError("Database access forbidden in offline export tests")))


OWNER = UUID("3ce6492e-90a2-4ea8-acb7-7dc6d9689a88")
OTHER = UUID("de54208c-9f61-4c5f-a7bd-e57985bd4603")


def transaction_row(number=0, **changes):
    return dict(title=f"Export {number}", amount_usd=Decimal("999999999999.99999999"), type="income", category="Synthetic", transaction_date=date(2026, 10, 25)) | changes


def subscription_row(**changes):
    return dict(service_name="Synthetic", amount_usd=Decimal("0.00000001"), next_payment_date=date(2026, 11, 1), icon="credit-card", status="active") | changes

class FakeRow(dict):
    @property
    def _mapping(self):
        return self


class FakeResult:
    def __init__(self, rows=(), scalar=None):
        self.rows, self.value = list(rows), scalar
    def __iter__(self):
        return iter(self.rows)
    def mappings(self):
        return self
    def all(self):
        return self.rows
    def first(self):
        return self.rows[0] if self.rows else None
    def one_or_none(self):
        from sqlalchemy.exc import MultipleResultsFound
        if len(self.rows)>1:
            raise MultipleResultsFound("Synthetic duplicate singleton")
        return self.first()
    def scalar_one(self):
        return self.value
    def scalar(self):
        return self.value
    def close(self):
        pass


class FakeEngine:
    """Evaluate SELECT scoping/projections without any DB driver or ORM session."""
    def __init__(self, records=None, counts=None):
        self.records = records or {}
        self.counts = counts or {}
        self.events, self.statements = [], []
        self.readonly = False
        self.tx = MagicMock()
        self.tx.rollback.side_effect = lambda: self.events.append("rollback")
        self.connection = MagicMock()
        self.connection.begin.side_effect = lambda: self.events.append("begin") or self.tx
        self.connection.execute.side_effect = self.execute
        self.connection.scalar.side_effect = lambda statement: self.execute(statement).scalar_one()
        self.connection.close.side_effect = lambda: self.events.append("close")
        self.connection.__enter__.return_value = self.connection
        self.connection.__exit__.side_effect = lambda *args: self.connection.close()
        self.connect = MagicMock(side_effect=lambda: self.events.append("connect") or self.connection)
    def execute(self, statement, *args, **kwargs):
        sql = str(statement.compile(dialect=postgresql.dialect()))
        self.events.append(sql)
        if sql.startswith("SET TRANSACTION"):
            assert not self.statements, "READ ONLY must precede every query"
            assert "REPEATABLE READ" in sql and "READ ONLY" in sql
            self.readonly = True
            return FakeResult()
        assert self.readonly, "Data query before read-only snapshot"
        assert sql.startswith("SELECT "), "Export must execute no DML"
        self.statements.append(statement)
        tables = [table.name for table in statement.get_final_froms()]
        assert len(tables) == 1
        table = tables[0]
        params = statement.compile().params
        records = self.records.get(table, [])
        # An absent owner predicate deliberately returns foreign rows too.
        owner_values = [value for value in params.values() if isinstance(value, UUID)]
        if owner_values:
            records = [row for row in records if row.get("owner_id") in owner_values]
        if "count(" in sql:
            return FakeResult(scalar=self.counts.get(table, len(records)))
        for ordering in reversed(list(statement._order_by_clauses)):
            name = ordering.element.name if hasattr(ordering, "element") else ordering.name
            records = sorted(records, key=lambda row: row[name])
        limit = statement._limit_clause.value if statement._limit_clause is not None else None
        if limit is not None:
            records = records[:limit]
        names = [column.key for column in statement.selected_columns]
        return FakeResult([FakeRow({name: row[name] for name in names}) for row in records])


def owned(row, number=1, owner=OWNER):
    return dict(id=UUID(int=number), owner_id=owner, created_at=datetime.now(timezone.utc), updated_at=datetime.now(timezone.utc), **row)


def export(engine, **kwargs):
    from app.services.data_export import export_owner_data
    return export_owner_data(engine, OWNER, exported_at=datetime(2026, 10, 25, 1, 2, 3, tzinfo=timezone.utc), **kwargs)


def test_empty_export_is_null_without_singleton_or_owner_bootstrap():
    engine = FakeEngine()
    raw, observed = export(engine)
    value = json.loads(raw)
    assert set(value) == {"format", "schema_version", "exported_at", "base_currency", "data"}
    assert value["data"] == {"transactions": [], "subscriptions": [], "budget": None, "preferences": None}
    assert value["base_currency"] == "USD" and value["schema_version"] == 1
    assert observed == datetime(2026, 10, 25, 1, 2, 3, tzinfo=timezone.utc)
    assert value["exported_at"].endswith("Z")
    assert engine.events[0:2] == ["connect", "begin"]
    assert engine.events[2] == "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"
    assert engine.events[-2:] == ["rollback", "close"]
    engine.tx.commit.assert_not_called()
    assert all(table.name != "owners" for statement in engine.statements for table in statement.get_final_froms())


def test_export_projects_only_owner_business_fields_and_preserves_usd_precision():
    records = {
        "transactions": [owned(transaction_row()), owned(transaction_row(title="FOREIGN PRIVATE"), 2, OTHER)],
        "subscriptions": [owned(subscription_row()), owned(subscription_row(service_name="FOREIGN PRIVATE"), 2, OTHER)],
        "budget_profiles": [owned(dict(monthly_income_usd=Decimal("0.00000001"), needs_spent_usd=Decimal("2"), wants_spent_usd=Decimal("3"), savings_usd=Decimal("4")))],
        "preferences": [owned(dict(display_currency="EUR"))],
    }
    engine = FakeEngine(records)
    raw, _ = export(engine)
    value = json.loads(raw)
    assert "FOREIGN PRIVATE" not in raw.decode()
    assert value["data"]["transactions"] == [dict(title="Export 0", amount_usd="999999999999.99999999", type="income", category="Synthetic", transaction_date="2026-10-25")]
    assert value["data"]["subscriptions"][0]["amount_usd"] == "0.00000001"
    assert value["data"]["budget"]["monthly_income_usd"] == "0.00000001"
    assert value["data"]["budget"]["needs_spent_usd"] == "2.00000000"
    assert value["data"]["preferences"] == {"display_currency": "EUR"}
    for table_records in (value["data"]["transactions"],value["data"]["subscriptions"],[value["data"]["budget"]],[value["data"]["preferences"]]):
        for row in table_records:
            assert not {"id", "owner_id", "user_id", "created_at", "updated_at", "password_hash", "access_token"} & row.keys()
    for statement in engine.statements:
        sql = str(statement.compile(dialect=postgresql.dialect()))
        assert ".owner_id = " in sql and OWNER in statement.compile().params.values()
        assert "owner_id" not in [column.key for column in statement.selected_columns]


def test_full_dataset_beyond_page_limits_uses_deterministic_date_and_id_order():
    records = [owned(transaction_row(number), number+1) for number in reversed(range(125))]
    records[0]["transaction_date"] = date(2026, 10, 26)
    engine = FakeEngine({"transactions": records})
    value = json.loads(export(engine)[0])
    assert len(value["data"]["transactions"]) == 125
    assert value["data"]["transactions"][0]["title"] == "Export 0"
    assert value["data"]["transactions"][-1]["transaction_date"] == "2026-10-26"
    for statement in engine.statements:
        if "count(" not in str(statement) and statement.get_final_froms()[0].name in {"transactions", "subscriptions"}:
            sql = str(statement.compile(dialect=postgresql.dialect()))
            assert "ORDER BY" in sql and ".id ASC" in sql
            assert "OFFSET" not in sql


@pytest.mark.parametrize("table,count", [("transactions",10001),("subscriptions",1001)])
def test_over_record_limits_fails_before_loading_rows_and_rolls_back(table,count):
    from app.services.data_export import ExportTooLarge
    engine = FakeEngine(counts={table:count})
    with pytest.raises(ExportTooLarge): export(engine)
    assert all("count(" in str(statement) for statement in engine.statements)
    engine.tx.rollback.assert_called_once_with()
    engine.tx.commit.assert_not_called()
    assert engine.events[-1] == "close"


@pytest.mark.parametrize("table,count", [("transactions",10000),("subscriptions",1000)])
def test_exact_record_limits_are_accepted_in_full(table,count):
    row = transaction_row() if table == "transactions" else subscription_row()
    engine = FakeEngine({table:[owned(row, number+1) for number in range(count)]})
    value = json.loads(export(engine)[0])
    assert len(value["data"][table]) == count


def test_serialized_utf8_limit_uses_bytes_and_never_returns_truncated_export(monkeypatch):
    import app.services.data_export as service
    engine = FakeEngine({"transactions":[owned(transaction_row(title="😀"*20))]})
    raw, _ = export(engine)
    assert len(raw) > len(raw.decode())
    monkeypatch.setattr(service,"MAX_EXPORT_BYTES",len(raw))
    assert export(FakeEngine(engine.records))[0] == raw
    monkeypatch.setattr(service,"MAX_EXPORT_BYTES",len(raw)-1)
    with pytest.raises(service.ExportTooLarge): export(FakeEngine(engine.records))


def test_query_failure_closes_snapshot_without_commit():
    engine = FakeEngine()
    original = engine.execute
    def fail(statement,*args,**kwargs):
        if str(statement).startswith("SELECT"): raise RuntimeError("synthetic query failure")
        return original(statement,*args,**kwargs)
    engine.connection.execute.side_effect=fail
    with pytest.raises(RuntimeError): export(engine)
    engine.tx.rollback.assert_called_once_with()
    engine.tx.commit.assert_not_called()
    assert engine.events[-1] == "close"

@pytest.fixture
def api(monkeypatch):
    import app.api.data as route
    import app.main as application
    engine = MagicMock()
    monkeypatch.setattr(application, "create_database_engine", lambda _: engine)
    configured = Settings(_env_file=None, DATABASE_URL="postgresql+psycopg://test:unused@127.0.0.1:65432/unused")
    app = application.create_app(configured)
    user = AuthenticatedUser(id=uuid4(), email="synthetic@example.test", owner_id=OWNER)
    app.dependency_overrides[get_current_user] = lambda: user
    with TestClient(app) as client:
        yield SimpleNamespace(client=client, engine=engine, route=route, app=app)


def assert_private(response):
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["pragma"] == "no-cache"
    assert response.headers["x-content-type-options"] == "nosniff"


def test_unauthenticated_export_never_calls_service_or_acquires_connection(api,monkeypatch):
    service = MagicMock(side_effect=AssertionError("Unauthenticated export must not run"))
    monkeypatch.setattr(api.route,"export_owner_data",service)
    api.app.dependency_overrides.clear()
    response = api.client.get("/api/v1/data/export")
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"
    assert_private(response)
    service.assert_not_called()
    api.engine.connect.assert_not_called()


def test_route_delivers_complete_attachment_only_for_authenticated_server_owner(api,monkeypatch):
    raw, stamp = export(FakeEngine())
    service = MagicMock(return_value=(raw,stamp))
    monkeypatch.setattr(api.route,"export_owner_data",service)
    response = api.client.get("/api/v1/data/export")
    assert response.status_code == 200 and response.content == raw
    assert response.headers["content-type"] == "application/json"
    assert response.headers["content-disposition"] == 'attachment; filename="finance-dashboard-v1-20261025T010203Z.json"'
    assert_private(response)
    service.assert_called_once_with(api.engine,OWNER)
    api.engine.connect.assert_not_called()


@pytest.mark.parametrize("path,body",[("?owner_id="+str(OTHER),None),("?limit=1",None),("?currency=EUR",None),("",b"{}")])
def test_export_rejects_scope_filters_and_get_bodies_before_service(api,monkeypatch,path,body):
    service=MagicMock()
    monkeypatch.setattr(api.route,"export_owner_data",service)
    response=api.client.request("GET","/api/v1/data/export"+path,content=body)
    assert response.status_code==422
    assert_private(response)
    service.assert_not_called()


@pytest.mark.parametrize("failure,status",[("too_large",413),("invalid",500),("database",503),("unknown",500)])
def test_export_errors_are_private_sanitized_and_have_no_partial_download(api,monkeypatch,failure,status):
    from app.services.data_export import ExportTooLarge,ExportDataInvalid
    from sqlalchemy.exc import OperationalError
    failures={"too_large":ExportTooLarge("sensitive synthetic marker"),"invalid":ExportDataInvalid("sensitive synthetic marker"),"database":OperationalError(None,None,Exception("sensitive synthetic marker")),"unknown":RuntimeError("sensitive synthetic marker")}
    monkeypatch.setattr(api.route,"export_owner_data",MagicMock(side_effect=failures[failure]))
    response=api.client.get("/api/v1/data/export")
    assert response.status_code==status
    assert_private(response)
    assert "content-disposition" not in response.headers
    assert "transactions" not in response.json() and "sensitive synthetic marker" not in response.text


def test_openapi_export_exposes_only_business_contract_and_no_write_routes(api):
    schema=api.client.get("/openapi.json").json()
    path=schema["paths"]["/api/v1/data/export"]
    assert set(path)=={"get"}
    assert path["get"]["security"]
    assert "413" in path["get"]["responses"]
    for name in ("ExportDocument","ExportData","ExportTransaction","ExportSubscription","ExportBudget","ExportPreferences"):
        definition=schema["components"]["schemas"][name]
        assert definition["additionalProperties"] is False
        assert not {"id","owner_id","user_id","created_at","updated_at","password_hash","access_token"} & definition["properties"].keys()
    data_paths={key:value for key,value in schema["paths"].items() if key.startswith("/api/v1/data/")}
    assert set(data_paths)=={"/api/v1/data/export","/api/v1/data/import/preview","/api/v1/data/reset/preview","/api/v1/data/import","/api/v1/data/reset","/api/v1/data/operations/{key}"}
    assert set(data_paths["/api/v1/data/import/preview"])=={"post"}


@pytest.mark.parametrize("value",[Decimal("NaN"),Decimal("Infinity"),Decimal("-1"),Decimal("1.000000001"),Decimal("1000000000000"),1.5,True])
def test_invalid_stored_money_fails_closed_without_rounding_or_output(value):
    from app.services.data_export import ExportDataInvalid
    engine=FakeEngine({"transactions":[owned(transaction_row(amount_usd=value))]})
    with pytest.raises(ExportDataInvalid): export(engine)
    engine.tx.rollback.assert_called_once_with()
    engine.tx.commit.assert_not_called()


def test_export_calendar_dates_and_utc_timestamp_are_not_display_conversions():
    from app.services.data_export import export_owner_data
    from datetime import timedelta
    engine=FakeEngine({"transactions":[owned(transaction_row(transaction_date=date(2026,1,1)))]})
    raw,stamp=export_owner_data(engine,OWNER,exported_at=datetime(2026,1,1,1,0,tzinfo=timezone(timedelta(hours=5))))
    value=json.loads(raw)
    assert value["exported_at"]=="2025-12-31T20:00:00Z"
    assert stamp.tzinfo==timezone.utc
    assert value["data"]["transactions"][0]["transaction_date"]=="2026-01-01"


def test_actual_five_mib_cap_is_exact_and_future_ten_mib_envelope_not_accepted():
    from app.services.data_export import BoundedJSON,ExportTooLarge,MAX_EXPORT_BYTES
    assert MAX_EXPORT_BYTES==5*1024*1024
    writer=BoundedJSON()
    writer.append(b"x"*MAX_EXPORT_BYTES)
    assert len(writer.content)==MAX_EXPORT_BYTES
    with pytest.raises(ExportTooLarge): writer.append(b"x")
    assert len(writer.content)==MAX_EXPORT_BYTES
    with pytest.raises(ExportTooLarge): BoundedJSON().append(b"x"*(10*1024*1024))


@pytest.mark.parametrize("count",[None,True,-1,"1"])
def test_invalid_driver_count_stops_snapshot_before_export(count):
    from app.services.data_export import ExportDataInvalid
    engine=FakeEngine(counts={"transactions":count})
    with pytest.raises(ExportDataInvalid): export(engine)
    engine.tx.rollback.assert_called_once_with()


def test_count_underreport_cannot_truncate_records_silently(monkeypatch):
    import app.services.data_export as service
    monkeypatch.setattr(service,"MAX_TRANSACTIONS",2)
    engine=FakeEngine({"transactions":[owned(transaction_row(n),n+1) for n in range(3)]},counts={"transactions":2})
    with pytest.raises(service.ExportTooLarge): export(engine)
    statement=next(stmt for stmt in engine.statements if "count(" not in str(stmt))
    assert statement._limit_clause.value==3
    assert statement.get_execution_options()["yield_per"]==100
    engine.tx.rollback.assert_called_once_with()


def test_duplicate_singleton_never_selects_arbitrary_record_or_commits():
    from sqlalchemy.exc import MultipleResultsFound
    engine=FakeEngine({"preferences":[owned({"display_currency":"USD"}),owned({"display_currency":"EUR"},2)]})
    with pytest.raises(MultipleResultsFound): export(engine)
    engine.tx.rollback.assert_called_once_with()
    engine.tx.commit.assert_not_called()
    assert engine.events[-1]=="close"


def test_get_body_without_length_header_is_rejected_without_accumulating_it():
    import asyncio
    from fastapi import HTTPException
    from app.api.data import validate_export_request
    consumed=[]
    async def chunks():
        consumed.append("first")
        yield b"unexpected"
        consumed.append("second")
        raise AssertionError("Do not consume an unbounded GET body")
    request=SimpleNamespace(query_params={},headers={},stream=chunks)
    with pytest.raises(HTTPException) as caught:
        asyncio.run(validate_export_request(request))
    assert caught.value.status_code==422
    assert consumed==["first"]


def test_export_document_roundtrip_has_no_reinterpretation_or_extra_fields():
    from app.export_schemas import ExportDocument
    from pydantic import ValidationError
    raw,_=export(FakeEngine({"transactions":[owned(transaction_row())]}))
    value=ExportDocument.model_validate_json(raw)
    assert json.loads(value.model_dump_json())==json.loads(raw)
    payload=json.loads(raw)
    payload["data"]["transactions"][0]["owner_id"]=str(OTHER)
    with pytest.raises(ValidationError): ExportDocument.model_validate(payload)


def test_signed_zero_budget_and_subscription_are_canonical_unsigned_strings():
    from app.export_schemas import ExportBudget, ExportSubscription
    zero=Decimal("-0.00000000")
    budget=ExportBudget(monthly_income_usd=zero,needs_spent_usd=zero,wants_spent_usd=zero,savings_usd=zero)
    assert set(json.loads(budget.model_dump_json()).values())=={"0.00000000"}
    subscription=ExportSubscription.model_validate(subscription_row(amount_usd=zero))
    assert json.loads(subscription.model_dump_json())["amount_usd"]=="0.00000000"
    assert zero.is_signed(), "Canonical serialization must not mutate the supplied Decimal"


def test_signed_zero_still_fails_positive_transaction_rule():
    from app.export_schemas import ExportTransaction
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        ExportTransaction.model_validate(transaction_row(amount_usd=Decimal("-0.00000000")))
