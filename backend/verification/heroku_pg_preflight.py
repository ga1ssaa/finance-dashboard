"""Explicit, initial-database-only Heroku probe; importing never connects.

Run from a separately approved release with maintenance ON and web=0:
    python backend/verification/heroku_pg_preflight.py
This is not migration authorization or a full application compatibility test.
The native read_only flag precedes dialect initialization; it changes BEGIN
characteristics, not database settings. No SET, DDL, DML or Alembic command runs.
"""

from contextlib import contextmanager
import logging
import os
from pathlib import Path
import re
import signal
import sys
import threading

if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import event

from app.config import Settings
from app.db import create_database_engine
from app.production import require_heroku
from app.production_migrations import checked_target, verify_connection_target


EXPECTED_VERSION = 180004
TIMEOUT_SECONDS = 45
CLEANUP_SECONDS = 5
ESSENTIAL_CONNECTION_LIMIT = 20
MIN_SPARE_CONNECTIONS = 4  # Three application slots and one administrative slot.

RELATIONS_SQL = """
SELECT count(*), count(*) FILTER (WHERE EXISTS (
    SELECT 1 FROM pg_depend d
    WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid
      AND d.refclassid = 'pg_extension'::regclass AND d.deptype = 'e'))
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_%'
  AND c.relkind IN ('r','p','v','m','S','f')
"""  # Same relation scope as the production migration runner; do not exempt extensions.

CAPACITY_SQL = """
SELECT current_setting('max_connections')::int
       - current_setting('superuser_reserved_connections')::int
       - current_setting('reserved_connections')::int
       - (SELECT count(*) FROM pg_stat_activity
          WHERE backend_type = 'client backend' OR backend_type IS NULL),
       (SELECT rolconnlimit FROM pg_roles WHERE rolname = current_user),
       (SELECT count(*) FROM pg_stat_activity WHERE usename = current_user
          AND (backend_type = 'client backend' OR backend_type IS NULL))
"""  # Unknown/redacted backend types count conservatively; capacity is only a snapshot.


class PreflightFailure(Exception):
    """Never include provider details in this exception or in output."""


def _require(condition):
    if not condition:
        raise PreflightFailure()


def _close_driver(driver):
    driver.close()
    _require(driver.closed is True)


@contextmanager
def _deadline(seconds=TIMEOUT_SECONDS):
    """A POSIX signal deadline, including separately bounded cleanup attempts.

    Signals cannot guarantee interruption of every native/OS operation. Refuse
    to replace an existing timer or run in a thread; never clobber caller state.
    """
    _require(threading.current_thread() is threading.main_thread())
    _require(signal.getitimer(signal.ITIMER_REAL) == (0.0, 0.0))
    previous = signal.getsignal(signal.SIGALRM)

    def expired(_signum, _frame):
        raise PreflightFailure()

    signal.signal(signal.SIGALRM, expired)
    try:
        signal.setitimer(signal.ITIMER_REAL, seconds)
        yield lambda: signal.setitimer(signal.ITIMER_REAL, CLEANUP_SECONDS)
    finally:
        try:
            signal.setitimer(signal.ITIMER_REAL, 0)
        finally:
            signal.signal(signal.SIGALRM, previous)


def _install_guards(engine, ca, drivers=None):
    @event.listens_for(engine, "do_connect")
    def readonly_connection(dialect, _record, args, params):
        _require(params.get("sslmode") == "verify-full"
                 and params.get("sslrootcert") == ca
                 and params.get("ssl_min_protocol_version") == "TLSv1.2")
        driver = dialect.loaded_dbapi.connect(*args, **params)
        if drivers is not None:
            drivers.append(driver)
        try:
            # UTF-8 avoids psycopg's ASCII type-introspection SET fallback.
            _require(driver.autocommit is False and driver.info.encoding == "utf-8")
            driver.read_only = True
            _require(driver.read_only is True)
            return driver
        except BaseException:
            driver.close()
            raise

    @event.listens_for(engine, "before_cursor_execute")
    def inspection_only(_connection, _cursor, statement, _params, _context, many):
        _require(not many and ";" not in statement
                 and re.match(r"\s*(SELECT|SHOW)\b", statement, re.IGNORECASE))


