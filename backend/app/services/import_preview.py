"""Bounded strict parsing and a rollback-only owner-count preview, never import."""

from dataclasses import dataclass
import hashlib
import json

from pydantic import ValidationError
from sqlalchemy import func, select, text

from app.import_preview_schemas import (
    MAX_SUBSCRIPTIONS, MAX_TRANSACTIONS, ImportDocument, ImportPreviewRequest,
    ImportPreviewResponse, PreviewCounts,
)
from app.models import BudgetProfile, Preferences, Subscription, Transaction


MAX_REQUEST_BYTES = 10 * 1024 * 1024
MAX_DOCUMENT_BYTES = 5 * 1024 * 1024
MAX_JSON_DEPTH = 8
MAX_JSON_TOKENS = 150000
MAX_INTEGER_CHARACTERS = 32


class PreviewInvalid(RuntimeError):
    pass


class PreviewTooLarge(RuntimeError):
    pass


@dataclass(frozen=True)
class ParsedPreviewRequest:
    document: ImportDocument
    document_sha256: str


def _reject_number(_value):
    # Version one has only one numeric field, the integer schema version.
    raise PreviewInvalid("Invalid preview document")


def _bounded_integer(value):
    if len(value) > MAX_INTEGER_CHARACTERS:
        raise PreviewInvalid("Invalid preview document")
    return int(value)


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise PreviewInvalid("Invalid preview document")
        result[key] = value
    return result


def _check_depth(source):
    depth = 0
    tokens = 0
    quoted = False
    escaped = False
    atom = False
    for char in source:
        if quoted:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                quoted = False
        elif char == '"':
            quoted = True
            atom = False
            tokens += 1
        elif char in "[{":
            atom = False
            tokens += 1
            depth += 1
            if depth > MAX_JSON_DEPTH:
                raise PreviewInvalid("Invalid preview document")
        elif char in "]}":
            atom = False
            depth -= 1
            if depth < 0:
                raise PreviewInvalid("Invalid preview document")
        elif char in ",: \t\r\n":
            atom = False
        elif not atom:
            atom = True
            tokens += 1
        if tokens > MAX_JSON_TOKENS:
            raise PreviewInvalid("Invalid preview document")
    if depth or quoted:
        raise PreviewInvalid("Invalid preview document")


def _load_json(raw):
    source = raw.decode("utf-8", errors="strict")
    _check_depth(source)  # Before recursive JSON decoding, not after it.
    return json.loads(source, object_pairs_hook=_unique_object,
                      parse_int=_bounded_integer, parse_float=_reject_number, parse_constant=_reject_number)


def parse_preview_request(raw_body: bytes) -> ParsedPreviewRequest:
    if type(raw_body) is not bytes:
        raise PreviewInvalid("Invalid preview document")
    if len(raw_body) > MAX_REQUEST_BYTES:
        raise PreviewTooLarge("Preview exceeds supported limits")
    try:
        request = ImportPreviewRequest.model_validate(_load_json(raw_body))
        document_bytes = request.document.encode("utf-8", errors="strict")
        if len(document_bytes) > MAX_DOCUMENT_BYTES:
            raise PreviewTooLarge("Preview exceeds supported limits")
        value = _load_json(document_bytes)
        if isinstance(value, dict) and isinstance(value.get("data"), dict):
            for key, maximum in (("transactions", MAX_TRANSACTIONS), ("subscriptions", MAX_SUBSCRIPTIONS)):
                rows = value["data"].get(key)
                if isinstance(rows, list) and len(rows) > maximum:
                    raise PreviewTooLarge("Preview exceeds supported limits")
        document = ImportDocument.model_validate(value)
        return ParsedPreviewRequest(document=document, document_sha256=hashlib.sha256(document_bytes).hexdigest())
    except (ValidationError, ValueError, TypeError, UnicodeError, RecursionError):
        # Never expose Pydantic loc/input/ctx or JSON decoder messages: unknown
        # key names and embedded strings can themselves contain private data.
        raise PreviewInvalid("Invalid preview document") from None


def preview_owner_import(engine, owner_id, raw_body: bytes) -> ImportPreviewResponse:
    parsed = parse_preview_request(raw_body)  # Entire validation before connect.
    source_data = parsed.document.data
    source = PreviewCounts(transactions=len(source_data.transactions), subscriptions=len(source_data.subscriptions),
                           budget_profiles=int(source_data.budget is not None), preferences=int(source_data.preferences is not None))
    with engine.connect() as connection:
        transaction = connection.begin()
        try:
            connection.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"))
            counts = {}
            for name, model in (("transactions", Transaction), ("subscriptions", Subscription),
                                ("budget_profiles", BudgetProfile), ("preferences", Preferences)):
                count = connection.scalar(select(func.count()).select_from(model).where(model.owner_id == owner_id))
                if type(count) is not int or count < 0 or name in {"budget_profiles", "preferences"} and count > 1:
                    raise RuntimeError("Current financial counts are unavailable")
                counts[name] = count
            current = PreviewCounts(**counts)
        finally:
            transaction.rollback()
    warnings = [
        {"code": "PREVIEW_ONLY", "message": "This is a validation preview; no financial data has been changed."},
        {"code": "REPLACE_ALL_DATA", "message": "A future replacement would replace all financial data in the signed-in account."},
    ]
    if not any(source.model_dump().values()):
        warnings.append({"code": "EMPTY_SOURCE", "message": "The document contains no financial records."})
    if source.budget_profiles == 0 and current.budget_profiles == 1:
        warnings.append({"code": "BUDGET_ABSENT", "message": "The document has no budget; replacement would remove the current budget."})
    if source.preferences == 0 and current.preferences == 1:
        warnings.append({"code": "PREFERENCES_ABSENT", "message": "The document has no preferences; replacement would remove the current preferences."})
    return ImportPreviewResponse(
        validation_status="valid", document_sha256=parsed.document_sha256,
        source={"format": parsed.document.format, "schema_version": parsed.document.schema_version,
                "exported_at": parsed.document.exported_at, "base_currency": parsed.document.base_currency, "counts": source},
        current={"counts": current}, replacement_impact={"would_remove": current, "would_create": source}, warnings=warnings,
    )
