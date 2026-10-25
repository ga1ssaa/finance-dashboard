"""Strict version-one preview input and summary-only output contracts."""

from datetime import datetime
from decimal import Decimal
import re
from typing import Annotated, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, StrictInt, StrictStr, WithJsonSchema

from app.schemas import Category, Currency, FinancialDate, Icon, SubscriptionStatus, Title, TransactionType, parse_money


MAX_TRANSACTIONS = 10000
MAX_SUBSCRIPTIONS = 1000
FIXED_MONEY_PATTERN = r"^[0-9]{1,12}\.[0-9]{8}$"
UTC_TIMESTAMP_PATTERN = r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?(?:Z|\+00:00)$"


def strict_text(value):
    if type(value) is not str:
        raise ValueError("A string is required")
    try:
        value.encode("utf-8", errors="strict")
    except UnicodeError:
        raise ValueError("Valid Unicode is required") from None
    if "\x00" in value:
        raise ValueError("NUL characters are not permitted")
    return value


def fixed_money(value):
    value = strict_text(value)
    if re.fullmatch(FIXED_MONEY_PATTERN, value) is None:
        raise ValueError("An unsigned eight-decimal money string is required")
    return parse_money(value)


def strict_utc_timestamp(value):
    value = strict_text(value)
    if re.fullmatch(UTC_TIMESTAMP_PATTERN, value) is None:
        raise ValueError("A UTC timestamp is required")
    datetime.fromisoformat(value.replace("Z", "+00:00"))
    return value  # Preserve the validated metadata; do not normalize offsets.


ImportMoney = Annotated[Decimal, BeforeValidator(fixed_money), WithJsonSchema({"type": "string", "pattern": FIXED_MONEY_PATTERN})]
ImportTitle = Annotated[Title, BeforeValidator(strict_text)]
ImportCategory = Annotated[Category, BeforeValidator(strict_text)]
ImportIcon = Annotated[Icon, BeforeValidator(strict_text)]
ImportDate = Annotated[FinancialDate, BeforeValidator(strict_text)]
ImportTime = Annotated[StrictStr, BeforeValidator(strict_utc_timestamp), WithJsonSchema({"type": "string", "format": "date-time", "pattern": UTC_TIMESTAMP_PATTERN})]


class PreviewModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, hide_input_in_errors=True)


class ImportPreviewRequest(PreviewModel):
    mode: Literal["replace"]
    source_format: Literal["v1"]
    document: StrictStr


class ImportTransaction(PreviewModel):
    title: ImportTitle
    amount_usd: Annotated[ImportMoney, Field(gt=0)]
    type: TransactionType
    category: ImportCategory
    transaction_date: ImportDate


class ImportSubscription(PreviewModel):
    service_name: ImportTitle
    amount_usd: ImportMoney
    next_payment_date: ImportDate
    icon: ImportIcon
    status: SubscriptionStatus


class ImportBudget(PreviewModel):
    monthly_income_usd: ImportMoney
    needs_spent_usd: ImportMoney
    wants_spent_usd: ImportMoney
    savings_usd: ImportMoney


class ImportPreferences(PreviewModel):
    display_currency: Currency


class ImportData(PreviewModel):
    transactions: list[ImportTransaction] = Field(max_length=MAX_TRANSACTIONS)
    subscriptions: list[ImportSubscription] = Field(max_length=MAX_SUBSCRIPTIONS)
    budget: ImportBudget | None
    preferences: ImportPreferences | None


class ImportDocument(PreviewModel):
    format: Literal["finance-dashboard"]
    schema_version: StrictInt = Field(ge=1, le=1)
    exported_at: ImportTime
    base_currency: Literal["USD"]
    data: ImportData


class PreviewCounts(PreviewModel):
    transactions: int = Field(ge=0)
    subscriptions: int = Field(ge=0)
    budget_profiles: int = Field(ge=0, le=1)
    preferences: int = Field(ge=0, le=1)


class PreviewSource(PreviewModel):
    format: Literal["finance-dashboard"]
    schema_version: Literal[1]
    exported_at: ImportTime
    base_currency: Literal["USD"]
    counts: PreviewCounts


class PreviewCurrent(PreviewModel):
    counts: PreviewCounts


class ReplacementImpact(PreviewModel):
    would_remove: PreviewCounts
    would_create: PreviewCounts


class PreviewWarning(PreviewModel):
    code: Literal["PREVIEW_ONLY", "REPLACE_ALL_DATA", "RESET_ALL_DATA", "EMPTY_SOURCE", "BUDGET_ABSENT", "PREFERENCES_ABSENT"]
    message: str


class ImportPreviewResponse(PreviewModel):
    validation_status: Literal["valid"]
    document_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    source: PreviewSource
    current: PreviewCurrent
    replacement_impact: ReplacementImpact
    warnings: list[PreviewWarning]