def _inspect(arm_cleanup):
    engine = connection = None
    drivers = []
    stage, status = "configuration", 1
    try:
        settings = Settings(_env_file=None)
        _require(settings.app_env == "production")
        require_heroku(os.environ, web=False)
        target = checked_target(settings.database_url.get_secret_value())
        print("PASS production configuration")

        stage = "CA bundle"
        ca = settings.database_sslrootcert
        _require(Path(ca).is_file() and os.access(ca, os.R_OK))
        print("PASS configured CA bundle")

        stage = "TLS connection and read-only initialization"
        engine = create_database_engine(settings)
        _install_guards(engine, ca, drivers)
        connection = engine.connect()
        connection.begin()  # psycopg emits BEGIN READ ONLY before the first SHOW.
        _require(connection.exec_driver_sql("SHOW transaction_read_only").scalar_one() == "on")
        print("PASS read-only transaction")

        stage = "actual connection identity"
        verify_connection_target(settings, connection, target)
        print("PASS approved database and user identity")

        stage = "TLS protocol"
        encrypted, protocol = connection.exec_driver_sql(
            "SELECT ssl, version FROM pg_stat_ssl WHERE pid = pg_backend_pid()"
        ).one()
        _require(encrypted is True and protocol in ("TLSv1.2", "TLSv1.3"))
        print("PASS verify-full and TLS 1.2+")

        stage = "PostgreSQL version"
        version = connection.exec_driver_sql("SHOW server_version_num").scalar_one()
        _require(str(version) == str(EXPECTED_VERSION))
        print("PASS PostgreSQL 18.4")

        stage = "schema privileges"
        _require(connection.exec_driver_sql("SELECT has_schema_privilege(current_user, 'public', 'USAGE') "
            "AND has_schema_privilege(current_user, 'public', 'CREATE')").scalar_one() is True)
        print("PASS public schema privileges")

        stage = "initial Alembic state"
        _require(connection.exec_driver_sql(
            "SELECT to_regclass('public.alembic_version') IS NULL").scalar_one() is True)
        print("PASS no Alembic revision table")

        stage = "empty target including provider relations"
        total, extensions = connection.exec_driver_sql(RELATIONS_SQL).one()
        _require(type(total) is int and type(extensions) is int and total == extensions == 0)
        print("PASS migration runner empty-target requirement")

        stage = "connection capacity snapshot"
        server_free, role_limit, role_used = connection.exec_driver_sql(CAPACITY_SQL).one()
        _require(all(type(value) is int for value in (server_free, role_limit, role_used)))
        _require(role_limit >= -1 and role_used >= 1)
        role_cap = ESSENTIAL_CONNECTION_LIMIT if role_limit == -1 else min(ESSENTIAL_CONNECTION_LIMIT, role_limit)
        _require(min(server_free, role_cap - role_used) >= MIN_SPARE_CONNECTIONS)
        print("PASS connection capacity snapshot")
        status = 0
    except BaseException:
        print("FAIL " + stage + "; details suppressed")
    finally:
        # Connection.close returns a connection to the pool; dispose may log and
        # swallow native close errors. Close each driver explicitly so such an
        # error cannot produce a successful preflight, even after partial setup.
        actions = [
            ("rollback", connection.rollback if connection is not None else None),
            ("close", connection.close if connection is not None else None),
            *[("driver close", lambda driver=driver: _close_driver(driver)) for driver in drivers],
            ("dispose", engine.dispose if engine is not None else None),
        ]
        for label, action in actions:
            if action is not None:
                try:
                    arm_cleanup()
                    action()
                except BaseException:
                    status = 1
                    print("FAIL cleanup/" + label)
    return status


def main():
    previous_logging = logging.root.manager.disable
    status = 1
    try:
        logging.disable(logging.CRITICAL)
        with _deadline() as arm_cleanup:
            status = _inspect(arm_cleanup)
    except BaseException:
        print("FAIL preflight runtime; details suppressed")
        status = 1
    finally:
        logging.disable(previous_logging)
    if status == 0:
        print("PASS preflight complete; no migrations executed")
    return status


if __name__ == "__main__":
    raise SystemExit(main())
