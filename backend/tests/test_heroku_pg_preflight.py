"""The real SQLAlchemy pool/dialect, synthetic psycopg replies; never a database."""

import logging
from contextlib import contextmanager
from pathlib import Path
import signal
import threading
import time
from types import SimpleNamespace

import psycopg
from psycopg.types import TypeInfo
import pytest
from sqlalchemy import event

from app.config import Settings
from verification import heroku_pg_preflight as probe

PRIVATE_MARKER = "synthetic-private-details-must-not-appear"
HOST = "synthetic.example.amazonaws.com"
DB = "synthetic_production"
USER = "synthetic"


class Cursor:
    def __init__(self, driver):
        self.driver = driver
        self.description = None
        self.rowcount = -1
        self.rows = []

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.close()

    def execute(self, statement, _params=None):
        driver, case = self.driver, self.driver.case
        assert driver.read_only is True and driver.autocommit is False
        assert statement.lstrip().split()[0].upper() in {"SELECT", "SHOW"}
        if driver.info.transaction_status == 0:
            driver.events.append("BEGIN READ ONLY")
            driver.info.transaction_status = 2
        driver.sql.append(statement)
        sql = " ".join(statement.lower().split())
        if "pg_catalog.version()" in sql:
            row = ("PostgreSQL 18.4 on synthetic",)
        elif "current_schema()" in sql:
            row = ("public",)
        elif "transaction_isolation" in sql or "transaction isolation level" in sql:
            row = ("read committed",)
        elif "standard_conforming_strings" in sql:
            row = ("on",)
        elif "transaction_read_only" in sql:
            row = (case.readonly,)
        elif "current_database(), current_user, session_user" in sql:
            row = case.identity
        elif "pg_stat_ssl" in sql:
            if case.query_error:
                raise case.query_error
            row = case.tls_row
        elif "server_version_num" in sql:
            row = (case.version,)
        elif "has_schema_privilege" in sql:
            row = (case.privileges,)
        elif "to_regclass" in sql:
            row = (case.no_revision,)
        elif "pg_class c join pg_namespace" in sql:
            row = case.relations
        elif "max_connections" in sql:
            row = case.capacity
        elif "pg_type" in sql:
            row = (None,)
        else:
            raise AssertionError("Unexpected inspection statement")
        self.rows = [row]
        self.rowcount = 1
        self.description = [("column_" + str(i), None, None, None, None, None, None)
                            for i in range(len(row))]

    def fetchone(self):
        return self.rows.pop(0) if self.rows else None

    def fetchall(self):
        rows, self.rows = self.rows, []
        return rows

    def close(self):
        pass


class Driver:
    def __init__(self, case):
        self.case = case
        self.events, self.sql = [], []
        self.read_only = None
        self.autocommit = False
        self.closed = self.broken = False
        self.info = SimpleNamespace(
            host=HOST, port=5432, dbname=DB, user=USER, hostaddr="203.0.113.10",
            encoding="utf-8", transaction_status=0,
            get_parameters=lambda: {"sslmode": case.native_mode, "sslrootcert": case.ca},
        )
        self.pgconn = SimpleNamespace(ssl_in_use=True)

    def cursor(self, *_args, **_kwargs):
        return Cursor(self)

    def add_notice_handler(self, _handler):
        pass

    def rollback(self):
        self.events.append("ROLLBACK")
        self.info.transaction_status = 0
        if self.case.rollback_error:
            raise psycopg.OperationalError(PRIVATE_MARKER)

    def commit(self):
        raise AssertionError("Probe must not commit")

    def close(self):
        self.events.append("CLOSE")
        self.closed = True
        if self.case.close_error:
            raise psycopg.OperationalError(PRIVATE_MARKER)


@pytest.fixture(autouse=True)
def forbid_real_connections(monkeypatch):
    def denied(*_args, **_kwargs):
        raise AssertionError("Real PostgreSQL connections are forbidden")
    monkeypatch.setattr(psycopg, "connect", denied)
    monkeypatch.setattr(psycopg.Connection, "connect", classmethod(denied))


