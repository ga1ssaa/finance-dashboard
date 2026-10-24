"""Fail-closed guards for explicitly approved local verification operations.

Importing this module performs no filesystem, Docker, or database operations.
No function prints connection credentials, environment values, or database rows.
"""

import json
import os
from pathlib import Path
import pwd
import re
import stat
import subprocess
import tempfile

from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import URL, make_url


TEST_DATABASE_PATTERN = r"finance_dashboard_phase5_[0-9a-f]{12}"
APPROVED_TEST_DATABASES = frozenset({
    "finance_dashboard_phase5_893a40072fc1",
    "finance_dashboard_phase5_f0e1554a4e98",
})
SOURCE_DATABASE = "finance_dashboard"
MAINTENANCE_DATABASE = "postgres"
DOCKER_BINARY = "/Applications/Docker.app/Contents/Resources/bin/docker"
CONTAINER = "backend-postgres-1"
BUSINESS_TABLES = ("owners", "transactions", "subscriptions", "budget_profiles", "preferences")
STAGES = {"planned", "creating", "created", "seeded_at_0002", "verified_at_0003", "ready", "failed"}


class SafetyError(RuntimeError):
    """A verification precondition failed; messages never contain secret values."""


def validate_environment(environ=None):
    environment = os.environ if environ is None else environ
    names = set(os.environ) | set(environment)
    if any(name.startswith("PG") for name in names):
        raise SafetyError("PG-prefixed environment variables are not permitted")
    if any(name.startswith("DOCKER") for name in names):
        raise SafetyError("Docker environment overrides are not permitted")
    return environment


def canonical_source_url(raw_url, environ=None):
    validate_environment(environ)
    try:
        if isinstance(raw_url, str) and ("?" in raw_url or "#" in raw_url):
            raise SafetyError("Database URL queries and fragments are not permitted")
        source = make_url(raw_url)
        if source.query or (source.drivername, source.host, source.port, source.database) != (
            "postgresql+psycopg", "127.0.0.1", 5434, SOURCE_DATABASE
        ) or not isinstance(source.username, str) or not source.username or not isinstance(source.password, str) or not source.password:
            raise SafetyError("Database source does not match the approved local target")
        return URL.create("postgresql+psycopg", username=source.username, password=source.password,
                          host="127.0.0.1", port=5434, database=SOURCE_DATABASE)
    except SafetyError:
        raise
    except Exception:
        raise SafetyError("Invalid database source configuration") from None


def validate_test_database(database):
    if (not isinstance(database, str) or re.fullmatch(TEST_DATABASE_PATTERN, database) is None
            or database not in APPROVED_TEST_DATABASES):
        raise SafetyError("An explicit approved disposable database identifier is required")
    return database


def canonical_test_url(source_url, database, environ=None):
    source = canonical_source_url(source_url, environ)
    return source.set(database=validate_test_database(database))


def inspect_allowed_postgres(environ=None):
    environment = validate_environment(environ)
    # Resolve the real account home rather than trusting HOME or Docker context.
    socket = Path(pwd.getpwuid(os.getuid()).pw_dir) / ".docker/run/docker.sock"
    try:
        if not stat.S_ISSOCK(socket.stat().st_mode):
            raise SafetyError("The local Docker Desktop socket is unavailable")
        sanitized = {key: value for key, value in environment.items()
                     if not key.startswith(("DOCKER", "PG"))}
        sanitized["PATH"] = "/usr/bin:/bin:/usr/sbin:/sbin"
        template = ('{"name":{{json .Name}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},'
                    '"service":{{json (index .Config.Labels "com.docker.compose.service")}},'
                    '"running":{{json .State.Running}},"health":{{json .State.Health.Status}},'
                    '"ports":{{json .NetworkSettings.Ports}}}')
        result = subprocess.run([DOCKER_BINARY, "--host", "unix://" + str(socket), "inspect",
                                 "--type", "container", CONTAINER, "--format", template],
                                env=sanitized, capture_output=True, text=True, check=True, timeout=10)
        record = json.loads(result.stdout)
        if (record.get("name") != "/" + CONTAINER or record.get("project") != "backend"
                or record.get("service") != "postgres" or record.get("running") is not True
                or record.get("health") != "healthy"
                or record.get("ports", {}).get("5432/tcp") != [{"HostIp": "127.0.0.1", "HostPort": "5434"}]):
            raise SafetyError("The allowed PostgreSQL container identity or live binding does not match")
        return record
    except SafetyError:
        raise
    except Exception:
        raise SafetyError("Unable to verify the local Docker Desktop PostgreSQL container") from None


