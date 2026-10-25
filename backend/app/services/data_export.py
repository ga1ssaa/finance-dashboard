"""Bounded owner-only export from one dedicated, rollback-only read snapshot."""

from datetime import datetime, timezone
import json
from uuid import UUID

from pydantic import ValidationError
from sqlalchemy import func, select, text

from app.export_schemas import (
    MAX_EXPORT_BYTES, MAX_SUBSCRIPTIONS, MAX_TRANSACTIONS, ExportBudget,
    ExportPreferences, ExportSubscription, ExportTransaction, utc_time,
)
from app.models import BudgetProfile, Preferences, Subscription, Transaction


class ExportTooLarge(RuntimeError):
    pass


class ExportDataInvalid(RuntimeError):
    pass


class BoundedJSON:
    """A complete response buffer, never an HTTP stream or an unbounded list."""

    def __init__(self):
        self.content = bytearray()

    def append(self, fragment: bytes):
        if len(self.content) + len(fragment) > MAX_EXPORT_BYTES:
            raise ExportTooLarge("Export exceeds the supported size")
        self.content.extend(fragment)


def _rows(connection, writer, statement, model, maximum):
    writer.append(b"[")
    result = connection.execute(statement.execution_options(yield_per=100))
    try:
        for index, row in enumerate(result.mappings()):
            if index >= maximum:
                raise ExportTooLarge("Export exceeds the supported record count")
            if index:
                writer.append(b",")
            writer.append(model.model_validate(dict(row)).model_dump_json().encode("utf-8"))
    finally:
        result.close()
    writer.append(b"]")


def _singleton(connection, writer, statement, model):
    result = connection.execute(statement.limit(2))
    try:
        row = result.mappings().one_or_none()
        writer.append(b"null" if row is None else model.model_validate(dict(row)).model_dump_json().encode("utf-8"))
    finally:
        result.close()


def export_owner_data(engine, owner_id: UUID, *, exported_at=None) -> tuple[bytes, datetime]:
    """Caller supplies the authenticated owner; no client-selected scope exists."""
    try:
        with engine.connect() as connection:
            transaction = connection.begin()
            try:
                # First application SQL in this transaction: no pool-wide GUCs.
                connection.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"))
                stamp = utc_time(exported_at if exported_at is not None else datetime.now(timezone.utc))
                for table, maximum in ((Transaction, MAX_TRANSACTIONS), (Subscription, MAX_SUBSCRIPTIONS)):
                    count = connection.scalar(select(func.count()).select_from(table).where(table.owner_id == owner_id))
                    if type(count) is not int or count < 0:
                        raise ExportDataInvalid("Export count is unavailable")
                    if count > maximum:
                        raise ExportTooLarge("Export exceeds the supported record count")
                writer = BoundedJSON()
                metadata = {"format": "finance-dashboard", "schema_version": 1,
                            "exported_at": stamp.isoformat().replace("+00:00", "Z"), "base_currency": "USD"}
                writer.append(json.dumps(metadata, separators=(",", ":"), allow_nan=False).encode("utf-8")[:-1])
                writer.append(b',"data":{"transactions":')
                transactions = select(Transaction.title, Transaction.amount_usd, Transaction.type,
                                      Transaction.category, Transaction.transaction_date).where(Transaction.owner_id == owner_id).order_by(
                                          Transaction.transaction_date.asc(), Transaction.id.asc()).limit(MAX_TRANSACTIONS + 1)
                _rows(connection, writer, transactions, ExportTransaction, MAX_TRANSACTIONS)
                writer.append(b',"subscriptions":')
                subscriptions = select(Subscription.service_name, Subscription.amount_usd, Subscription.next_payment_date,
                                       Subscription.icon, Subscription.status).where(Subscription.owner_id == owner_id).order_by(
                                           Subscription.next_payment_date.asc(), Subscription.id.asc()).limit(MAX_SUBSCRIPTIONS + 1)
                _rows(connection, writer, subscriptions, ExportSubscription, MAX_SUBSCRIPTIONS)
                writer.append(b',"budget":')
                budget = select(BudgetProfile.monthly_income_usd, BudgetProfile.needs_spent_usd,
                                BudgetProfile.wants_spent_usd, BudgetProfile.savings_usd).where(BudgetProfile.owner_id == owner_id)
                _singleton(connection, writer, budget, ExportBudget)
                writer.append(b',"preferences":')
                preferences = select(Preferences.display_currency).where(Preferences.owner_id == owner_id)
                _singleton(connection, writer, preferences, ExportPreferences)
                writer.append(b"}}")
                return bytes(writer.content), stamp
            finally:
                transaction.rollback()  # Read-only snapshots never commit.
    except (ValidationError, ValueError, TypeError, UnicodeError):
        raise ExportDataInvalid("Stored data cannot be exported") from None
