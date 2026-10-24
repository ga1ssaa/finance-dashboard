"""Reviewable backup/restore operations; importing this module performs no IO.

Execution of each external-file or database-changing action needs separate user
approval. No operation drops, resets, migrates or resumes a database.
"""

from datetime import date, datetime, timezone
from decimal import Decimal
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import stat
import subprocess
import tempfile
import threading

from sqlalchemy import create_engine, event, text

from verification.db_safety import (
    BUSINESS_TABLES, CONTAINER, DOCKER_BINARY, SafetyError, canonical_source_url,
    guarded_engine, inspect_allowed_postgres, validate_environment,
)
from verification.restore_comparison import restored_fingerprint_matches


class BackupSafetyError(SafetyError):
    def __init__(self, message="BACKUP_SAFETY_ERROR"):
        super().__init__(message)
        self.code = message if re.fullmatch(r"[A-Z][A-Z0-9_]{2,63}", message) else "BACKUP_SAFETY_ERROR"


PROPOSED_RESTORE_DATABASE = "finance_dashboard_restore_2d7aad8af290"
PRIVATE_DIRECTORY = Path("/Users/a1d1yar/.finance-dashboard-backups")
PROPOSED_BACKUP_PATH = PRIVATE_DIRECTORY / "20261024T144549Z_finance_dashboard_0002_8180b1dba8e9.dump"
EXPECTED_TABLES = frozenset(BUSINESS_TABLES) | {"alembic_version"}
ROW_COLUMNS = {
    "owners": "id,created_at,updated_at",
    "transactions": "id,owner_id,title,amount_usd,type,category,transaction_date,created_at,updated_at",
    "subscriptions": "id,owner_id,service_name,amount_usd,next_payment_date,icon,status,created_at,updated_at",
    "budget_profiles": "id,owner_id,monthly_income_usd,needs_spent_usd,wants_spent_usd,savings_usd,created_at,updated_at",
    "preferences": "id,owner_id,display_currency,created_at,updated_at",
}


def validate_source(raw_url):
    return canonical_source_url(raw_url)


def validate_restore_target(database, approved=False):
    if approved is not True or database != PROPOSED_RESTORE_DATABASE:
        raise BackupSafetyError("The exact fresh restore target needs separate explicit approval")
    return database


def _sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def private_directory(path, create=False):
    path = Path(path)
    if path != PRIVATE_DIRECTORY or path.parent != Path(pwd.getpwuid(os.getuid()).pw_dir):
        raise BackupSafetyError("Only the reviewed private backup directory is permitted")
    if path.parent.resolve(strict=True) != path.parent:
        raise BackupSafetyError("Backup directory ancestors must not be symlinks")
    if create:
        try:
            path.mkdir(mode=0o700)
            _sync_directory(path.parent)
        except FileExistsError:
            pass
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
        raise BackupSafetyError("Backup directory must be owned, private and not a symlink")
    return path


def _artifact_path(path):
    path = Path(path)
    if not path.is_absolute() or path.parent != PRIVATE_DIRECTORY or path.name in {"", ".", ".."}:
        raise BackupSafetyError("Artifact path is outside the reviewed backup directory")
    private_directory(path.parent)
    return path


def reserve_file(path):
    path = _artifact_path(path)
    descriptor = None
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
        os.fsync(descriptor)
        _sync_directory(path.parent)
        return descriptor
    except Exception:
        if descriptor is not None:
            os.close(descriptor)
        raise BackupSafetyError("Exclusive artifact reservation failed; existing files are never overwritten") from None


def exclusive_manifest(path, payload):
    descriptor = reserve_file(path)
    with os.fdopen(descriptor, "w") as output:
        json.dump(payload, output, sort_keys=True)
        output.write("\n")
        output.flush()
        os.fsync(output.fileno())
    _sync_directory(Path(path).parent)


def _open_private(path):
    path = _artifact_path(path)
    descriptor = os.open(path, os.O_RDONLY | os.O_NONBLOCK | getattr(os, "O_NOFOLLOW", 0))
    info = os.fstat(descriptor)
    if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
            or stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink != 1):
        os.close(descriptor)
        raise BackupSafetyError("Artifact must be an owned private regular file with no links")
    return os.fdopen(descriptor, "rb")


def _read_manifest(path):
    with _open_private(path) as stream:
        value = json.load(stream)
    if not isinstance(value, dict):
        raise BackupSafetyError("Invalid artifact manifest")
    return value


