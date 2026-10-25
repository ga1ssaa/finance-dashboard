"""Authenticated financial export. No archive, import, reset or filesystem work."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from sqlalchemy.exc import DBAPIError, OperationalError, SQLAlchemyError, TimeoutError
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.finance import OwnerDependency
from app.auth import AuthenticatedUser, get_current_user
from app.data_authorization import require_session_identity
from app.data_operation_errors import DataOperationError
from app.data_operation_schemas import AuthorizedImportPreview, DataOperationResult, ImportApplyRequest, ResetPreviewRequest, ResetPreviewResponse, ResetRequest
from app.db import get_session
from app.export_schemas import ExportDocument
from app.import_preview_schemas import ImportPreviewRequest, ImportPreviewResponse
from app.services.data_export import ExportDataInvalid, ExportTooLarge, export_owner_data
from app.services.import_preview import MAX_REQUEST_BYTES, PreviewInvalid, PreviewTooLarge, preview_owner_import
from app.services.data_operations import apply_import, get_operation, preview_reset, reset_data
from sqlalchemy.orm import Session


PRIVATE_HEADERS = {"Cache-Control": "no-store", "Pragma": "no-cache", "X-Content-Type-Options": "nosniff"}


class PrivateExportRoute(APIRoute):
    """Include privacy headers even when auth/dependency validation rejects."""

    def get_route_handler(self):
        handler = super().get_route_handler()

        async def private_handler(request):
            try:
                response = await handler(request)
            except DataOperationError as error:
                headers = {**error.headers}
                if error.status_code == 401:
                    headers["WWW-Authenticate"] = "Bearer"
                response = JSONResponse(status_code=error.status_code, content={"code": error.code, "detail": error.detail}, headers=headers)
            except StarletteHTTPException as error:
                if error.status_code == 401 and request.url.path != "/api/v1/data/export":
                    return JSONResponse(status_code=401, content={"code": "AUTHENTICATION_REQUIRED", "detail": "Authentication required"},
                                        headers={**PRIVATE_HEADERS, "WWW-Authenticate": "Bearer"})
                error.headers = {**(error.headers or {}), **PRIVATE_HEADERS}
                raise
            except RequestValidationError as error:
                if request.url.path == "/api/v1/data/export":
                    response = JSONResponse(status_code=422, content={"detail": [
                        {"loc": list(item["loc"]), "msg": item["msg"], "type": item["type"]} for item in error.errors()
                    ]})
                else:
                    response = JSONResponse(status_code=422, content={"code": "INVALID_REQUEST", "detail": "Invalid data operation request"})
            except SQLAlchemyError as error:
                unavailable = isinstance(error, (OperationalError, TimeoutError)) or isinstance(error, DBAPIError) and error.connection_invalidated
                response = JSONResponse(status_code=503 if unavailable else 500,
                                        content={"detail": "Database unavailable" if unavailable else _unavailable_message(request)})
            except Exception:
                response = JSONResponse(status_code=500, content={"detail": _unavailable_message(request)})
            response.headers.update(PRIVATE_HEADERS)
            return response

        return private_handler


def _unavailable_message(request):
    return "Export unavailable" if request.url.path == "/api/v1/data/export" else "Data operation unavailable"


router = APIRouter(prefix="/api/v1/data", tags=["data"], route_class=PrivateExportRoute)
UserDependency = Annotated[AuthenticatedUser, Depends(get_current_user)]
DataSession = Annotated[Session, Depends(get_session)]


async def validate_export_request(request: Request) -> None:
    if request.query_params or request.headers.get("transfer-encoding") or request.headers.get("content-length", "0") != "0":
        raise HTTPException(status_code=422, detail="Export does not accept parameters or a request body")
    # Inspect a chunk without accumulating a body, including ASGI clients that
    # supply one without Content-Length. Authentication resolves before this.
    async for chunk in request.stream():
        if chunk:
            raise HTTPException(status_code=422, detail="Export does not accept parameters or a request body")


@router.get("/export", response_model=ExportDocument, responses={413: {"description": "Export exceeds supported limits"}})
def export_data(request: Request, owner_id: OwnerDependency, _checked: Annotated[None, Depends(validate_export_request)]):
    try:
        content, stamp = export_owner_data(request.app.state.engine, owner_id)
    except ExportTooLarge:
        raise HTTPException(status_code=413, detail="Export exceeds supported limits") from None
    except ExportDataInvalid:
        raise HTTPException(status_code=500, detail="Export unavailable") from None
    filename = "finance-dashboard-v1-" + stamp.strftime("%Y%m%dT%H%M%SZ") + ".json"
    return Response(content=content, media_type="application/json",
                    headers={**PRIVATE_HEADERS, "Content-Disposition": 'attachment; filename="' + filename + '"'})


@router.post("/import/preview", response_model=AuthorizedImportPreview,
             responses={413: {"description": "Preview exceeds supported limits"}},
             openapi_extra={"requestBody": {"required": True, "content": {"application/json": {
                 "schema": ImportPreviewRequest.model_json_schema(),
             }}}})
async def import_preview(request: Request, user: UserDependency):
    require_session_identity(user)
    if request.query_params:
        raise HTTPException(status_code=422, detail="Preview does not accept query parameters")
    if request.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "application/json":
        raise HTTPException(status_code=415, detail="Preview requires application/json")
    raw_body = bytearray()
    async for chunk in request.stream():
        if len(raw_body) + len(chunk) > MAX_REQUEST_BYTES:
            raise HTTPException(status_code=413, detail="Preview exceeds supported limits")
        raw_body.extend(chunk)
    try:
        return await run_in_threadpool(preview_owner_import, request.app.state.engine, user, bytes(raw_body), settings=request.app.state.settings)
    except PreviewTooLarge:
        raise HTTPException(status_code=413, detail="Preview exceeds supported limits") from None
    except PreviewInvalid:
        raise HTTPException(status_code=422, detail="Invalid import preview document") from None


async def _operation_body(request):
    if request.query_params:
        raise DataOperationError(422, "INVALID_REQUEST", "Query parameters are not accepted")
    if request.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "application/json":
        raise DataOperationError(415, "JSON_REQUIRED", "Content-Type must be application/json")
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > MAX_REQUEST_BYTES:
            raise DataOperationError(413, "REQUEST_TOO_LARGE", "Request exceeds supported limits")
        body.extend(chunk)
    return bytes(body)


def _write_guard(request, user):
    require_session_identity(user)
    settings = request.app.state.settings
    if request.headers.get("origin") not in settings.cors_allowed_origins or request.headers.get("x-csrf-protection") != "1":
        raise DataOperationError(403, "CSRF_REJECTED", "Request origin or CSRF protection is invalid")
    ip = request.client.host if request.client else "unknown"
    retry = request.app.state.auth_rate_limiter.check([
        ("data-write:user:" + str(user.id), 5, 600), ("data-write:ip:" + ip, 10, 600),
    ])
    if retry:
        raise DataOperationError(429, "RATE_LIMITED", "Too many data operation attempts", {"Retry-After": str(retry)})
    try:
        raw_key = request.headers.get("idempotency-key", "")
        key = UUID(raw_key)
        if str(key) != raw_key:
            raise ValueError()
        return key
    except (ValueError, TypeError, AttributeError):
        raise DataOperationError(422, "INVALID_REQUEST", "A canonical UUID Idempotency-Key is required") from None


def _request_schema(model):
    return {"requestBody": {"required": True, "content": {"application/json": {"schema": model.model_json_schema()}}}}


@router.post("/reset/preview", response_model=ResetPreviewResponse, openapi_extra=_request_schema(ResetPreviewRequest))
async def reset_preview(request: Request, user: UserDependency):
    require_session_identity(user)
    raw = await _operation_body(request)
    return await run_in_threadpool(preview_reset, request.app.state.engine, user, request.app.state.settings, raw)


@router.post("/import", response_model=DataOperationResult, openapi_extra=_request_schema(ImportApplyRequest))
async def import_data(request: Request, user: UserDependency, session: DataSession):
    key = _write_guard(request, user)
    raw = await _operation_body(request)
    return await run_in_threadpool(apply_import, session, user, request.app.state.settings, raw, key)


@router.post("/reset", response_model=DataOperationResult, openapi_extra=_request_schema(ResetRequest))
async def reset_financial_data(request: Request, user: UserDependency, session: DataSession):
    key = _write_guard(request, user)
    raw = await _operation_body(request)
    return await run_in_threadpool(reset_data, session, user, request.app.state.settings, raw, key)


@router.get("/operations/{key}", response_model=DataOperationResult)
async def operation_status(request: Request, key: UUID, user: UserDependency):
    require_session_identity(user)
    if request.query_params:
        raise DataOperationError(422, "INVALID_REQUEST", "Query parameters are not accepted")
    async for chunk in request.stream():
        if chunk:
            raise DataOperationError(422, "INVALID_REQUEST", "Request bodies are not accepted")
    return await run_in_threadpool(get_operation, request.app.state.engine, user, key)
