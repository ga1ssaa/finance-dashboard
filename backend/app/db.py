"""SQLAlchemy infrastructure; creating an engine does not connect to PostgreSQL."""

from collections.abc import Iterator

from fastapi import Request
from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import Settings


class Base(DeclarativeBase):
    pass


def create_database_engine(settings: Settings) -> Engine:
    return create_engine(
        settings.database_url.get_secret_value(),
        connect_args={"connect_timeout": 3},
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
