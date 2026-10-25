"""Authenticated financial export. No archive, import, reset or filesystem work."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from sqlalchemy.exc import DBAPIError, OperationalError, SQLAlchemyError, TimeoutError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.finance import OwnerDependency
from app.export_schemas import ExportDocument
from app.services.data_export import ExportDataInvalid, ExportTooLarge, export_owner_data


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
                                        content={"detail": "Database unavailable" if unavailable else "Export unavailable"})
            except Exception:
                response = JSONResponse(status_code=500, content={"detail": "Export unavailable"})
            response.headers.update(PRIVATE_HEADERS)
            return response

        return private_handler


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