@pytest.fixture
def synthetic(tmp_path, monkeypatch):
    ca = tmp_path / "configured-public-ca.pem"
    ca.write_text("Synthetic public CA fixture; never used for a real handshake")
    settings = Settings(_env_file=None, APP_ENV="production",
        DATABASE_URL=f"postgres://{USER}:unused@{HOST}:5432/{DB}",
        AUTH_JWT_SECRET="synthetic-unused-signing-key-at-least-32-bytes",
        PRODUCTION_SITE_DOMAIN="getavero.app", PRODUCTION_API_ORIGIN="https://api.getavero.app",
        CORS_ALLOWED_ORIGINS=["https://getavero.app"], TRUSTED_PROXY="heroku",
        PRODUCTION_DATABASE_HOST=HOST, PRODUCTION_DATABASE_NAME=DB,
        DATABASE_SSLROOTCERT=str(ca))
    case = SimpleNamespace(ca=str(ca), settings=settings, engines=[], disposed=[], drivers=[],
        version="180004", readonly="on", privileges=True, no_revision=True,
        identity=(DB, USER, USER, "203.0.113.10", 5432), tls_row=(True, "TLSv1.3"),
        relations=(0, 0), capacity=(97, -1, 1), native_mode="verify-full", query_error=None,
        connect_error=None, dispose_error=False, rollback_error=False, close_error=False,
        change_driver=lambda _driver: None, change_engine=lambda _engine: None)
    factory = probe.create_database_engine

    def make_engine(configured):
        assert configured is settings
        engine = factory(configured)
        case.engines.append(engine)
        def connect(*_args, **params):
            assert params["sslmode"] == "verify-full" and params["sslrootcert"] == str(ca)
            assert params["ssl_min_protocol_version"] == "TLSv1.2"
            if case.connect_error:
                raise case.connect_error
            driver = Driver(case)
            case.change_driver(driver)
            case.drivers.append(driver)
            return driver
        monkeypatch.setattr(engine.dialect.loaded_dbapi, "connect", connect)
        original_dispose = engine.dispose
        def dispose():
            case.disposed.append(True)
            original_dispose()
            if case.dispose_error:
                raise RuntimeError(PRIVATE_MARKER)
        monkeypatch.setattr(engine, "dispose", dispose)
        case.change_engine(engine)
        return engine

    def hstore_info(_cls, driver, _name):
        # Real dialect initialization, with only TypeInfo's native Cursor faked.
        with driver.cursor() as cursor:
            cursor.execute("SELECT oid FROM pg_type WHERE typname = 'hstore'")
        return None

    monkeypatch.setattr(TypeInfo, "fetch", classmethod(hstore_info))
    monkeypatch.setattr(probe, "Settings", lambda **kwargs: settings if kwargs == {"_env_file": None} else None)
    monkeypatch.setattr(probe, "create_database_engine", make_engine)
    monkeypatch.setenv("DYNO", "run.1234")
    return case


def outcome(case, capsys, expected):
    before_logging = logging.root.manager.disable
    before_handler = signal.getsignal(signal.SIGALRM)
    result = probe.main()
    output = capsys.readouterr()
    assert result == expected
    assert not output.err
    assert all(line.startswith(("PASS ", "FAIL ")) for line in output.out.splitlines())
    assert all(marker not in output.out for marker in (PRIVATE_MARKER, HOST, DB, "postgres://", "unused"))
    assert logging.root.manager.disable == before_logging
    assert signal.getsignal(signal.SIGALRM) == before_handler
    assert signal.getitimer(signal.ITIMER_REAL) == (0.0, 0.0)
    if case.engines:
        assert case.disposed == [True]
    for driver in case.drivers:
        assert driver.closed
        if driver.sql:
            assert "ROLLBACK" in driver.events
    assert ("PASS preflight complete" in output.out) == (expected == 0)
    return output.out


def test_valid_probe_uses_real_dialect_and_readonly_before_initialization(synthetic, capsys):
    outcome(synthetic, capsys, 0)
    driver, = synthetic.drivers
    assert "BEGIN READ ONLY" in driver.events
    assert any("pg_catalog.version()" in sql for sql in driver.sql)
    assert any("current_database()" in sql for sql in driver.sql)
    assert any("pg_type" in sql for sql in driver.sql)
    assert driver.read_only is True


@pytest.mark.parametrize("field,value,stage", [
    ("version", "170000", "PostgreSQL version"),
    ("version", "180003", "PostgreSQL version"),
    ("version", "180006", "PostgreSQL version"),
    ("version", None, "PostgreSQL version"),
    ("readonly", "off", "read-only initialization"),
    ("privileges", False, "schema privileges"),
    ("privileges", None, "schema privileges"),
    ("no_revision", False, "Alembic state"),
    ("relations", (1, 0), "empty target"),
    ("relations", (2, 2), "empty target"),
    ("relations", (None, 0), "empty target"),
    ("capacity", (3, -1, 1), "capacity snapshot"),
    ("capacity", (97, -1, 17), "capacity snapshot"),
    ("capacity", (97, 4, 1), "capacity snapshot"),
    ("capacity", (97, None, 1), "capacity snapshot"),
    ("capacity", (97, -2, 1), "capacity snapshot"),
    ("tls_row", (False, "TLSv1.3"), "TLS protocol"),
    ("tls_row", (True, "TLSv1.1"), "TLS protocol"),
    ("tls_row", (True, None), "TLS protocol"),
])
def test_bad_server_replies_fail_closed(synthetic, capsys, field, value, stage):
    setattr(synthetic, field, value)
    assert stage in outcome(synthetic, capsys, 1)


