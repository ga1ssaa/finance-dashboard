"""Full owner financial-state hashing, with bounded row buffering and no writes."""

from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal
import hashlib
import json
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.exc import SQLAlchemyError

from app.data_operation_errors import unavailable
from app.import_preview_schemas import PreviewCounts
from app.models import BudgetProfile, DataOperationReceipt, Preferences, Subscription, Transaction


REVISION = "0004_data_operations"
STATE_TABLES = (("transactions", Transaction), ("subscriptions", Subscription),
                ("budget_profiles", BudgetProfile), ("preferences", Preferences))


@dataclass(frozen=True)
class DataState:
    counts: PreviewCounts
    sha256: str


def require_data_schema(connection):
    try:
        revisions = connection.execute(text("SELECT version_num FROM public.alembic_version ORDER BY version_num")).scalars().all()
        if revisions not in ([REVISION], ["0005_auth_rate_limits"]):
            raise unavailable()
        # References every required receipt column without reading any receipt.
        result = connection.execute(select(*DataOperationReceipt.__table__.columns).limit(0))
        result.close()
    except SQLAlchemyError:
        raise unavailable() from None


def _canonical(value):
    if isinstance(value, Decimal):
        if not value.is_finite() or value.as_tuple().exponent < -8:
            raise ValueError("Financial state is unavailable")
        return ["decimal8", format(value.copy_abs() if value.is_zero() else value, ".8f")]
    if isinstance(value, datetime):
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("Financial state is unavailable")
        return ["timestamp_utc", value.astimezone(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")]
    if type(value) is date:
        return ["date", value.isoformat()]
    if type(value) is UUID:
        return ["uuid", str(value)]
    if value is None:
        return ["null"]
    if type(value) in (str, int, bool):
        return [{str: "str", int: "int", bool: "bool"}[type(value)], value]
    raise ValueError("Financial state is unavailable")


def _frame(digest, values):
    raw = json.dumps([_canonical(value) for value in values], ensure_ascii=False,
                     separators=(",", ":"), allow_nan=False).encode("utf-8")
    digest.update(len(raw).to_bytes(8, "big"))
    digest.update(raw)


def read_owner_state(connection, owner_id) -> DataState:
    digest = hashlib.sha256(b"finance-dashboard:financial-state:v1\x00")
    _frame(digest, ["owner", owner_id])
    counts = {}
    for name, model in STATE_TABLES:
        _frame(digest, ["table", name])
        statement = select(*model.__table__.columns).where(model.owner_id == owner_id).order_by(model.id.asc()).execution_options(yield_per=100)
        result = connection.execute(statement)
        count = 0
        try:
            for row in result:
                _frame(digest, list(row))
                count += 1
        finally:
            result.close()
        _frame(digest, ["count", count])  # Absence is part of the fingerprint.
        counts[name] = count
    return DataState(counts=PreviewCounts(**counts), sha256=digest.hexdigest())


def read_preview_state(engine, owner_id) -> DataState:
    with engine.connect() as connection:
        transaction = connection.begin()
        try:
            connection.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"))
            require_data_schema(connection)
            return read_owner_state(connection, owner_id)
        finally:
            transaction.rollback()