def update_manifest(path, updates):
    path = _artifact_path(path)
    value = _read_manifest(path)
    for field in ("database", "archive", "sha256"):
        if field in value and field in updates and updates[field] != value[field]:
            raise BackupSafetyError("Artifact identity cannot change")
    value.update(updates)
    descriptor, temporary = tempfile.mkstemp(prefix=path.name + ".", suffix=".pending", dir=path.parent)
    with os.fdopen(descriptor, "w") as output:
        json.dump(value, output, sort_keys=True)
        output.write("\n")
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, path)
    _sync_directory(path.parent)
    return value


def canonical_value(value):
    if isinstance(value, Decimal):
        if not value.is_finite() or value.as_tuple().exponent < -8:
            raise BackupSafetyError("Nonfinite money cannot be fingerprinted")
        return format(value, ".8f")
    if isinstance(value, datetime):
        if value.tzinfo is None:
            raise BackupSafetyError("Naive audit timestamp cannot be fingerprinted")
        return value.astimezone(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")
    if isinstance(value, date):
        return value.isoformat()
    if value is None or isinstance(value, (str, int, bool)):
        return value
    from uuid import UUID
    if isinstance(value, UUID):
        return str(value)
    raise BackupSafetyError("Unsupported value in canonical fingerprint")


def hash_rows(rows):
    digest = hashlib.sha256()
    count = 0
    for row in rows:
        encoded = json.dumps([canonical_value(value) for value in row], ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        digest.update(len(encoded).to_bytes(8, "big"))
        digest.update(encoded)
        count += 1
    return {"count": count, "sha256": digest.hexdigest()}


def _docker_prefix():
    validate_environment()
    inspect_allowed_postgres()
    socket = Path(pwd.getpwuid(os.getuid()).pw_dir) / ".docker/run/docker.sock"
    return [DOCKER_BINARY, "--host", "unix://" + str(socket), "exec", "-i", CONTAINER]


def credential_prefix(source):
    source = validate_source(source)
    values = (source.username, source.password)
    if any(any(char in value for char in ("\n", "\r", "\x00")) for value in values):
        raise BackupSafetyError("Native client credentials cannot contain framing characters")
    return (values[0] + "\n" + values[1] + "\n").encode("utf-8")


def native_command(operation, database=None, snapshot=None):
    if operation == "dump":
        if database != "finance_dashboard" or not isinstance(snapshot, str) or re.fullmatch(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{8}-[0-9]+", snapshot) is None:
            raise BackupSafetyError("Dump requires the approved source and an exported snapshot")
        command = "exec timeout --signal=TERM --kill-after=5s 1200s pg_dump --host=127.0.0.1 --port=5432 --dbname=finance_dashboard --format=custom --no-owner --no-privileges --no-password --lock-wait-timeout=5s --snapshot=" + snapshot
    elif operation == "restore":
        validate_restore_target(database, approved=True)
        command = "exec timeout --signal=TERM --kill-after=5s 1200s pg_restore --host=127.0.0.1 --port=5432 --dbname=" + database + " --single-transaction --exit-on-error --no-owner --no-privileges --no-tablespaces --no-password"
    elif operation == "list":
        command = "exec timeout --signal=TERM --kill-after=5s 1200s pg_restore --list --no-password"
    elif operation == "versions":
        command = "pg_dump --version && pg_restore --version"
    else:
        raise BackupSafetyError("Unknown native client operation")
    guard = ""
    if operation in {"dump", "restore"}:
        guard = ('actual=$(timeout --signal=TERM --kill-after=5s 15s psql --host=127.0.0.1 --port=5432 --dbname=' + database +
                 ' --no-psqlrc --no-password --tuples-only --no-align --command "SELECT current_database() || \'|\' || (current_setting(\'server_version_num\')::int / 10000) || \'|\' || current_setting(\'transaction_read_only\')") || exit 72\n'
                 '[ "$actual" = "' + database + '|17|' + ('off' if operation == 'restore' else 'on') + '" ] || exit 73\n')
    script = ('IFS= read -r PGUSER || exit 70\nIFS= read -r PGPASSWORD || exit 70\n'
              'export PGUSER PGPASSWORD\nPGHOSTADDR=127.0.0.1\nPGCONNECT_TIMEOUT=3\n'
              'export PGHOSTADDR PGCONNECT_TIMEOUT\n'
              'PGOPTIONS="-c default_transaction_read_only=' + ('off' if operation == 'restore' else 'on') + ' -c statement_timeout=900000 -c lock_timeout=5000"\nexport PGOPTIONS\n'
              'command -v timeout >/dev/null || exit 71\n'
              'case "$(pg_dump --version)" in "pg_dump (PostgreSQL) 17."*) ;; *) exit 71;; esac\n'
              'case "$(pg_restore --version)" in "pg_restore (PostgreSQL) 17."*) ;; *) exit 71;; esac\n' + guard + command)
    return _docker_prefix() + ["env", "-i", "PATH=/usr/lib/postgresql/17/bin:/usr/local/bin:/usr/bin:/bin", "/bin/sh", "-c", script]


def stream_native(source, operation, database=None, *, snapshot=None, stdin_file=None, stdout_fd=None):
    prefix = credential_prefix(source)
    command = native_command(operation, database, snapshot)
    environment = {"PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "HOME": pwd.getpwuid(os.getuid()).pw_dir, "LANG": "C.UTF-8"}
    output = stdout_fd if stdout_fd is not None else (subprocess.PIPE if operation in {"list", "versions"} else subprocess.DEVNULL)
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=output, stderr=subprocess.DEVNULL, env=environment)
    errors = []
    input_stream = process.stdin
    process.stdin = None  # The bounded writer owns this pipe, communicate owns output.
    def write_input():
        try:
            input_stream.write(prefix)
            if stdin_file is not None:
                shutil.copyfileobj(stdin_file, input_stream, length=256 * 1024)
        except BrokenPipeError:
            pass  # --list may finish without consuming archive data blocks.
        except Exception:
            errors.append(True)
        finally:
            try:
                input_stream.close()
            except (BrokenPipeError, OSError):
                pass
    writer = threading.Thread(target=write_input, daemon=True)
    writer.start()
    try:
        captured, _ = process.communicate(timeout=1250)
    except BaseException:
        try:
            process.kill()  # Only this owned Docker exec client, never the container.
            process.communicate(timeout=10)
        except Exception:
            pass
        writer.join(timeout=10)
        raise BackupSafetyError("Native client outcome UNKNOWN; retain artifacts, stop and inspect before any new approval") from None
    writer.join(timeout=10)
    if process.returncode != 0 or writer.is_alive() or errors:
        raise BackupSafetyError("Native client failed; retain partial artifacts and do not retry automatically")
    return captured or b""


def source_fingerprint(connection, expected_database="finance_dashboard"):
    if expected_database != "finance_dashboard":
        validate_restore_target(expected_database, approved=True)
    identity = connection.execute(text("SELECT current_database(), current_setting('server_version_num')::int, current_setting('transaction_read_only')")).one()
    if identity[0] != expected_database or identity[1] // 10000 != 17 or identity[2] != "on":
        raise BackupSafetyError("Fingerprint requires the exact PG17 database in a read-only transaction")
    connection.execute(text("SET LOCAL TIME ZONE 'UTC'"))
    connection.execute(text("SELECT pg_catalog.set_config('search_path','pg_catalog,public',true)"))
    relations = connection.execute(text("SELECT c.relname,c.relkind,c.relpersistence,c.relrowsecurity,c.relforcerowsecurity,c.relreplident,c.reloptions FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind<>'i' ORDER BY c.relname")).all()
    if {row[0] for row in relations} != EXPECTED_TABLES or any(row[1] != "r" for row in relations):
        raise BackupSafetyError("Source must contain exactly the six approved public tables")
    unsupported = connection.scalar(text("""SELECT
      (SELECT count(*) FROM pg_catalog.pg_namespace WHERE nspname NOT IN ('public','pg_catalog','information_schema') AND nspname NOT LIKE 'pg_toast%' AND nspname NOT LIKE 'pg_temp_%') +
      (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public') +
      (SELECT count(*) FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal) +
      (SELECT count(*) FROM pg_catalog.pg_rewrite r JOIN pg_catalog.pg_class c ON c.oid=r.ev_class JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public') +
      (SELECT count(*) FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typrelid=0 AND t.typelem=0) +
      (SELECT count(*) FROM pg_catalog.pg_extension WHERE extname<>'plpgsql') +
      (SELECT count(*) FROM pg_catalog.pg_event_trigger) +
      (SELECT count(*) FROM pg_catalog.pg_foreign_server) +
      (SELECT count(*) FROM pg_catalog.pg_publication) +
      (SELECT count(*) FROM pg_catalog.pg_subscription) +
      (SELECT count(*) FROM pg_catalog.pg_largeobject_metadata) +
      (SELECT count(*) FROM pg_catalog.pg_collation c JOIN pg_catalog.pg_namespace n ON n.oid=c.collnamespace WHERE n.nspname='public') +
      (SELECT count(*) FROM pg_catalog.pg_operator o JOIN pg_catalog.pg_namespace n ON n.oid=o.oprnamespace WHERE n.nspname='public') +
      (SELECT count(*) FROM pg_catalog.pg_opclass o JOIN pg_catalog.pg_namespace n ON n.oid=o.opcnamespace WHERE n.nspname='public') +
      (SELECT count(*) FROM pg_catalog.pg_opfamily o JOIN pg_catalog.pg_namespace n ON n.oid=o.opfnamespace WHERE n.nspname='public') +
      (SELECT count(*) FROM pg_catalog.pg_ts_config o JOIN pg_catalog.pg_namespace n ON n.oid=o.cfgnamespace WHERE n.nspname='public') +
      (SELECT count(*) FROM pg_catalog.pg_ts_dict o JOIN pg_catalog.pg_namespace n ON n.oid=o.dictnamespace WHERE n.nspname='public') +
      (SELECT count(*) FROM pg_catalog.pg_ts_parser o JOIN pg_catalog.pg_namespace n ON n.oid=o.prsnamespace WHERE n.nspname='public') +
      (SELECT count(*) FROM pg_catalog.pg_ts_template o JOIN pg_catalog.pg_namespace n ON n.oid=o.tmplnamespace WHERE n.nspname='public') +
      (SELECT count(*) FROM pg_catalog.pg_conversion o JOIN pg_catalog.pg_namespace n ON n.oid=o.connamespace WHERE n.nspname='public') +
      (SELECT count(*) FROM pg_catalog.pg_statistic_ext o JOIN pg_catalog.pg_namespace n ON n.oid=o.stxnamespace WHERE n.nspname='public') +
      (SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.reltablespace<>0) +
      (SELECT count(*) FROM pg_catalog.pg_database d JOIN pg_catalog.pg_tablespace s ON s.oid=d.dattablespace WHERE d.datname=pg_catalog.current_database() AND s.spcname<>'pg_default') +
      (CASE WHEN pg_catalog.current_setting('default_tablespace') NOT IN ('','pg_default') THEN 1 ELSE 0 END) +
      (SELECT count(*) FROM pg_catalog.pg_policy p JOIN pg_catalog.pg_class c ON c.oid=p.polrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public')
    """))
    if unsupported != 0:
        raise BackupSafetyError("Unexpected user objects prevent a complete supported backup proof")
    columns = connection.execute(text("SELECT c.relname,a.attnum,a.attname,pg_catalog.format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_catalog.pg_get_expr(d.adbin,d.adrelid),a.attidentity,a.attgenerated,co.collname FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum LEFT JOIN pg_catalog.pg_collation co ON co.oid=a.attcollation WHERE n.nspname='public' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum")).all()
    constraints = connection.execute(text("SELECT c.relname,k.conname,k.contype,k.condeferrable,k.condeferred,k.convalidated,k.connoinherit,pg_catalog.pg_get_constraintdef(k.oid,false) FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class c ON c.oid=k.conrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname,k.conname")).all()
    indexes = connection.execute(text("SELECT c.relname,i.relname,x.indisunique,x.indisprimary,x.indisvalid,x.indisready,pg_catalog.pg_get_indexdef(i.oid) FROM pg_catalog.pg_index x JOIN pg_catalog.pg_class c ON c.oid=x.indrelid JOIN pg_catalog.pg_class i ON i.oid=x.indexrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname,i.relname")).all()
    if any(not row[4] or not row[5] for row in indexes):
        raise BackupSafetyError("Invalid indexes cannot be certified")
    revisions = connection.execute(text("SELECT version_num FROM public.alembic_version ORDER BY version_num")).scalars().all()
    if revisions != ["0002_models"]:
        raise BackupSafetyError("Only revision 0002_models may be backed up or certified")
    database_metadata = connection.execute(text("SELECT pg_catalog.pg_encoding_to_char(d.encoding),d.datcollate,d.datctype,d.datlocprovider,coalesce(pg_catalog.to_jsonb(d)->>'datlocale',pg_catalog.to_jsonb(d)->>'daticulocale'),d.datcollversion FROM pg_catalog.pg_database d WHERE d.datname=pg_catalog.current_database()")).one()
    catalog = {"relations": [list(row) for row in relations], "columns": [list(row) for row in columns], "constraints": [list(row) for row in constraints], "indexes": [list(row) for row in indexes]}
    catalog_bytes = json.dumps(catalog, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()
    financial = {}
    for table, columns_sql in ROW_COLUMNS.items():
        financial[table] = hash_rows(connection.execute(text('SELECT ' + columns_sql + ' FROM public."' + table + '" ORDER BY id')))
    return {"revision": revisions, "schema_sha256": hashlib.sha256(catalog_bytes).hexdigest(),
            "catalog": catalog, "database_metadata": list(database_metadata), "server_major": 17,
            "financial": financial}


def _snapshot(source, database="finance_dashboard"):
    engine = _backup_engine(source, database, readonly=True)
    try:
        with engine.connect().execution_options(isolation_level="REPEATABLE READ") as connection:
            with connection.begin():
                return source_fingerprint(connection, database)
    finally:
        engine.dispose()


def _backup_engine(source, database, readonly=True, create_admin=False):
    source = validate_source(source)
    if database == "finance_dashboard":
        if not readonly or create_admin:
            raise BackupSafetyError("Development source is read-only only")
        return guarded_engine(source, database, mode="readonly")
    if create_admin:
        if database != "postgres":
            raise BackupSafetyError("Creation is restricted to maintenance postgres")
    else:
        validate_restore_target(database, approved=True)
        if not readonly:
            raise BackupSafetyError("Restore data writes use only the reviewed native pg_restore command")
    inspect_allowed_postgres()
    params = {"host": "127.0.0.1", "hostaddr": "127.0.0.1", "port": 5434, "dbname": database,
              "user": source.username, "password": source.password, "connect_timeout": 3,
              "options": "-c default_transaction_read_only=" + ("off" if create_admin else "on")}
    kwargs = {"connect_args": params, "hide_parameters": True, "echo": False}
    if create_admin:
        kwargs["isolation_level"] = "AUTOCOMMIT"
    engine = create_engine(source.set(database=database), **kwargs)
    @event.listens_for(engine, "do_connect")
    def guard_connect(dialect, record, args, values):
        inspect_allowed_postgres()
        effective = dict(values)
        if "context" in effective:
            if effective.pop("context") is not getattr(dialect, "_psycopg_adapters_map", None):
                raise BackupSafetyError("Unrecognized driver context")
        if args or effective != params:
            raise BackupSafetyError("Native restore connection routing differs from its reviewed target")
    @event.listens_for(engine, "before_cursor_execute")
    def guard_statement(connection, cursor, statement, parameters, context, many):
        validate_environment()
        normalized = " ".join(statement.strip().rstrip(";").split()).upper()
        expected_create = ('CREATE DATABASE "' + PROPOSED_RESTORE_DATABASE + '" TEMPLATE TEMPLATE0').upper()
        if not (normalized.startswith(("SELECT ", "SHOW ")) or normalized == "SET LOCAL TIME ZONE 'UTC'"
                or (create_admin and normalized == expected_create)):
            raise BackupSafetyError("SQL is outside the reviewed backup scope")
        if ";" in statement.strip().rstrip(";") or "--" in statement or "/*" in statement:
            raise BackupSafetyError("SQL batches and comments are forbidden")
        with connection.connection.driver_connection.cursor() as identity:
            identity.execute("SELECT current_database()")
            if identity.fetchone()[0] != database:
                raise BackupSafetyError("Actual database changed before an operation")
        if normalized == expected_create:
            inspect_allowed_postgres()
    return engine


def _archive_identity(archive):
    archive = Path(archive)
    if archive != PROPOSED_BACKUP_PATH:
        raise BackupSafetyError("Only the exact disclosed backup filename is permitted")
    return archive, Path(str(archive) + ".manifest.json")


def checksum_stream(stream):
    digest = hashlib.sha256()
    size = 0
    stream.seek(0)
    if stream.read(5) != b"PGDMP":
        raise BackupSafetyError("Artifact is not a PostgreSQL custom archive")
    stream.seek(0)
    for chunk in iter(lambda: stream.read(256 * 1024), b""):
        digest.update(chunk)
        size += len(chunk)
    stream.seek(0)
    return {"sha256": digest.hexdigest(), "bytes": size}


def _checksum(archive):
    with _open_private(archive) as stream:
        return checksum_stream(stream)


def _verify_stream(stream, backup):
    checksum = checksum_stream(stream)
    if checksum["sha256"] != backup["sha256"] or checksum["bytes"] != backup["bytes"]:
        raise BackupSafetyError("The exact opened archive changed before use")


def _verified_backup(archive):
    archive, manifest = _archive_identity(archive)
    value = _read_manifest(manifest)
    checksum = _checksum(archive)
    if (value.get("kind") != "finance_dashboard_backup" or value.get("status") != "complete"
            or value.get("archive") != str(archive) or value.get("sha256") != checksum["sha256"]
            or value.get("bytes") != checksum["bytes"]
            or value.get("fingerprint", {}).get("revision") != ["0002_models"]):
        raise BackupSafetyError("Completed backup manifest or archive checksum does not match")
    return archive, value


def create_backup(source, archive, approved=False):
    if approved is not True:
        raise BackupSafetyError("Backup execution and the exact private output require explicit approval")
    source = validate_source(source)
    archive, manifest = _archive_identity(archive)
    private_directory(archive.parent, create=True)
    descriptor = reserve_file(archive)
    reserved = False
    engine = None
    try:
        exclusive_manifest(manifest, {"format": 1, "kind": "finance_dashboard_backup", "status": "reserved", "archive": str(archive)})
        reserved = True
        engine = _backup_engine(source, "finance_dashboard", readonly=True)
        with engine.connect().execution_options(isolation_level="REPEATABLE READ") as connection:
            transaction = connection.begin()
            try:
                exported = connection.scalar(text("SELECT pg_catalog.pg_export_snapshot()"))
                before = source_fingerprint(connection)
                versions = stream_native(source, "versions").decode("ascii").strip().splitlines()
                update_manifest(manifest, {"status": "dumping", "fingerprint": before, "client_versions": versions})
                stream_native(source, "dump", "finance_dashboard", snapshot=exported, stdout_fd=descriptor)
                os.fsync(descriptor)
            finally:
                transaction.rollback()  # Exporter is read-only and never commits.
        checksum = _checksum(archive)
        after = _snapshot(source)
        if after != before:
            update_manifest(manifest, {"status": "source_changed", **checksum, "source_after": after})
            raise BackupSafetyError("Snapshot backup retained, but live source changed; stop for review")
        result = update_manifest(manifest, {"status": "complete", **checksum, "source_after": after, "source_preserved": True})
        _sync_directory(archive.parent)
        return result
    except Exception:
        if reserved:
            current = _read_manifest(manifest)
            if current.get("status") in {"reserved", "dumping"}:
                update_manifest(manifest, {"status": "failed_unknown"})
        raise BackupSafetyError("Backup did not complete verification; retain all artifacts and stop") from None
    finally:
        os.close(descriptor)
        if engine is not None:
            engine.dispose()


def list_archive(source, archive):
    source = validate_source(source)
    archive, value = _verified_backup(archive)
    with _open_private(archive) as stream:
        _verify_stream(stream, value)
        contents = stream_native(source, "list", stdin_file=stream)
    entries = [line for line in contents.decode("utf-8", errors="strict").splitlines() if line and not line.startswith(";")]
    if not entries:
        raise BackupSafetyError("Archive table of contents is empty")
    return {"archive": str(archive), "sha256": value["sha256"], "toc_entries": len(entries), "restore_verified": False}


def _restore_manifest(archive):
    return Path(str(archive) + "." + PROPOSED_RESTORE_DATABASE + ".restore.json")


def _empty_target(connection, database):
    identity = connection.execute(text("SELECT current_database(),current_setting('server_version_num')::int,current_setting('transaction_read_only')")).one()
    if identity[0] != database or identity[1] // 10000 != 17 or identity[2] != "on":
        raise BackupSafetyError("Fresh restore target identity or read-only preflight failed")
    objects = connection.scalar(text("SELECT (SELECT count(*) FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema') + (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema') + (SELECT count(*) FROM pg_catalog.pg_namespace WHERE nspname NOT IN ('public','pg_catalog','information_schema') AND nspname NOT LIKE 'pg_toast%' AND nspname NOT LIKE 'pg_temp_%') + (SELECT count(*) FROM pg_catalog.pg_extension WHERE extname<>'plpgsql')"))
    if objects != 0:
        raise BackupSafetyError("Restore requires the exact newly created empty target")


def _collation_evidence(connection, database):
    if database not in {"finance_dashboard", "template0", PROPOSED_RESTORE_DATABASE}:
        raise BackupSafetyError("COLLATION_TARGET_NOT_ALLOWED")
    row = connection.execute(text("SELECT pg_catalog.pg_encoding_to_char(d.encoding),d.datcollate,d.datctype,d.datlocprovider,coalesce(pg_catalog.to_jsonb(d)->>'datlocale',pg_catalog.to_jsonb(d)->>'daticulocale'),d.datcollversion,pg_catalog.pg_database_collation_actual_version(d.oid),d.datistemplate,d.datallowconn FROM pg_catalog.pg_database d WHERE d.datname=:database"), {"database": database}).one_or_none()
    if row is None:
        raise BackupSafetyError("COLLATION_EVIDENCE_MISSING")
    return {"database": database, "metadata": list(row[:6]), "actual_version": row[6],
            "is_template": row[7], "allow_connections": row[8]}


def _require_libc(metadata):
    if (not isinstance(metadata, (list, tuple)) or len(metadata) != 6
            or any(not isinstance(value, str) or not value for value in metadata[:3])
            or metadata[3] != "c" or metadata[4] is not None):
        raise BackupSafetyError("COLLATION_PROVIDER_UNSUPPORTED")


def validate_source_collation(backup_metadata, evidence):
    _require_libc(backup_metadata)
    if not isinstance(evidence, dict):
        raise BackupSafetyError("COLLATION_EVIDENCE_INVALID")
    if evidence.get("database") != "finance_dashboard" or evidence.get("metadata") != list(backup_metadata):
        raise BackupSafetyError("SOURCE_COLLATION_METADATA_MISMATCH")
    recorded = backup_metadata[5]
    if not isinstance(recorded, str) or not recorded or evidence.get("actual_version") != recorded:
        raise BackupSafetyError("SOURCE_COLLATION_VERSION_MISMATCH")
    return recorded


def validate_template_collation(backup_metadata, source_evidence, template_evidence):
    version = validate_source_collation(backup_metadata, source_evidence)
    if not isinstance(template_evidence, dict):
        raise BackupSafetyError("COLLATION_EVIDENCE_INVALID")
    metadata = template_evidence.get("metadata")
    _require_libc(metadata)
    if (template_evidence.get("database") != "template0" or template_evidence.get("is_template") is not True
            or template_evidence.get("allow_connections") is not False):
        raise BackupSafetyError("TEMPLATE0_STATE_UNSAFE")
    if list(metadata[:5]) != list(backup_metadata[:5]):
        raise BackupSafetyError("TEMPLATE0_LOCALE_MISMATCH")
    # PostgreSQL 17 initdb deliberately clears pristine template0's recorded
    # version; dbcommands.c obtains the actual version for the new database.
    if template_evidence.get("actual_version") != version or metadata[5] not in (None, version):
        raise BackupSafetyError("TEMPLATE0_COLLATION_VERSION_MISMATCH")


def validate_target_collation(backup_metadata, source_evidence, target_evidence):
    version = validate_source_collation(backup_metadata, source_evidence)
    if not isinstance(target_evidence, dict):
        raise BackupSafetyError("COLLATION_EVIDENCE_INVALID")
    if (target_evidence.get("database") != PROPOSED_RESTORE_DATABASE
            or target_evidence.get("is_template") is not False or target_evidence.get("allow_connections") is not True):
        raise BackupSafetyError("TARGET_COLLATION_STATE_UNSAFE")
    if target_evidence.get("metadata") != list(backup_metadata):
        raise BackupSafetyError("TARGET_COLLATION_METADATA_MISMATCH")
    if target_evidence.get("actual_version") != version:
        raise BackupSafetyError("TARGET_COLLATION_VERSION_MISMATCH")


def _read_source_collation(source, backup_metadata):
    engine = _backup_engine(source, "finance_dashboard", readonly=True)
    try:
        with engine.connect() as connection:
            evidence = _collation_evidence(connection, "finance_dashboard")
            validate_source_collation(backup_metadata, evidence)
            return evidence
    finally:
        engine.dispose()


def create_restore_target(source, archive, database, approved=False):
    database = validate_restore_target(database, approved)
    source = validate_source(source)
    archive, backup = _verified_backup(archive)
    if _snapshot(source) != backup["fingerprint"]:
        raise BackupSafetyError("Live source differs from the reviewed backup; no target will be created")
    list_archive(source, archive)
    manifest = _restore_manifest(archive)
    exclusive_manifest(manifest, {"format": 1, "kind": "finance_dashboard_restore", "status": "planned", "database": database, "archive": str(archive), "sha256": backup["sha256"]})
    exclusive_manifest(Path(str(manifest) + ".create-claim"), {"database": database})
    update_manifest(manifest, {"status": "creating"})
    engine = None
    stage = "ADMIN_ENGINE"
    try:
        engine = _backup_engine(source, "postgres", readonly=False, create_admin=True)
        stage = "ADMIN_CONNECT"
        with engine.connect() as connection:
            stage = "SERVER_VERSION"
            if connection.scalar(text("SHOW server_version_num"))[:2] != "17":
                raise BackupSafetyError("Restore creation requires PostgreSQL 17")
            stage = "TARGET_ABSENCE"
            if connection.scalar(text("SELECT count(*) FROM pg_catalog.pg_database WHERE datname=:database"), {"database": database}) != 0:
                raise BackupSafetyError("Restore target already exists; no reuse or resume is permitted")
            stage = "SOURCE_COLLATION"
            source_evidence = _collation_evidence(connection, "finance_dashboard")
            validate_source_collation(backup["fingerprint"]["database_metadata"], source_evidence)
            stage = "TEMPLATE_COLLATION"
            validate_template_collation(backup["fingerprint"]["database_metadata"], source_evidence,
                                        _collation_evidence(connection, "template0"))
            stage = "PRE_CREATE_CONTAINER"
            inspect_allowed_postgres()
            stage = "CREATE_DATABASE"
            connection.execute(text('CREATE DATABASE "' + database + '" TEMPLATE template0'))
        stage = "TARGET_PREFLIGHT"
        check = _backup_engine(source, database, readonly=True)
        try:
            with check.connect() as connection:
                stage = "TARGET_EMPTY"
                _empty_target(connection, database)
                stage = "TARGET_COLLATION"
                validate_target_collation(backup["fingerprint"]["database_metadata"], source_evidence,
                                          _collation_evidence(connection, database))
        finally:
            check.dispose()
        stage = "MARK_CREATED_EMPTY"
        return update_manifest(manifest, {"status": "created_empty"})
    except Exception as error:
        code = error.code if isinstance(error, BackupSafetyError) else "CREATE_TARGET_OPERATION_FAILED"
        update_manifest(manifest, {"status": "failed_unknown", "failure_stage": stage, "failure_code": code})
        raise BackupSafetyError(code) from None
    finally:
        if engine is not None:
            engine.dispose()


def restore_archive(source, archive, database, approved=False):
    database = validate_restore_target(database, approved)
    source = validate_source(source)
    archive, backup = _verified_backup(archive)
    manifest = _restore_manifest(archive)
    state = _read_manifest(manifest)
    if (state.get("status") != "created_empty" or state.get("database") != database
            or state.get("archive") != str(archive) or state.get("sha256") != backup["sha256"]):
        raise BackupSafetyError("Restore requires its exact newly created target reservation")
    exclusive_manifest(Path(str(manifest) + ".restore-claim"), {"database": database, "sha256": backup["sha256"]})
    source_before = _snapshot(source)
    if source_before != backup["fingerprint"]:
        raise BackupSafetyError("Live source differs from the reviewed backup; no restore will run")
    source_evidence = _read_source_collation(source, backup["fingerprint"]["database_metadata"])
    engine = _backup_engine(source, database, readonly=True)
    try:
        with engine.connect() as connection:
            _empty_target(connection, database)
            validate_target_collation(backup["fingerprint"]["database_metadata"], source_evidence,
                                      _collation_evidence(connection, database))
    finally:
        engine.dispose()
    update_manifest(manifest, {"status": "restoring", "source_before": source_before})
    try:
        inspect_allowed_postgres()
        with _open_private(archive) as stream:
            _verify_stream(stream, backup)
            stream_native(source, "restore", database, stdin_file=stream)
        restored = _snapshot(source, database)
        source_evidence_after = _read_source_collation(source, backup["fingerprint"]["database_metadata"])
        engine = _backup_engine(source, database, readonly=True)
        try:
            with engine.connect() as connection:
                validate_target_collation(backup["fingerprint"]["database_metadata"], source_evidence_after,
                                          _collation_evidence(connection, database))
        finally:
            engine.dispose()
        source_after = _snapshot(source)
        if not restored_fingerprint_matches(backup["fingerprint"], restored) or source_after != source_before:
            raise BackupSafetyError("Restored content or source preservation did not match")
        return update_manifest(manifest, {"status": "verified", "restored": restored, "source_after": source_after, "source_preserved": True})
    except Exception:
        update_manifest(manifest, {"status": "failed_unknown"})
        raise BackupSafetyError("Restore outcome UNKNOWN or unverified; retain target, stop and request new inspection approval") from None


def operation_summary(result):
    """Only nonsecret verification summaries reach stdout; full catalog is private."""
    summary = {key: result[key] for key in ("archive", "database", "status", "bytes", "sha256", "source_preserved", "toc_entries", "restore_verified", "client_versions") if key in result}
    fingerprint = result.get("fingerprint") or result.get("restored")
    if fingerprint:
        summary.update({key: fingerprint[key] for key in ("revision", "schema_sha256", "financial")})
    return summary
