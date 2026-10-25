"""Application factory with separate liveness and database readiness endpoints."""

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError, OperationalError, SQLAlchemyError, TimeoutError

from app.api.finance import router as finance_router
from app.api.auth import router as auth_router
from app.api.data import router as data_router
from app.auth import AuthProtectionMiddleware, AuthRateLimiter
from app.config import Settings
from app.db import create_database_engine, create_session_factory


def create_app(settings: Settings | None = None) -> FastAPI:
    configured_settings = settings if settings is not None else Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if configured_settings.app_env == "production":
            raise RuntimeError("Production startup requires a distributed authentication limiter and an approved proxy contract")
        engine = create_database_engine(configured_settings)
        app.state.engine = engine
        app.state.session_factory = create_session_factory(engine)
        try:
            yield
        finally:
            engine.dispose()

    app = FastAPI(title="Finance Dashboard API", lifespan=lifespan)
    app.add_middleware(AuthProtectionMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(configured_settings.cors_allowed_origins),
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["Content-Type", "Authorization", "X-CSRF-Protection"],
    )
    app.state.settings = configured_settings
    app.state.auth_rate_limiter = AuthRateLimiter()
    app.include_router(finance_router)
    app.include_router(auth_router)
    app.include_router(data_router)

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request: Request, exc: RequestValidationError) -> JSONResponse:
        # Pydantic's input/ctx can contain plaintext passwords or other secrets.
        return JSONResponse(status_code=422, content={"detail": [
            {"loc": list(error["loc"]), "msg": error["msg"], "type": error["type"]}
            for error in exc.errors()
        ]})

    @app.exception_handler(IntegrityError)
    async def integrity_error(request: Request, exc: IntegrityError) -> JSONResponse:
        sqlstate = getattr(exc.orig, "sqlstate", None)
        if sqlstate in {"23505", "23503"}:
            return JSONResponse(status_code=409, content={"detail": "Record conflicts with stored data"})
        if sqlstate in {"23514", "23502"}:
            return JSONResponse(status_code=422, content={"detail": "Data violates a storage constraint"})
        return JSONResponse(status_code=500, content={"detail": "Database operation failed"})

    @app.exception_handler(SQLAlchemyError)
    async def database_error(request: Request, exc: SQLAlchemyError) -> JSONResponse:
        if isinstance(exc, (OperationalError, TimeoutError)) or (
            isinstance(exc, DBAPIError) and exc.connection_invalidated
        ):
            return JSONResponse(status_code=503, content={"detail": "Database unavailable"})
        return JSONResponse(status_code=500, content={"detail": "Database operation failed"})

    @app.get("/api/v1/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/v1/health/ready", response_model=None)
    def readiness() -> JSONResponse:
        try:
            with app.state.engine.connect() as connection:
                connection.execute(text("SELECT 1"))
        except SQLAlchemyError:
            return JSONResponse(status_code=503, content={"status": "not_ready"})
        return JSONResponse(content={"status": "ready"})

    return app