def test_missing_ca_never_creates_engine(synthetic, capsys):
    Path(synthetic.ca).unlink()
    assert "CA bundle" in outcome(synthetic, capsys, 1)
    assert not synthetic.engines


def test_unreadable_ca_never_creates_engine(synthetic, capsys, monkeypatch):
    monkeypatch.setattr(probe.os, "access", lambda *_args: False)
    outcome(synthetic, capsys, 1)
    assert not synthetic.engines


@pytest.mark.parametrize("key,value", [("sslmode", "require"), ("sslrootcert", "/wrong.pem"), ("ssl_min_protocol_version", "TLSv1")])
def test_invalid_connect_arguments_rejected_before_handshake(synthetic, capsys, key, value):
    def change(engine):
        @event.listens_for(engine, "do_connect", insert=True)
        def tamper(_dialect, _record, _args, params):
            params[key] = value
    synthetic.change_engine = change
    outcome(synthetic, capsys, 1)
    assert not synthetic.drivers


@pytest.mark.parametrize("field,value", [("host", "wrong.amazonaws.com"), ("dbname", "wrong_database"), ("user", "wrong_user"), ("hostaddr", None)])
def test_actual_target_mismatches_use_existing_verifier(synthetic, capsys, field, value):
    synthetic.change_driver = lambda driver: setattr(driver.info, field, value)
    assert "actual connection identity" in outcome(synthetic, capsys, 1)


@pytest.mark.parametrize("native_mode", ["require", "disable"])
def test_effective_tls_parameters_must_match(synthetic, capsys, native_mode):
    synthetic.native_mode = native_mode
    assert "actual connection identity" in outcome(synthetic, capsys, 1)


def test_server_identity_not_just_client_metadata(synthetic, capsys):
    synthetic.identity = ("wrong_database", USER, USER, "203.0.113.10", 5432)
    outcome(synthetic, capsys, 1)


@pytest.mark.parametrize("message", ["certificate verify failed: hostname mismatch", "TLS handshake failure", "connection refused"])
def test_handshake_and_connect_failures_are_sanitized(synthetic, capsys, message):
    synthetic.connect_error = psycopg.OperationalError(PRIVATE_MARKER + message)
    output = outcome(synthetic, capsys, 1)
    assert message not in output


@pytest.mark.parametrize("encoding", ["ascii", "latin-1"])
def test_unsupported_encoding_closed_before_any_metadata_sql(synthetic, capsys, encoding):
    synthetic.change_driver = lambda driver: setattr(driver.info, "encoding", encoding)
    outcome(synthetic, capsys, 1)
    assert not synthetic.drivers[0].sql


def test_timeout_during_query_cleans_up(synthetic, capsys):
    synthetic.query_error = probe.PreflightFailure()
    assert "TLS protocol" in outcome(synthetic, capsys, 1)


def test_actual_alarm_during_query_cleans_up(synthetic, capsys, monkeypatch):
    original = Cursor.execute
    def execute(cursor, statement, params=None):
        if "pg_stat_ssl" in statement:
            signal.raise_signal(signal.SIGALRM)
        return original(cursor, statement, params)
    monkeypatch.setattr(Cursor, "execute", execute)
    assert "TLS protocol" in outcome(synthetic, capsys, 1)


def test_transaction_start_failure_closes_connection(synthetic, capsys, monkeypatch):
    def change(engine):
        original = engine.connect
        def connect():
            connection = original()
            def broken_begin():
                raise RuntimeError(PRIVATE_MARKER)
            monkeypatch.setattr(connection, "begin", broken_begin)
            return connection
        monkeypatch.setattr(engine, "connect", connect)
    synthetic.change_engine = change
    outcome(synthetic, capsys, 1)


def test_plaintext_native_connection_rejected(synthetic, capsys):
    synthetic.change_driver = lambda driver: setattr(driver.pgconn, "ssl_in_use", False)
    assert "actual connection identity" in outcome(synthetic, capsys, 1)


def test_native_ca_mismatch_rejected(synthetic, capsys):
    synthetic.change_driver = lambda driver: setattr(driver.info, "get_parameters",
        lambda: {"sslmode": "verify-full", "sslrootcert": "/wrong.pem"})
    outcome(synthetic, capsys, 1)


def test_autocommit_driver_refused_before_sql(synthetic, capsys):
    synthetic.change_driver = lambda driver: setattr(driver, "autocommit", True)
    outcome(synthetic, capsys, 1)
    assert not synthetic.drivers[0].sql


