"""Migrate only the isolated Compose database; never load a host backend/.env."""

import os

from alembic import command
from alembic.config import Config
from sqlalchemy.engine import make_url


def main() -> None:
    url = make_url(os.environ["DATABASE_URL"])
    if (
        url.drivername != "postgresql+psycopg"
        or url.host != "postgres"
        or url.port != 5432
        or url.username != "avero"
        or url.database != "avero_compose"
        or url.query
    ):
        raise SystemExit("Refusing migration: target is not the isolated AVERO Compose database")
    command.upgrade(Config("/app/alembic.ini"), "head")


if __name__ == "__main__":
    main()