def verify_database(connection, expected):
    actual = connection.scalar(text("SELECT current_database()"))
    if actual != expected:
        raise SafetyError("The connected database does not match the approved target")


def _checked_statement(statement, mode):
    """Permit the reviewed SQL shapes, rejecting batches and global mutations."""
    sql = statement.strip()
    if sql.endswith(";"):
        sql = sql[:-1].rstrip()
    if not sql or ";" in sql or "--" in sql or "/*" in sql or "*/" in sql:
        raise SafetyError("SQL batches and comments are not permitted")
    normalized = " ".join(sql.split()).upper()
    # These controls must not get a preliminary SELECT: SET READ ONLY must be
    # first in its transaction; savepoint rollback must work after a PG error.
    controls = {"SET TRANSACTION READ ONLY", "SET LOCAL TIME ZONE 'UTC'", "BEGIN", "COMMIT", "ROLLBACK"}
    savepoint = r'(?:"[A-Za-z_][A-Za-z0-9_]*"|[A-Za-z_][A-Za-z0-9_]*)'
    if normalized in controls or re.fullmatch(
        r"(?:SAVEPOINT |RELEASE SAVEPOINT |ROLLBACK TO SAVEPOINT )" + savepoint, sql, re.IGNORECASE
    ):
        return True
    if mode == "create_admin":
        match = re.fullmatch(r'CREATE\s+DATABASE\s+("?)([A-Za-z0-9_]+)\1', sql, re.IGNORECASE)
        if match:
            validate_test_database(match.group(2))
            return False
        if normalized not in {
            "SELECT CURRENT_DATABASE()", "SELECT PG_CATALOG.VERSION()", "SELECT CURRENT_SCHEMA()",
            "SHOW SERVER_VERSION_NUM", "SHOW TRANSACTION ISOLATION LEVEL", "SHOW STANDARD_CONFORMING_STRINGS",
        }:
            raise SafetyError("Maintenance postgres permits only approved database creation and known reads")
    elif normalized.startswith(("SELECT ", "SHOW ")):
        pass
    elif mode == "target_write" and (
        normalized.startswith(("INSERT ", "UPDATE ", "DELETE "))
        or re.match(r"(?:CREATE TABLE|CREATE(?: UNIQUE)? INDEX|ALTER TABLE)\b", normalized)
    ):
        pass
    else:
        raise SafetyError("SQL operation is outside the approved verification scope")
    return False


