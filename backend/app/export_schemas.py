"""Version-one financial export: business fields only, no account identifiers."""

from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, PlainSerializer, WithJsonSchema

from app.schemas import Category, Currency, Icon, SubscriptionStatus, Title, TransactionType, parse_date, parse_money


MAX_TRANSACTIONS = 10000
MAX_SUBSCRIPTIONS = 1000
MAX_EXPORT_BYTES = 5 * 1024 * 1024
MAX_MONEY = Decimal("999999999999.99999999")


def exact_money(value):
    if isinstance(value, str):
        value = parse_money(value)
    if (not isinstance(value, Decimal) or not value.is_finite()
            or value < 0 or value > MAX_MONEY or value.as_tuple().exponent < -8):
        raise ValueError("Stored money is outside the version-one export contract")
    return value.copy_abs() if value.is_zero() else value


def date_only(value):
    if type(value) is date:
        return value
    return parse_date(value)


def utc_time(value):
    if isinstance(value, str):
        value = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("Export time must be timezone-aware")
    return value.astimezone(timezone.utc)


ExportMoney = Annotated[
    Decimal, BeforeValidator(exact_money),
    PlainSerializer(lambda value: format(value, ".8f"), return_type=str),
    WithJsonSchema({"type": "string", "pattern": r"^[0-9]{1,12}\.[0-9]{8}$"}),
]
ExportDate = Annotated[date, BeforeValidator(date_only)]
ExportTime = Annotated[
    datetime, BeforeValidator(utc_time),
    PlainSerializer(lambda value: value.isoformat().replace("+00:00", "Z"), return_type=str),
    WithJsonSchema({"type": "string", "format": "date-time"}),
]


class ExportModel(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)


class ExportTransaction(ExportModel):
    title: Title
    amount_usd: Annotated[ExportMoney, Field(gt=0)]
    type: TransactionType
    category: Category
    transaction_date: ExportDate


class ExportSubscription(ExportModel):
    service_name: Title
    amount_usd: ExportMoney
    next_payment_date: ExportDate
    icon: Icon
    status: SubscriptionStatus


class ExportBudget(ExportModel):
    monthly_income_usd: ExportMoney
    needs_spent_usd: ExportMoney
    wants_spent_usd: ExportMoney
    savings_usd: ExportMoney


class ExportPreferences(ExportModel):
    display_currency: Currency


class ExportData(ExportModel):
    transactions: list[ExportTransaction] = Field(max_length=MAX_TRANSACTIONS)
    subscriptions: list[ExportSubscription] = Field(max_length=MAX_SUBSCRIPTIONS)
    budget: ExportBudget | None
    preferences: ExportPreferences | None


class ExportDocument(ExportModel):
    format: Literal["finance-dashboard"] = "finance-dashboard"
    schema_version: Literal[1] = 1
    exported_at: ExportTime
    base_currency: Literal["USD"] = "USD"
    data: ExportData
