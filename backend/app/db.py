"""SQLAlchemy infrastructure; creating an engine does not connect to PostgreSQL."""

from collections.abc import Iterator

from fastapi import Request
from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import Settings


class Base(DeclarativeBase):
    pass


def create_database_engine(settings: Settings) -> Engine:
    production = settings.app_env == "production"
    return create_engine(
        settings.database_url.get_secret_value(),
        connect_args={"connect_timeout": 3, **({"sslmode": "verify-full", "sslrootcert": settings.database_sslrootcert, "ssl_min_protocol_version": "TLSv1.2", "options": "-csearch_path=public"} if production else {})},
        **({"pool_size": 3, "max_overflow": 0, "pool_recycle": 300} if production else {}),
        pool_pre_ping=True,
        pool_timeout=3,
        hide_parameters=True,
        echo=False,
    )


def create_session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, expire_on_commit=False)


def get_session(request: Request) -> Iterator[Session]:
    """Yield one session per request; business services decide when to commit."""
    with request.app.state.session_factory() as session:
        yield session