def guarded_engine(source_url, database, mode="readonly", environ=None):
    source = canonical_source_url(source_url, environ)
    if mode == "readonly":
        if database not in {SOURCE_DATABASE, MAINTENANCE_DATABASE}:
            validate_test_database(database)
    elif mode == "target_write":
        validate_test_database(database)
    elif mode == "create_admin":
        if database != MAINTENANCE_DATABASE:
            raise SafetyError("Database creation is permitted only through maintenance postgres")
    else:
        raise SafetyError("Unknown database access mode")
    inspect_allowed_postgres(environ)
    readonly = mode == "readonly"
    params = {"host": "127.0.0.1", "hostaddr": "127.0.0.1", "port": 5434,
              "dbname": database, "user": source.username, "connect_timeout": 3,
              "password": source.password,
              "options": "-c default_transaction_read_only=" + ("on" if readonly else "off")}
    options = {"connect_args": params, "hide_parameters": True, "echo": False}
    if mode == "create_admin":
        options["isolation_level"] = "AUTOCOMMIT"
    engine = create_engine(source.set(database=database), **options)

    @event.listens_for(engine, "do_connect")
    def check_effective_parameters(dialect, connection_record, positional, keyword):
        # Environment and Docker identity can change after engine construction.
        inspect_allowed_postgres(environ)
        effective = dict(keyword)
        # SQLAlchemy's psycopg dialect adds its own trusted adapter map, which
        # changes type decoding rather than libpq routing.
        if "context" in effective:
            context = effective.pop("context")
            if context is not getattr(dialect, "_psycopg_adapters_map", None) or context is None:
                raise SafetyError("Unexpected psycopg adapter context")
        if positional or effective != params:
            raise SafetyError("Effective connection parameters do not match the canonical local target")

    @event.listens_for(engine, "checkout")
    def check_checkout_environment(dbapi_connection, connection_record, connection_proxy):
        validate_environment(environ)

    @event.listens_for(engine, "connect")
    def check_actual_database(dbapi_connection, connection_record):
        # Verify before SQLAlchemy hands a connection to callers or any writes.
        original = dbapi_connection.autocommit
        try:
            dbapi_connection.autocommit = True
            with dbapi_connection.cursor() as cursor:
                cursor.execute("SELECT current_database(), current_setting('default_transaction_read_only')")
                actual, setting = cursor.fetchone()
            if actual != database or (readonly and setting != "on"):
                raise SafetyError("Effective connection target or read-only mode does not match")
        except Exception:
            dbapi_connection.close()
            raise SafetyError("Effective database connection verification failed") from None
        finally:
            if not dbapi_connection.closed:
                dbapi_connection.autocommit = original

    @event.listens_for(engine, "before_cursor_execute")
    def check_each_operation(connection, cursor, statement, parameters, context, executemany):
        validate_environment(environ)
        control = _checked_statement(statement, mode)
        if control:
            return
        # Use a separate raw cursor, never SQLAlchemy.execute (which recurses).
        # Do not alter autocommit or commit/rollback the caller's transaction.
        try:
            driver = connection.connection.driver_connection
            with driver.cursor() as identity_cursor:
                identity_cursor.execute("SELECT current_database()")
                row = identity_cursor.fetchone()
            if not row or row[0] != database:
                raise SafetyError("Per-operation database identity does not match the approved target")
        except SafetyError:
            raise
        except Exception:
            raise SafetyError("Per-operation database identity verification failed") from None
    return engine


def preservation_snapshot(connection, expected_database=SOURCE_DATABASE):
    if expected_database != SOURCE_DATABASE:
        validate_test_database(expected_database)
    connection.execute(text("SET TRANSACTION READ ONLY"))
    connection.execute(text("SET LOCAL TIME ZONE 'UTC'"))
    verify_database(connection, expected_database)
    if connection.scalar(text("SHOW transaction_read_only")) != "on":
        raise SafetyError("Preservation queries require a read-only transaction")
    from sqlalchemy import inspect
    result = {"revision": connection.execute(text("SELECT version_num FROM alembic_version")).scalars().all(),
              "tables": sorted(inspect(connection).get_table_names(schema="public")), "business": {}}
    for name in BUSINESS_TABLES:
        row = connection.execute(text(f"SELECT count(*) AS count, md5(coalesce(string_agg(md5(to_jsonb(r)::text), '' ORDER BY md5(to_jsonb(r)::text)),'')) AS row_hash FROM {name} AS r")).one()
        result["business"][name] = dict(row._mapping)
    return result


