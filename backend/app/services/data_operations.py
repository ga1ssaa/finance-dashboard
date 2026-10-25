"""Owner-serialized replacement/reset with atomic, permanent operation receipts."""

from datetime import datetime, timezone
import hashlib
import json
from uuid import UUID, uuid4

from pydantic import ValidationError
from sqlalchemy import delete, select, text
from sqlalchemy.exc import IntegrityError

from app.auth import password_matches, utcnow
from app.data_authorization import EMPTY_DOCUMENT_SHA256, issue_preview_token, require_session_identity, validate_preview_token
from app.data_operation_errors import DataOperationError, invalid_preview, session_invalid
from app.data_operation_schemas import DataOperationResult, ImportApplyRequest, ResetPreviewRequest, ResetPreviewResponse, ResetRequest
from app.import_preview_schemas import PreviewCounts
from app.models import AuthSession, BudgetProfile, DataOperationReceipt, Preferences, Subscription, Transaction, User
from app.services.data_state import read_owner_state, read_preview_state, require_data_schema
from app.services.finance import lock_owner
from app.services.import_preview import MAX_REQUEST_BYTES, PreviewInvalid, PreviewTooLarge, _load_json, parse_document


def semantic_request_sha256(kind, document_sha256=None):
    if kind == "import_replace":
        value = {"kind": kind, "mode": "replace", "source_format": "v1", "document_sha256": document_sha256}
    elif kind == "reset":
        value = {"kind": kind, "scope": "financial-data-v1"}
    else:
        raise ValueError("Unsupported operation")
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _parse_request(raw_body, model):
    if type(raw_body) is not bytes:
        raise DataOperationError(422, "INVALID_REQUEST", "Invalid data operation request")
    if len(raw_body) > MAX_REQUEST_BYTES:
        raise DataOperationError(413, "REQUEST_TOO_LARGE", "Request exceeds supported limits")
    try:
        return model.model_validate(_load_json(raw_body))
    except (PreviewInvalid, ValidationError, ValueError, TypeError, UnicodeError, RecursionError):
        raise DataOperationError(422, "INVALID_REQUEST", "Invalid data operation request") from None


def _active_user(session, user, *, after_dml=False):
    statement = select(User).join(AuthSession, AuthSession.user_id == User.id).where(
        User.id == user.id, User.owner_id == user.owner_id, AuthSession.id == user.session_id,
        AuthSession.revoked_at.is_(None), AuthSession.expires_at > utcnow(),
    ).with_for_update(read=True, of=AuthSession).execution_options(populate_existing=True)
    result = session.scalar(statement)
    if result is None:
        raise invalid_preview() if after_dml else session_invalid()
    return result


def _receipt_result(receipt):
    # Materialize before rollback: never trigger an expired ORM attribute load.
    result = DataOperationResult.model_validate_json(json.dumps(receipt.result_json, separators=(",", ":")))
    if (result.idempotency_key != receipt.idempotency_key or result.operation != receipt.kind
            or (result.operation == "reset") != (result.document_sha256 is None)
            or semantic_request_sha256(result.operation, result.document_sha256) != receipt.request_sha256):
        raise DataOperationError(500, "DATA_OPERATION_FAILED", "Recorded operation is unavailable")
    return result


