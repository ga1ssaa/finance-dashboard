"""Public API contracts; monetary JSON values are exact decimal strings."""

import re
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from pydantic import (
    BaseModel, BeforeValidator, ConfigDict, Field, PlainSerializer,
    WithJsonSchema, model_validator,
)


MONEY_PATTERN = r"^[0-9]{1,12}(?:\.[0-9]{1,8})?$"
POSITIVE_MONEY_PATTERN = r"^(?=[0-9.]*[1-9])[0-9]{1,12}(?:\.[0-9]{1,8})?$"


def parse_money(value: object) -> Decimal:
    if not isinstance(value, str) or not re.fullmatch(MONEY_PATTERN, value):
        raise ValueError("Money must be a nonnegative decimal string with up to 12 integer and 8 fractional digits")
    integer = value.split(".", 1)[0].lstrip("0")
    if len(integer) > 12:
        raise ValueError("Money must have at most 12 integer digits")
    return Decimal(value)


def parse_date(value: object) -> date:
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
        raise ValueError("Date must use YYYY-MM-DD")
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise ValueError("Date must be a valid calendar date") from None


def no_nul(value: object) -> str:
    if not isinstance(value, str) or "\x00" in value:
        raise ValueError("Text must be a string without NUL characters")
    return value


def nonblank(value: object) -> str:
    value = no_nul(value)
    if not value.strip():
        raise ValueError("Text must contain a non-whitespace character")
    return value


MoneyInput = Annotated[
    Decimal, BeforeValidator(parse_money),
    WithJsonSchema({"type": "string", "pattern": MONEY_PATTERN, "examples": ["12.50000000"]}),
]
PositiveMoneyInput = Annotated[
    MoneyInput, Field(gt=0),
    WithJsonSchema({"type": "string", "pattern": POSITIVE_MONEY_PATTERN, "examples": ["12.50000000"]}),
]
MoneyOutput = Annotated[Decimal, PlainSerializer(lambda value: format(value, ".8f"), return_type=str),
                        WithJsonSchema({"type": "string", "pattern": r"^-?[0-9]+\.[0-9]{8}$"})]
FinancialDate = Annotated[date, BeforeValidator(parse_date),
                         WithJsonSchema({"type": "string", "format": "date"})]
Title = Annotated[str, BeforeValidator(nonblank), Field(max_length=255)]
Category = Annotated[str, BeforeValidator(nonblank), Field(max_length=100)]
Icon = Annotated[str, BeforeValidator(nonblank), Field(max_length=64)]
TransactionType = Literal["income", "expense"]
SubscriptionStatus = Literal["active", "paused"]
Currency = Literal["USD", "KZT", "EUR", "RUB"]
AuditTime = Annotated[datetime, PlainSerializer(
    lambda value: value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"), return_type=str
)]


class RequestModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


def patch_json_schema(schema: dict) -> None:
    """Omission is allowed for PATCH fields; explicit null is not."""
    schema["minProperties"] = 1
    for field_schema in schema.get("properties", {}).values():
        variants = field_schema.get("anyOf")
        if variants is not None:
            nonnull = [variant for variant in variants if variant.get("type") != "null"]
            if len(nonnull) == 1:
                field_schema.pop("anyOf")
                field_schema.update(nonnull[0])
            else:
                field_schema["anyOf"] = nonnull
        if field_schema.get("default", ...) is None:
            field_schema.pop("default")


class PatchModel(RequestModel):
    model_config = ConfigDict(extra="forbid", json_schema_extra=patch_json_schema)

    @model_validator(mode="before")
    @classmethod
    def nonempty_without_nulls(cls, value):
        if isinstance(value, dict):
            if not value:
                raise ValueError("At least one field is required")
            if any(item is None for item in value.values()):
                raise ValueError("Explicit null values are not allowed")
        return value


class TransactionCreate(RequestModel):
    title: Title
    amount_usd: PositiveMoneyInput
    type: TransactionType
    category: Category
    transaction_date: FinancialDate


class TransactionPatch(PatchModel):
    title: Title | None = None
    amount_usd: PositiveMoneyInput | None = None
    type: TransactionType | None = None
    category: Category | None = None
    transaction_date: FinancialDate | None = None


class SubscriptionCreate(RequestModel):
    service_name: Title
    amount_usd: MoneyInput
    next_payment_date: FinancialDate
    icon: Icon = "credit-card"
    status: SubscriptionStatus = "active"


class SubscriptionPatch(PatchModel):
    service_name: Title | None = None
    amount_usd: MoneyInput | None = None
    next_payment_date: FinancialDate | None = None
    icon: Icon | None = None
    status: SubscriptionStatus | None = None


class BudgetPatch(PatchModel):
    monthly_income_usd: MoneyInput | None = None
    needs_spent_usd: MoneyInput | None = None
    wants_spent_usd: MoneyInput | None = None
    savings_usd: MoneyInput | None = None


class PreferencesPatch(PatchModel):
    display_currency: Currency | None = None


class ResponseModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class AuditResponse(ResponseModel):
    id: UUID
    created_at: AuditTime
    updated_at: AuditTime


class TransactionResponse(AuditResponse):
    title: str
    amount_usd: MoneyOutput
    type: TransactionType
    category: str
    transaction_date: date


class SubscriptionResponse(AuditResponse):
    service_name: str
    amount_usd: MoneyOutput
    next_payment_date: date
    icon: str
    status: SubscriptionStatus


class BudgetResponse(AuditResponse):
    monthly_income_usd: MoneyOutput
    needs_spent_usd: MoneyOutput
    wants_spent_usd: MoneyOutput
    savings_usd: MoneyOutput


class PreferencesResponse(AuditResponse):
    display_currency: Currency


class TransactionPage(ResponseModel):
    items: list[TransactionResponse]
    total: int
    limit: int
    offset: int


class SubscriptionPage(ResponseModel):
    items: list[SubscriptionResponse]
    total: int
    limit: int
    offset: int


class SubscriptionSummary(ResponseModel):
    active_count: int
    paused_count: int
    monthly_cost_usd: MoneyOutput


class ExpenseCategory(ResponseModel):
    category: str
    amount_usd: MoneyOutput


class DashboardResponse(ResponseModel):
    income_usd: MoneyOutput
    expenses_usd: MoneyOutput
    balance_usd: MoneyOutput
    transaction_count: int
    expense_by_category: list[ExpenseCategory]


class DateRange(RequestModel):
    date_from: FinancialDate | None = None
    date_to: FinancialDate | None = None

    @model_validator(mode="after")
    def ordered_dates(self):
        if self.date_from and self.date_to and self.date_from > self.date_to:
            raise ValueError("date_from must be on or before date_to")
        return self


class PageQuery(DateRange):
    limit: int = Field(default=50, ge=1, le=100)
    offset: int = Field(default=0, ge=0)
    sort_direction: Literal["asc", "desc"]


class TransactionQuery(PageQuery):
    type: TransactionType | None = None
    category: Category | None = None
    q: Annotated[str, BeforeValidator(no_nul), Field(max_length=255)] | None = None
    sort_by: Literal["transaction_date", "amount_usd", "title", "created_at"] = "transaction_date"
    sort_direction: Literal["asc", "desc"] = "desc"


class SubscriptionQuery(PageQuery):
    status: SubscriptionStatus | None = None
    sort_by: Literal["next_payment_date", "amount_usd", "service_name", "created_at"] = "next_payment_date"
    sort_direction: Literal["asc", "desc"] = "asc"