def test_readonly_setter_must_actually_take_effect(synthetic, capsys, monkeypatch):
    monkeypatch.setattr(Driver, "read_only", property(lambda _self: None, lambda _self, _value: None), raising=False)
    outcome(synthetic, capsys, 1)
    assert not synthetic.drivers[0].sql


def test_nonproduction_and_wrong_dyno_never_connect(synthetic, capsys, monkeypatch):
    synthetic.settings.app_env = "development"
    outcome(synthetic, capsys, 1)
    synthetic.settings.app_env = "production"
    monkeypatch.setenv("DYNO", "web.1")
    outcome(synthetic, capsys, 1)
    assert not synthetic.engines


def test_no_migration_commands_are_called(synthetic, capsys, monkeypatch):
    from alembic import command
    def forbidden(*_args, **_kwargs):
        raise AssertionError("Alembic execution is forbidden")
    for name in ("upgrade", "downgrade", "stamp"):
        monkeypatch.setattr(command, name, forbidden)
    outcome(synthetic, capsys, 0)


def test_deadline_teardown_failure_cannot_report_complete(synthetic, capsys, monkeypatch):
    @contextmanager
    def broken_deadline():
        yield lambda: None
        raise RuntimeError(PRIVATE_MARKER)
    monkeypatch.setattr(probe, "_deadline", broken_deadline)
    assert "FAIL preflight runtime" in outcome(synthetic, capsys, 1)


def test_cleanup_attempts_are_individually_timed(synthetic, capsys, monkeypatch):
    original = signal.setitimer
    timers = []
    def setitimer(which, seconds, *args):
        timers.append(seconds)
        return original(which, seconds, *args)
    monkeypatch.setattr(signal, "setitimer", setitimer)
    outcome(synthetic, capsys, 0)
    assert timers == [probe.TIMEOUT_SECONDS, *([probe.CLEANUP_SECONDS] * 4), 0]


def test_silently_unclosed_native_driver_cannot_report_success(synthetic, capsys, monkeypatch):
    original = Cursor.execute
    def execute(cursor, statement, params=None):
        original(cursor, statement, params)
        if "max_connections" in statement:
            monkeypatch.setattr(cursor.driver, "close", lambda: None)
    monkeypatch.setattr(Cursor, "execute", execute)
    try:
        assert probe.main() == 1
        output = capsys.readouterr().out
        assert "FAIL cleanup/driver close" in output
        assert "PASS preflight complete" not in output
    finally:
        for driver in synthetic.drivers:
            Driver.close(driver)


@pytest.mark.parametrize("failure", ["rollback_error", "close_error", "dispose_error"])
def test_cleanup_failure_never_reports_success(synthetic, capsys, failure):
    # Enable failures after inspection so dialect initialization remains testable.
    original = Cursor.execute
    def execute(cursor, statement, params=None):
        original(cursor, statement, params)
        if "max_connections" in statement:
            setattr(synthetic, failure, True)
    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(Cursor, "execute", execute)
        assert "FAIL cleanup/" in outcome(synthetic, capsys, 1)


def test_existing_timer_is_preserved_without_connecting(synthetic, capsys):
    signal.setitimer(signal.ITIMER_REAL, 30)
    try:
        assert probe.main() == 1
        assert signal.getitimer(signal.ITIMER_REAL)[0] > 0
        assert not synthetic.engines
        assert capsys.readouterr().out.startswith("FAIL preflight runtime")
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)


def test_deadline_really_fires_and_restores_handler():
    previous = signal.getsignal(signal.SIGALRM)
    with pytest.raises(probe.PreflightFailure):
        with probe._deadline(0.01):
            time.sleep(0.05)
    assert signal.getsignal(signal.SIGALRM) == previous
    assert signal.getitimer(signal.ITIMER_REAL) == (0.0, 0.0)


def test_non_main_thread_fails_before_config_or_connection(synthetic, capsys):
    results = []
    thread = threading.Thread(target=lambda: results.append(probe.main()))
    thread.start(); thread.join()
    assert results == [1] and not synthetic.engines
    assert capsys.readouterr().out.startswith("FAIL preflight runtime")


def test_capacity_counts_clients_and_redacted_sessions_conservatively():
    assert "backend_type = 'client backend' OR backend_type IS NULL" in probe.CAPACITY_SQL


def test_non_inspection_sql_rejected(synthetic):
    engine = probe.create_database_engine(synthetic.settings)
    probe._install_guards(engine, synthetic.ca)
    try:
        with engine.connect() as connection:
            for sql in ("DELETE FROM unused", "SET transaction_read_only=off", "SELECT 1; DELETE FROM unused"):
                with pytest.raises(probe.PreflightFailure):
                    connection.exec_driver_sql(sql)
    finally:
        engine.dispose()