def _execute(session, user, settings, request, key, kind, parsed=None):
    require_session_identity(user)
    if type(key) is not UUID:
        raise DataOperationError(422, "INVALID_REQUEST", "A UUID idempotency key is required")
    doc_sha = parsed.document_sha256 if parsed is not None else None
    semantic = semantic_request_sha256(kind, doc_sha)
    transaction = session.begin()
    try:
        # READ COMMITTED is deliberate: state reads occur AFTER any owner-lock wait.
        session.execute(text("SET TRANSACTION ISOLATION LEVEL READ COMMITTED"))
        session.execute(text("SET LOCAL lock_timeout = '5s'"))
        session.execute(text("SET LOCAL statement_timeout = '60s'"))
        lock_owner(session, user.owner_id)
        authenticated = _active_user(session, user)
        require_data_schema(session.connection())
        receipt = session.scalar(select(DataOperationReceipt).where(
            DataOperationReceipt.owner_id == user.owner_id, DataOperationReceipt.idempotency_key == key))
        if receipt is not None:
            if receipt.request_sha256 != semantic:
                raise DataOperationError(409, "IDEMPOTENCY_CONFLICT", "Idempotency key is bound to a different request")
            result = _receipt_result(receipt)
            transaction.rollback()
            return result
        claim = validate_preview_token(settings, request.preview_token.get_secret_value(), user, kind,
                                       doc_sha if doc_sha is not None else EMPTY_DOCUMENT_SHA256)
        used = session.scalar(select(DataOperationReceipt.idempotency_key).where(
            DataOperationReceipt.owner_id == user.owner_id, DataOperationReceipt.preview_id == UUID(claim["jti"])))
        if used is not None:
            raise DataOperationError(409, "PREVIEW_USED", "Preview authorization has already been used")
        confirmation = "REPLACE MY FINANCIAL DATA" if kind == "import_replace" else "RESET MY FINANCIAL DATA"
        if request.confirmation != confirmation or not password_matches(authenticated.password_hash, request.password.get_secret_value()):
            raise DataOperationError(403, "CONFIRMATION_FAILED", "Password or typed confirmation is invalid")
        before = read_owner_state(session.connection(), user.owner_id)
        validate_preview_token(settings, request.preview_token.get_secret_value(), user, kind,
                               doc_sha if doc_sha is not None else EMPTY_DOCUMENT_SHA256, state_sha256=before.sha256)
        # Only these four owner-filtered tables may be deleted. Namespace,
        # credentials, auth sessions and all operation receipts are preserved.
        for model in (Transaction, Subscription, BudgetProfile, Preferences):
            session.execute(delete(model).where(model.owner_id == user.owner_id).execution_options(synchronize_session=False))
        created = PreviewCounts(transactions=0, subscriptions=0, budget_profiles=0, preferences=0)
        if parsed is not None:
            data = parsed.document.data
            for model, records in ((Transaction, data.transactions), (Subscription, data.subscriptions)):
                for record in records:
                    session.add(model(id=uuid4(), owner_id=user.owner_id, **record.model_dump()))
            if data.budget is not None:
                session.add(BudgetProfile(id=uuid4(), owner_id=user.owner_id, **data.budget.model_dump()))
            if data.preferences is not None:
                session.add(Preferences(id=uuid4(), owner_id=user.owner_id, **data.preferences.model_dump()))
            created = PreviewCounts(transactions=len(data.transactions), subscriptions=len(data.subscriptions),
                                    budget_profiles=int(data.budget is not None), preferences=int(data.preferences is not None))
        session.flush()
        completed = datetime.now(timezone.utc)
        result = DataOperationResult(idempotency_key=key, operation=kind, status="completed", completed_at=completed,
                                     document_sha256=doc_sha, removed=before.counts, created=created)
        result_json = result.model_dump(mode="json")
        session.add(DataOperationReceipt(owner_id=user.owner_id, idempotency_key=key, preview_id=UUID(claim["jti"]),
                                        kind=kind, request_sha256=semantic, result_json=result_json, completed_at=completed))
        session.flush()
        _active_user(session, user, after_dml=True)
        validate_preview_token(settings, request.preview_token.get_secret_value(), user, kind,
                               doc_sha if doc_sha is not None else EMPTY_DOCUMENT_SHA256, state_sha256=before.sha256)
    except BaseException as error:
        try:
            transaction.rollback()
        except BaseException:
            raise DataOperationError(503, "OPERATION_OUTCOME_UNKNOWN", "Operation outcome is unknown; check its status") from None
        if isinstance(error, IntegrityError) and getattr(error.orig, "sqlstate", None) == "23505":
            constraint = getattr(getattr(error.orig, "diag", None), "constraint_name", None)
            if constraint == "uq_data_operation_receipts_owner_preview":
                raise DataOperationError(409, "PREVIEW_USED", "Preview authorization has already been used") from None
            if constraint == "pk_data_operation_receipts":
                raise DataOperationError(409, "IDEMPOTENCY_CONFLICT", "Idempotency key is already recorded") from None
        raise
    try:
        transaction.commit()
    except BaseException:
        raise DataOperationError(503, "OPERATION_OUTCOME_UNKNOWN", "Operation outcome is unknown; check its status") from None
    return result


def apply_import(session, user, settings, raw_body, idempotency_key):
    request = _parse_request(raw_body, ImportApplyRequest)
    try:
        parsed = parse_document(request.document)
    except PreviewTooLarge:
        raise DataOperationError(413, "REQUEST_TOO_LARGE", "Request exceeds supported limits") from None
    except PreviewInvalid:
        raise DataOperationError(422, "INVALID_REQUEST", "Invalid data operation request") from None
    return _execute(session, user, settings, request, idempotency_key, "import_replace", parsed)


def reset_data(session, user, settings, raw_body, idempotency_key):
    request = _parse_request(raw_body, ResetRequest)
    return _execute(session, user, settings, request, idempotency_key, "reset")


def preview_reset(engine, user, settings, raw_body):
    require_session_identity(user)
    _parse_request(raw_body, ResetPreviewRequest)
    state = read_preview_state(engine, user.owner_id)
    token, expires = issue_preview_token(settings, user, "reset", EMPTY_DOCUMENT_SHA256, state.sha256)
    zero = PreviewCounts(transactions=0, subscriptions=0, budget_profiles=0, preferences=0)
    return ResetPreviewResponse(validation_status="valid", current={"counts": state.counts},
                                replacement_impact={"would_remove": state.counts, "would_create": zero},
                                warnings=[{"code": "PREVIEW_ONLY", "message": "No financial data has been changed."},
                                          {"code": "RESET_ALL_DATA", "message": "Reset would remove all financial data in the signed-in account."}],
                                preview_token=token, expires_at=expires)


def get_operation(engine, user, key):
    require_session_identity(user)
    if type(key) is not UUID:
        raise DataOperationError(422, "INVALID_REQUEST", "A UUID operation key is required")
    with engine.connect() as connection:
        transaction = connection.begin()
        try:
            connection.execute(text("SET TRANSACTION READ ONLY"))
            require_data_schema(connection)
            row = connection.execute(select(DataOperationReceipt.idempotency_key, DataOperationReceipt.kind,
                                            DataOperationReceipt.request_sha256, DataOperationReceipt.result_json).where(
                DataOperationReceipt.owner_id == user.owner_id, DataOperationReceipt.idempotency_key == key)).one_or_none()
            if row is None:
                raise DataOperationError(404, "OPERATION_NOT_OBSERVED", "No completed operation has been observed; the outcome may still be unknown")
            return _receipt_result(row)
        finally:
            transaction.rollback()
