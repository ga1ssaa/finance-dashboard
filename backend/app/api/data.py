"""Authenticated financial export. No archive, import, reset or filesystem work."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from sqlalchemy.exc import DBAPIError, OperationalError, SQLAlchemyError, TimeoutError
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.finance import OwnerDependency
from app.export_schemas import ExportDocument
from app.import_preview_schemas import ImportPreviewRequest, ImportPreviewResponse
from app.services.data_export import ExportDataInvalid, ExportTooLarge, export_owner_data
from app.services.import_preview import MAX_REQUEST_BYTES, PreviewInvalid, PreviewTooLarge, preview_owner_import


PRIVATE_HEADERS = {"Cache-Control": "no-store", "Pragma": "no-cache", "X-Content-Type-Options": "nosniff"}


class PrivateExportRoute(APIRoute):
    """Include privacy headers even when auth/dependency validation rejects."""

    def get_route_handler(self):
        handler = super().get_route_handler()

        async def private_handler(request):
            try:
                response = await handler(request)
            except StarletteHTTPException as error:
                error.headers = {**(error.headers or {}), **PRIVATE_HEADERS}
                raise
            except RequestValidationError as error:
                response = JSONResponse(status_code=422, content={"detail": [
                    {"loc": list(item["loc"]), "msg": item["msg"], "type": item["type"]} for item in error.errors()
                ]})
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
    return "Import preview unavailable" if request.url.path.endswith("/import/preview") else "Export unavailable"


router = APIRouter(prefix="/api/v1/data", tags=["data"], route_class=PrivateExportRoute)


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


@router.post("/import/preview", response_model=ImportPreviewResponse,
             responses={413: {"description": "Preview exceeds supported limits"}},
             openapi_extra={"requestBody": {"required": True, "content": {"application/json": {
                 "schema": ImportPreviewRequest.model_json_schema(),
             }}}})
async def import_preview(request: Request, owner_id: OwnerDependency):
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
        return await run_in_threadpool(preview_owner_import, request.app.state.engine, owner_id, bytes(raw_body))
    except PreviewTooLarge:
        raise HTTPException(status_code=413, detail="Preview exceeds supported limits") from None
    except PreviewInvalid:
        raise HTTPException(status_code=422, detail="Invalid import preview document") from None