def read_only_inspection(source_url, environ=None):
    source = canonical_source_url(source_url, environ)
    admin = guarded_engine(source, MAINTENANCE_DATABASE, "readonly", environ)
    try:
        with admin.connect() as connection:
            verify_database(connection, MAINTENANCE_DATABASE)
            databases = connection.execute(text("SELECT datname FROM pg_database WHERE datname ~ :pattern ORDER BY datname"),
                                           {"pattern": "^" + TEST_DATABASE_PATTERN + "$"}).scalars().all()
    finally:
        admin.dispose()
    development = guarded_engine(source, SOURCE_DATABASE, "readonly", environ)
    try:
        with development.connect() as connection:
            snapshot = preservation_snapshot(connection)
    finally:
        development.dispose()
    return {"matching_disposable_databases": databases, "development": snapshot}


def _fsync_directory(directory):
    descriptor = os.open(directory, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _exclusive_json(path, value):
    path = Path(path)
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags, 0o600)
    with os.fdopen(descriptor, "w") as output:
        json.dump(value, output, sort_keys=True)
        output.write("\n")
        output.flush()
        os.fsync(output.fileno())
    _fsync_directory(path.parent)


def reserve_manifest(path, database):
    value = {"format": 1, "database": validate_test_database(database), "stage": "planned"}
    try:
        _exclusive_json(path, value)
    except Exception:
        raise SafetyError("Manifest reservation failed; no existing file will be overwritten") from None
    return value


def load_manifest(path, require_stage=None):
    try:
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        with os.fdopen(descriptor) as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077 or info.st_nlink != 1:
                raise SafetyError("Manifest ownership, type or permissions are unsafe")
            value = json.load(stream)
        if not isinstance(value, dict) or value.get("format") != 1 or value.get("stage") not in STAGES:
            raise SafetyError("Invalid verification manifest")
        validate_test_database(value.get("database"))
        if require_stage is not None and value["stage"] != require_stage:
            raise SafetyError("Manifest stage does not permit this operation")
        return value
    except SafetyError:
        raise
    except Exception:
        raise SafetyError("Unable to read a safe verification manifest") from None


def update_manifest(path, updates):
    path = Path(path)
    value = load_manifest(path)
    if "database" in updates and updates["database"] != value["database"]:
        raise SafetyError("A reserved database identifier cannot be changed")
    if "format" in updates and updates["format"] != 1:
        raise SafetyError("A manifest format cannot be changed")
    if "stage" in updates and updates["stage"] not in STAGES:
        raise SafetyError("Unknown manifest stage")
    value.update(updates)
    descriptor, temporary = tempfile.mkstemp(prefix=path.name + ".", suffix=".local", dir=path.parent)
    with os.fdopen(descriptor, "w") as output:
        json.dump(value, output, sort_keys=True)
        output.write("\n")
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, path)
    _fsync_directory(path.parent)
    return value


def create_reserved_database(source_url, manifest_path, environ=None):
    source = canonical_source_url(source_url, environ)
    value = load_manifest(manifest_path, require_stage="planned")
    database = value["database"]
    # A durable exclusive claim prevents concurrent or interrupted retries from
    # ever reusing a planned name. Claims and manifests are retained on failure.
    try:
        _exclusive_json(Path(str(manifest_path) + ".create.local"), {"database": database})
        update_manifest(manifest_path, {"stage": "creating"})
    except Exception:
        raise SafetyError("Database creation is already claimed or could not be reserved") from None
    admin = None
    try:
        admin = guarded_engine(source, MAINTENANCE_DATABASE, "create_admin", environ)
        with admin.connect() as connection:
            verify_database(connection, MAINTENANCE_DATABASE)
            if int(connection.scalar(text("SHOW server_version_num"))) // 10000 != 17:
                raise SafetyError("The approved PostgreSQL major version is required")
            connection.execute(text('CREATE DATABASE "' + database + '"'))
        return update_manifest(manifest_path, {"stage": "created"})
    except Exception:
        update_manifest(manifest_path, {"stage": "failed"})
        raise SafetyError("Database creation failed; retain the reservation and do not reuse it") from None
    finally:
        if admin is not None:
            admin.dispose()
