"""Migrations use the same private environment configuration as the API."""

from logging.config import fileConfig

from alembic import context
from sqlalchemy import Connection

import app.models  # noqa: F401 -- registers the mapped tables in Base.metadata
from app.config import Settings
from app.db import Base, create_database_engine
from app.production_migrations import require_authorization
from app.rate_limits import rate_table


config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = [Base.metadata, rate_table.metadata]


def run_migrations_offline() -> None:
    # Passing the URL directly avoids ConfigParser interpolation of encoded '%'.
    settings = Settings()
    context.configure(
        url=settings.database_url.get_secret_value(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_with_connection(connection: Connection) -> None:
    # Both supplied and newly opened connections must pass before any Alembic DDL.
    require_authorization(Settings(), config, connection=connection)
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
    )
    # Alembic respects a transaction already owned by the caller.
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    settings = Settings()
    require_authorization(settings, config)
    provided_connection = config.attributes.get("connection")
    if provided_connection is not None:
        run_with_connection(provided_connection)
        return

    engine = create_database_engine(settings)
    try:
        with engine.connect() as connection:
            run_with_connection(connection)
    finally:
        engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
