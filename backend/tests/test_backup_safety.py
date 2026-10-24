"""Independent backup preparation checks. All external processes/DB calls are mocked."""
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from importlib.util import module_from_spec, spec_from_file_location
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import UUID

import pytest

from verification import backup_safety as backup
from verification import db_safety as shared

ROOT = Path(__file__).resolve().parents[2]
SOURCE = "postgresql+psycopg://synthetic:unused@127.0.0.1:5434/finance_dashboard"
RESTORE = "finance_dashboard_restore_2d7aad8af290"
OLD_RESTORE = "finance_dashboard_restore_24cbbd570a31"


@pytest.fixture(autouse=True)
def no_external_processes_or_database(monkeypatch):
    """A broken test cannot accidentally invoke Docker/PG utilities or a DB."""
    forbidden = MagicMock(side_effect=AssertionError("Live external IO is forbidden in backup unit tests"))
    monkeypatch.setattr(subprocess, "run", forbidden)
    monkeypatch.setattr(subprocess, "Popen", forbidden)
    import psycopg
    monkeypatch.setattr(psycopg, "connect", forbidden)
    # Permit ordinary test artifacts only beneath the repository.
    original_mkdir = os.mkdir
    def mkdir(path, mode=0o777, *, dir_fd=None):
        candidate = Path(path)
        if dir_fd is not None or not candidate.resolve().is_relative_to(ROOT):
            raise AssertionError("Outside-workspace directory creation is forbidden")
        return original_mkdir(path, mode)
    monkeypatch.setattr(os, "mkdir", mkdir)
    yield forbidden


@pytest.fixture
def tmp_path():
    # Override pytest's OS-temp fixture for this module. Retain every generated
    # artifact inside the repository, even when the suite has no --basetemp.
    import tempfile
    return Path(tempfile.mkdtemp(prefix=".backup-qa-", suffix=".local", dir=ROOT / "backend"))


@pytest.fixture
def private_backup_directory(tmp_path, monkeypatch):
    directory = tmp_path / "backups.local"
    monkeypatch.setattr(backup, "PRIVATE_DIRECTORY", directory)
    monkeypatch.setattr(backup.pwd, "getpwuid", lambda _: SimpleNamespace(pw_dir=str(tmp_path)))
    return backup.private_directory(directory, create=True)


@pytest.mark.parametrize("database", ["finance_dashboard", "postgres", "finance_dashboard_phase5_893a40072fc1", "finance_dashboard_phase5_f0e1554a4e98", "finance_dashboard_restore_111111111111", OLD_RESTORE, RESTORE + ';DROP DATABASE other'])
def test_restore_refuses_every_database_except_the_exact_proposed_target(database):
    with pytest.raises(shared.SafetyError):
        backup.validate_restore_target(database, approved=True)


def test_restore_target_is_not_authorized_merely_by_being_proposed():
    with pytest.raises(shared.SafetyError):
        backup.validate_restore_target(RESTORE)
    assert backup.validate_restore_target(RESTORE, approved=True) == RESTORE


@pytest.mark.parametrize("suffix", ["?host=other", "?hostaddr=192.0.2.1", "?service=other", "?port=5432", "?options=-csearch_path=other", "#fragment"])
def test_backup_source_rejects_url_redirects(suffix):
    with pytest.raises(shared.SafetyError):
        backup.validate_source(SOURCE + suffix)


@pytest.mark.parametrize("name", ["PGHOST", "PGHOSTADDR", "PGSERVICE", "PGSERVICEFILE", "PGOPTIONS", "PGPASSFILE", "DOCKER_HOST", "DOCKER_CONTEXT"])
def test_backup_source_rejects_actual_process_environment_redirects(monkeypatch, name):
    monkeypatch.setenv(name, "synthetic-redirect")
    with pytest.raises(shared.SafetyError):
        backup.validate_source(SOURCE)


@pytest.mark.parametrize("source", [SOURCE.replace(":5434", ":5432"), SOURCE.replace("127.0.0.1", "localhost"), SOURCE.replace("finance_dashboard", RESTORE), SOURCE.replace("synthetic:unused", "synthetic"), SOURCE.replace("synthetic:unused", "synthetic:")])
def test_backup_source_requires_exact_host_database_port_and_explicit_credentials(source):
    with pytest.raises(shared.SafetyError):
        backup.validate_source(source)


def test_canonical_values_preserve_exact_money_dates_uuid_text_and_null():
    identity = UUID("12345678-1234-5678-1234-567812345678")
    assert backup.canonical_value(identity) == str(identity)
    assert backup.canonical_value(Decimal("1")) == "1.00000000"
    assert backup.canonical_value(Decimal("0.00000001")) == "0.00000001"
    assert backup.canonical_value(Decimal("999999999999.99999999")) == "999999999999.99999999"
    assert backup.canonical_value(date(2026, 10, 24)) == "2026-10-24"
    assert backup.canonical_value(None) is None
    assert backup.canonical_value("  Exact\ttext é 🚲\n") == "  Exact\ttext é 🚲\n"
    utc = datetime(2026, 10, 24, 10, 12, 13, 456789, timezone.utc)
    offset = utc.astimezone(timezone(timedelta(hours=5)))
    assert backup.canonical_value(utc) == backup.canonical_value(offset)


def test_row_hash_detects_financial_and_exact_text_changes_without_decimal_format_noise():
    original = [("id-1", Decimal("1.2"), "Exact é", None)]
    equivalent = [("id-1", Decimal("1.20000000"), "Exact é", None)]
    assert backup.hash_rows(original) == backup.hash_rows(equivalent)
    digest = backup.hash_rows(original)
    assert digest["count"] == 1 and len(digest["sha256"]) == 64
    for changed in [[("id-1", Decimal("1.20000001"), "Exact é", None)], [("id-1", Decimal("1.2"), "Exact é ", None)], [("id-1", Decimal("1.2"), "Exact e\u0301", None)], [("id-1", Decimal("1.2"), "Exact é", "")], []]:
        assert backup.hash_rows(changed) != digest
    assert backup.hash_rows([("ab",), ("c",)]) != backup.hash_rows([("a",), ("bc",)])


def test_exclusive_private_files_and_manifests_never_overwrite_existing_data(private_backup_directory):
    archive = private_backup_directory / "test.dump"
    descriptor = backup.reserve_file(archive)
    os.write(descriptor, b"synthetic archive fixture")
    os.close(descriptor)
    assert stat.S_IMODE(archive.stat().st_mode) == 0o600
    before = archive.read_bytes()
    with pytest.raises((shared.SafetyError, FileExistsError)):
        backup.reserve_file(archive)
    assert archive.read_bytes() == before
    manifest = private_backup_directory / "test-manifest.local"
    backup.exclusive_manifest(manifest, {"stage": "planned", "database": RESTORE})
    assert stat.S_IMODE(manifest.stat().st_mode) == 0o600
    with pytest.raises((shared.SafetyError, FileExistsError)):
        backup.exclusive_manifest(manifest, {"stage": "replaced"})
    assert json.loads(manifest.read_text())["stage"] == "planned"


def test_private_directory_rejects_symlinks_and_world_readable_directories(tmp_path, monkeypatch):
    private = tmp_path / "private.local"
    monkeypatch.setattr(backup, "PRIVATE_DIRECTORY", private)
    monkeypatch.setattr(backup.pwd, "getpwuid", lambda _: SimpleNamespace(pw_dir=str(tmp_path)))
    backup.private_directory(private, create=True)
    assert stat.S_IMODE(private.stat().st_mode) == 0o700
    alias = tmp_path / "alias.local"
    alias.symlink_to(private, target_is_directory=True)
    with pytest.raises(shared.SafetyError):
        backup.private_directory(alias)
    private.chmod(0o755)
    with pytest.raises(shared.SafetyError):
        backup.private_directory(private)


def test_archive_symlink_cannot_overwrite_the_referenced_file(private_backup_directory):
    original = private_backup_directory / "original.local"
    original.write_bytes(b"retained")
    alias = private_backup_directory / "alias.dump"
    alias.symlink_to(original)
    with pytest.raises((shared.SafetyError, FileExistsError)):
        backup.reserve_file(alias)
    assert original.read_bytes() == b"retained"


@pytest.mark.parametrize("value", ["user\nother", "user\rvalue", "user\x00value"])
def test_credential_stream_rejects_control_character_injection(value):
    source = shared.canonical_source_url(SOURCE, environ={}).set(password=value)
    with pytest.raises(shared.SafetyError):
        backup.credential_prefix(source)


def test_optimized_python_cannot_disable_backup_target_or_source_gates(monkeypatch):
    code = """import subprocess, psycopg, sqlalchemy
def forbidden(*args, **kwargs): raise RuntimeError('external IO forbidden')
subprocess.run = subprocess.Popen = psycopg.connect = sqlalchemy.create_engine = forbidden
from verification.backup_safety import validate_restore_target, validate_source
from verification.db_safety import SafetyError
for action in (lambda: validate_restore_target('finance_dashboard_restore_2d7aad8af290'), lambda: validate_restore_target('finance_dashboard', approved=True), lambda: validate_source('postgresql+psycopg://user:unused@127.0.0.1:5434/finance_dashboard?host=other')):
    try: action()
    except SafetyError: continue
    raise SystemExit('backup guard disabled under optimized Python')
print('optimized backup guards active')
"""
    # The subprocess is local Python only. The global fixture prohibits actual
    # subprocesses, so use the captured implementation solely for this check.
    with monkeypatch.context() as child_process:
        child_process.setattr(subprocess, "Popen", ORIGINAL_POPEN)
        result = ORIGINAL_RUN([sys.executable, "-O", "-c", code], cwd=ROOT,
                              env=dict(os.environ, PYTHONPATH=str(ROOT / "backend"), PYTHONPYCACHEPREFIX=str(ROOT / "backend/.backup-pycache.local")),
                              capture_output=True, text=True, check=False)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "optimized backup guards active"


ORIGINAL_RUN = subprocess.run
ORIGINAL_POPEN = subprocess.Popen


def docker_record():
    return {"name": "/backend-postgres-1", "project": "backend", "service": "postgres", "running": True, "health": "healthy", "ports": {"5432/tcp": [{"HostIp": "127.0.0.1", "HostPort": "5434"}]}}


def fake_docker(monkeypatch, record=None):
    monkeypatch.setattr(backup.pwd, "getpwuid", lambda _: SimpleNamespace(pw_dir=str(ROOT / "mock-home.local")))
    original_stat = shared.Path.stat
    def socket_stat(path, *args, **kwargs):
        if path.name == "docker.sock" and str(path).endswith(".docker/run/docker.sock"):
            return SimpleNamespace(st_mode=stat.S_IFSOCK | 0o600)
        return original_stat(path, *args, **kwargs)
    monkeypatch.setattr(shared.Path, "stat", socket_stat)
    run = MagicMock(return_value=SimpleNamespace(stdout=json.dumps(record or docker_record())))
    monkeypatch.setattr(subprocess, "run", run)
    return run


@pytest.mark.parametrize("change", [{"name": "/wrong-postgres-1"}, {"project": "wrong"}, {"service": "wrong"}, {"health": "unhealthy"}, {"ports": {"5432/tcp": [{"HostIp": "0.0.0.0", "HostPort": "5434"}]}}, {"ports": {"5432/tcp": [{"HostIp": "127.0.0.1", "HostPort": "5432"}]}}])
def test_native_commands_refuse_wrong_actual_container_identity_or_mapping(monkeypatch, change):
    fake_docker(monkeypatch, docker_record() | change)
    with pytest.raises(shared.SafetyError):
        backup.native_command("list")


def test_native_dump_and_restore_commands_are_exact_and_do_not_create_clean_or_migrate(monkeypatch):
    inspect = fake_docker(monkeypatch)
    snapshot = "00000003-0000001B-1"
    dump = backup.native_command("dump", "finance_dashboard", snapshot)
    restore = backup.native_command("restore", RESTORE)
    for command in (dump, restore):
        assert command[:6] == [shared.DOCKER_BINARY, "--host", "unix://" + str(ROOT / "mock-home.local/.docker/run/docker.sock"), "exec", "-i", "backend-postgres-1"]
        assert command[6:9] == ["env", "-i", "PATH=/usr/lib/postgresql/17/bin:/usr/local/bin:/usr/bin:/bin"]
        assert command[9:11] == ["/bin/sh", "-c"]
        assert "--no-psqlrc" in command[-1]
        assert "pg_dump (PostgreSQL) 17." in command[-1] and "pg_restore (PostgreSQL) 17." in command[-1]
    assert dump[-1].splitlines()[-1] == "exec timeout --signal=TERM --kill-after=5s 1200s pg_dump --host=127.0.0.1 --port=5432 --dbname=finance_dashboard --format=custom --no-owner --no-privileges --no-password --lock-wait-timeout=5s --snapshot=" + snapshot
    assert restore[-1].splitlines()[-1] == "exec timeout --signal=TERM --kill-after=5s 1200s pg_restore --host=127.0.0.1 --port=5432 --dbname=" + RESTORE + " --single-transaction --exit-on-error --no-owner --no-privileges --no-tablespaces --no-password"
    assert all(flag not in restore[-1] for flag in ("--create", "--clean", "DROP ", "alembic", "upgrade"))
    assert 'PGOPTIONS="-c default_transaction_read_only=on' in dump[-1]
    assert 'finance_dashboard|17|on' in dump[-1]
    assert 'PGOPTIONS="-c default_transaction_read_only=off' in restore[-1]
    assert RESTORE + '|17|off' in restore[-1]
    assert inspect.call_count == 2


@pytest.mark.parametrize("operation,database,snapshot", [("dump", RESTORE, "00000003-0000001B-1"), ("dump", "finance_dashboard", None), ("dump", "finance_dashboard", "snapshot;DROP"), ("restore", "finance_dashboard", None), ("restore", "finance_dashboard_restore_111111111111", None), ("unexpected", None, None)])
def test_invalid_native_operations_fail_before_docker(monkeypatch, operation, database, snapshot):
    inspect = MagicMock(side_effect=AssertionError("Invalid command must fail before Docker inspection"))
    monkeypatch.setattr(backup, "inspect_allowed_postgres", inspect)
    with pytest.raises(shared.SafetyError):
        backup.native_command(operation, database, snapshot)
    inspect.assert_not_called()


def fake_native_process(monkeypatch, output=b"safe listing", returncode=0):
    import io
    class RetainedPipe(io.BytesIO):
        def close(self):
            self.saved = self.getvalue()
    pipe = RetainedPipe()
    process = SimpleNamespace(stdin=pipe, input_stream=pipe, stdout=io.BytesIO(output), communicate=MagicMock(return_value=(output, None)), returncode=returncode, kill=MagicMock())
    popen = MagicMock(return_value=process)
    monkeypatch.setattr(subprocess, "Popen", popen)
    monkeypatch.setattr(backup, "native_command", lambda *args, **kwargs: ["reviewed-native-command"])
    return process, popen


def test_native_process_credentials_use_stdin_not_argv_or_inherited_secret_environment(monkeypatch):
    source = shared.canonical_source_url(SOURCE, environ={}).set(password="synthetic-private-marker")
    monkeypatch.setenv("DATABASE_URL", "unrelated-private-database-value")
    monkeypatch.setenv("AUTH_JWT_SECRET", "unrelated-private-signing-value")
    monkeypatch.setenv("UNRELATED_PRIVATE_TOKEN", "unrelated-private-token-value")
    process, popen = fake_native_process(monkeypatch)
    assert backup.stream_native(source, "list") == b"safe listing"
    arguments = popen.call_args.args[0]
    child_environment = popen.call_args.kwargs["env"]
    assert source.password not in " ".join(arguments)
    assert all(name not in child_environment for name in ("DATABASE_URL", "AUTH_JWT_SECRET", "UNRELATED_PRIVATE_TOKEN"))
    assert popen.call_args.kwargs["stderr"] == subprocess.DEVNULL
    assert process.input_stream.saved == backup.credential_prefix(source)


def test_native_process_failure_exposes_neither_credentials_nor_raw_stderr(monkeypatch):
    source = shared.canonical_source_url(SOURCE, environ={}).set(password="synthetic-private-marker")
    process, popen = fake_native_process(monkeypatch, returncode=1)
    with pytest.raises(shared.SafetyError) as caught:
        backup.stream_native(source, "list")
    assert source.password not in str(caught.value)
    assert popen.call_count == 1
    assert process.communicate.call_count == 1
    process.kill.assert_not_called()


@pytest.mark.parametrize("readonly,admin", [(False, False), (True, True), (False, True)])
def test_source_engine_can_never_be_created_for_writes(monkeypatch, readonly, admin):
    forbidden = MagicMock(side_effect=AssertionError("Source writes must fail before any engine"))
    monkeypatch.setattr(backup, "guarded_engine", forbidden)
    monkeypatch.setattr(backup, "create_engine", forbidden)
    with pytest.raises(shared.SafetyError):
        backup._backup_engine(SOURCE, "finance_dashboard", readonly=readonly, create_admin=admin)
    forbidden.assert_not_called()


def test_source_engine_uses_shared_readonly_guard(monkeypatch):
    guarded = MagicMock(return_value="read-only-engine")
    monkeypatch.setattr(backup, "guarded_engine", guarded)
    assert backup._backup_engine(SOURCE, "finance_dashboard") == "read-only-engine"
    assert guarded.call_args.kwargs == {"mode": "readonly"}
    assert guarded.call_args.args[1] == "finance_dashboard"


def test_canonical_fingerprint_rejects_naive_time_and_unsupported_binary_values():
    for value in (datetime(2026, 10, 24), b"opaque", 1.5):
        with pytest.raises(shared.SafetyError):
            backup.canonical_value(value)


def test_native_process_timeout_is_generic_reaps_only_owned_client_and_never_retries(monkeypatch):
    process, popen = fake_native_process(monkeypatch)
    process.communicate.side_effect = [subprocess.TimeoutExpired("reviewed-native-command", 1800), (b"", None)]
    with pytest.raises(shared.SafetyError, match="retain artifacts"):
        backup.stream_native(SOURCE, "list")
    process.kill.assert_called_once_with()
    assert popen.call_count == 1 and process.communicate.call_count == 2


def test_manifest_update_preserves_identity_and_syncs_the_replacement(private_backup_directory, monkeypatch):
    path = private_backup_directory / "state.local"
    payload = {"database": RESTORE, "archive": "fixed.dump", "sha256": "a" * 64, "stage": "planned"}
    backup.exclusive_manifest(path, payload)
    for field, replacement in [("database", "finance_dashboard"), ("archive", "different.dump"), ("sha256", "b" * 64)]:
        with pytest.raises(shared.SafetyError):
            backup.update_manifest(path, {field: replacement})
    syncs = []
    original_sync = os.fsync
    def sync(descriptor):
        syncs.append("directory" if stat.S_ISDIR(os.fstat(descriptor).st_mode) else "file")
        original_sync(descriptor)
    monkeypatch.setattr(os, "fsync", sync)
    backup.update_manifest(path, {"stage": "reserved"})
    assert syncs == ["file", "directory"]
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    assert json.loads(path.read_text()) == payload | {"stage": "reserved"}


def fingerprint_connection(*, database="finance_dashboard", revision="0002_models", readonly="on", catalog_change=None, financial_change=None, unsupported=0):
    identity = UUID("12345678-1234-5678-1234-567812345678")
    stamp = datetime(2026, 10, 24, 14, 0, 0, 123456, timezone.utc)
    # Restore verification now requires the real reviewed CHECK/column shapes
    # and a complete constraint inventory, even for this synthetic data fixture.
    from test_restore_comparison import fingerprint as comparison_fixture
    catalog = comparison_fixture()["catalog"]
    if catalog_change:
        catalog_change(catalog)
    financial = {
        "owners": [(identity, stamp, stamp)],
        "transactions": [(identity, identity, "Exact 🚲", Decimal("12.12345678"), "expense", "Food", date(2026, 10, 24), stamp, stamp)],
        "subscriptions": [],
        "budget_profiles": [(identity, identity, Decimal("100"), Decimal("1"), Decimal("2"), Decimal("3"), stamp, stamp)],
        "preferences": [(identity, identity, "USD", stamp, stamp)],
    }
    if financial_change:
        financial_change(financial)
    connection = MagicMock()
    connection.scalar.return_value = unsupported
    def execute(query, *args, **kwargs):
        sql = str(query)
        result = MagicMock()
        if "SELECT current_database()," in sql:
            result.one.return_value = (database, 170011, readonly)
        elif sql.startswith("SELECT c.relname,c.relkind"):
            result.all.return_value = catalog["relations"]
        elif "FROM pg_catalog.pg_attribute a" in sql:
            result.all.return_value = catalog["columns"]
        elif "FROM pg_catalog.pg_constraint k" in sql:
            result.all.return_value = catalog["constraints"]
        elif "FROM pg_catalog.pg_index x" in sql:
            result.all.return_value = catalog["indexes"]
        elif sql.startswith("SELECT version_num"):
            result.scalars.return_value.all.return_value = [revision]
        elif sql.startswith("SELECT pg_catalog.pg_encoding_to_char"):
            result.one.return_value = ("UTF8", "en_US.utf8", "en_US.utf8", "c", None, "2.41")
        elif 'FROM public."' in sql:
            table = sql.split('FROM public."', 1)[1].split('"', 1)[0]
            if not sql.endswith("ORDER BY id") or "SELECT *" in sql:
                raise AssertionError("Financial hashing requires explicit columns and deterministic id order")
            result.__iter__.return_value = iter(financial[table])
        return result
    connection.execute.side_effect = execute
    return connection


def test_fingerprint_covers_all_five_financial_tables_and_complete_schema_categories():
    result = backup.source_fingerprint(fingerprint_connection())
    assert result["revision"] == ["0002_models"] and result["server_major"] == 17
    assert set(result["catalog"]) == {"relations", "columns", "constraints", "indexes"}
    assert set(result["financial"]) == set(shared.BUSINESS_TABLES)
    assert {table: details["count"] for table, details in result["financial"].items()} == {"owners": 1, "transactions": 1, "subscriptions": 0, "budget_profiles": 1, "preferences": 1}
    assert len(result["schema_sha256"]) == 64
    assert backup.source_fingerprint(fingerprint_connection(database=RESTORE), RESTORE) == result


@pytest.mark.parametrize("category", ["relations", "columns", "constraints", "indexes"])
def test_schema_hash_changes_when_each_schema_category_changes(category):
    before = backup.source_fingerprint(fingerprint_connection())
    def change(catalog):
        row = list(catalog[category][0])
        row[-1] = "changed canonical schema value"
        catalog[category][0] = tuple(row)
    after = backup.source_fingerprint(fingerprint_connection(catalog_change=change))
    assert after["schema_sha256"] != before["schema_sha256"]
    assert after["financial"] == before["financial"]


def test_financial_hash_detects_amount_change_independently_of_schema():
    before = backup.source_fingerprint(fingerprint_connection())
    def change(rows):
        record = list(rows["transactions"][0]); record[3] = Decimal("12.12345679")
        rows["transactions"][0] = tuple(record)
    after = backup.source_fingerprint(fingerprint_connection(financial_change=change))
    assert after["schema_sha256"] == before["schema_sha256"]
    assert after["financial"]["transactions"] != before["financial"]["transactions"]


@pytest.mark.parametrize("options", [{"database": "other"}, {"readonly": "off"}, {"revision": "0003_auth"}, {"unsupported": 1}])
def test_fingerprint_refuses_wrong_database_writable_transaction_revision_or_unsupported_objects(options):
    with pytest.raises(shared.SafetyError):
        backup.source_fingerprint(fingerprint_connection(**options))


@pytest.fixture
def simulated_backup(private_backup_directory, monkeypatch):
    archive = private_backup_directory / "approved.dump"
    monkeypatch.setattr(backup, "PROPOSED_BACKUP_PATH", archive)
    baseline = backup.source_fingerprint(fingerprint_connection())
    connection = MagicMock()
    connection.__enter__.return_value = connection
    connection.execution_options.return_value = connection
    connection.scalar.return_value = "00000003-0000001B-1"
    transaction = connection.begin.return_value
    active = {"value": False}
    connection.begin.side_effect = lambda: active.update(value=True) or transaction
    transaction.rollback.side_effect = lambda: active.update(value=False)
    engine = MagicMock()
    engine.connect.return_value = connection
    monkeypatch.setattr(backup, "_backup_engine", lambda *args, **kwargs: engine)
    def fingerprint(*args, **kwargs):
        assert active["value"], "Snapshot fingerprint must be in the active read-only exporter"
        return baseline
    monkeypatch.setattr(backup, "source_fingerprint", fingerprint)
    snapshot = MagicMock(return_value=baseline)
    monkeypatch.setattr(backup, "_snapshot", snapshot)
    calls = []
    def native(source, operation, database=None, **options):
        calls.append(operation)
        if operation in {"versions", "dump"}:
            assert active["value"], "Exporter must remain open through pg_dump"
        if operation == "versions":
            return b"pg_dump (PostgreSQL) 17.11\npg_restore (PostgreSQL) 17.11\n"
        if operation == "dump":
            assert database == "finance_dashboard" and options["snapshot"] == "00000003-0000001B-1"
            os.write(options["stdout_fd"], b"PGDMP synthetic custom archive")
        if operation == "list":
            return b"; Archive listing\n1; 0 0 TABLE public owners synthetic\n"
        return b""
    monkeypatch.setattr(backup, "stream_native", native)
    def default_collation(_connection, database):
        metadata = list(COLLATION_METADATA)
        is_template = database == "template0"
        if is_template:
            metadata[5] = None
        return collation_evidence(database, metadata=metadata, template=is_template, connections=not is_template)
    monkeypatch.setattr(backup, "_collation_evidence", default_collation)
    monkeypatch.setattr(backup, "_read_source_collation", lambda *args: collation_evidence())
    return SimpleNamespace(archive=archive, baseline=baseline, connection=connection, transaction=transaction, engine=engine, snapshot=snapshot, calls=calls)


@pytest.mark.parametrize("operation", ["backup", "create", "restore"])
def test_every_mutating_flow_requires_separate_explicit_approval_before_artifact_io(monkeypatch, operation):
    forbidden = MagicMock(side_effect=AssertionError("Unapproved mutation must stop before artifact access"))
    monkeypatch.setattr(backup, "_archive_identity", forbidden)
    monkeypatch.setattr(backup, "_verified_backup", forbidden)
    if operation == "backup":
        action = lambda: backup.create_backup(SOURCE, backup.PROPOSED_BACKUP_PATH)
    elif operation == "create":
        action = lambda: backup.create_restore_target(SOURCE, backup.PROPOSED_BACKUP_PATH, RESTORE)
    else:
        action = lambda: backup.restore_archive(SOURCE, backup.PROPOSED_BACKUP_PATH, RESTORE)
    with pytest.raises(shared.SafetyError):
        action()
    forbidden.assert_not_called()


def test_dump_holds_exported_repeatable_read_snapshot_and_verifies_fresh_source(simulated_backup):
    fixture = simulated_backup
    result = backup.create_backup(SOURCE, fixture.archive, approved=True)
    assert result["status"] == "complete" and result["source_preserved"] is True
    assert result["fingerprint"] == fixture.baseline == result["source_after"]
    assert fixture.calls == ["versions", "dump"]
    fixture.connection.execution_options.assert_called_once_with(isolation_level="REPEATABLE READ")
    fixture.transaction.rollback.assert_called_once()
    fixture.transaction.commit.assert_not_called()
    fixture.snapshot.assert_called_once_with(shared.canonical_source_url(SOURCE, environ={}))
    assert result["bytes"] == len(b"PGDMP synthetic custom archive") and len(result["sha256"]) == 64


def test_dump_source_change_cannot_claim_success_and_partial_artifacts_are_retained(simulated_backup):
    fixture = simulated_backup
    fixture.snapshot.return_value = fixture.baseline | {"schema_sha256": "changed"}
    with pytest.raises(shared.SafetyError):
        backup.create_backup(SOURCE, fixture.archive, approved=True)
    manifest = json.loads(Path(str(fixture.archive) + ".manifest.json").read_text())
    assert manifest["status"] == "source_changed" and not manifest.get("source_preserved", False)
    assert fixture.archive.exists()
    assert fixture.calls == ["versions", "dump"]


def test_archive_listing_is_not_a_restore_proof(simulated_backup):
    fixture = simulated_backup
    backup.create_backup(SOURCE, fixture.archive, approved=True)
    result = backup.list_archive(SOURCE, fixture.archive)
    assert result["toc_entries"] == 1 and result["restore_verified"] is False
    assert fixture.calls == ["versions", "dump", "list"]


def test_archive_tampering_stops_before_list_or_restore_process(simulated_backup):
    fixture = simulated_backup
    backup.create_backup(SOURCE, fixture.archive, approved=True)
    descriptor = os.open(fixture.archive, os.O_WRONLY | os.O_APPEND)
    try:
        os.write(descriptor, b"tampered")
    finally:
        os.close(descriptor)
    before = list(fixture.calls)
    with pytest.raises(shared.SafetyError):
        backup.list_archive(SOURCE, fixture.archive)
    assert fixture.calls == before


def creation_engines(monkeypatch, *, collision=False, create_failure=False):
    admin, check = MagicMock(), MagicMock()
    connection = admin.connect.return_value.__enter__.return_value
    connection.scalar.side_effect = ["170011", 1 if collision else 0]
    connection.execute.return_value.one.return_value = ("UTF8", "en_US.utf8", "en_US.utf8", "c", None, "2.41")
    if create_failure:
        def duplicate_on_create(query):
            if str(query).startswith("CREATE DATABASE"):
                raise RuntimeError("synthetic duplicate race")
            return connection.execute.return_value
        connection.execute.side_effect = duplicate_on_create
    engines = MagicMock(side_effect=[admin, check])
    monkeypatch.setattr(backup, "_backup_engine", engines)
    inspect = MagicMock()
    monkeypatch.setattr(backup, "inspect_allowed_postgres", inspect)
    empty = MagicMock()
    monkeypatch.setattr(backup, "_empty_target", empty)
    return SimpleNamespace(admin=admin, check=check, connection=connection, engines=engines, inspect=inspect, empty=empty)


def test_restore_state_and_creation_claim_are_durable_before_exact_create(simulated_backup, monkeypatch):
    fixture = simulated_backup
    backup.create_backup(SOURCE, fixture.archive, approved=True)
    runtime = creation_engines(monkeypatch)
    syncs = []
    original_sync = os.fsync
    def sync(descriptor):
        syncs.append("directory" if stat.S_ISDIR(os.fstat(descriptor).st_mode) else "file")
        original_sync(descriptor)
    monkeypatch.setattr(os, "fsync", sync)
    manifest = backup._restore_manifest(fixture.archive)
    def create(query):
        if not str(query).startswith("CREATE DATABASE"):
            return runtime.connection.execute.return_value
        assert str(query) == 'CREATE DATABASE "' + RESTORE + '" TEMPLATE template0'
        assert json.loads(manifest.read_text())["status"] == "creating"
        claim = Path(str(manifest) + ".create-claim")
        assert json.loads(claim.read_text())["database"] == RESTORE
        assert stat.S_IMODE(claim.stat().st_mode) == 0o600
        assert syncs.count("file") >= 3 and syncs.count("directory") >= 3
    runtime.connection.execute.side_effect = create
    result = backup.create_restore_target(SOURCE, fixture.archive, RESTORE, approved=True)
    assert result["status"] == "created_empty"
    assert fixture.calls == ["versions", "dump", "list"]
    runtime.empty.assert_called_once()


@pytest.mark.parametrize("collision,create_failure", [(True, False), (False, True)])
def test_existing_target_or_create_race_never_runs_restore_or_target_seeding(simulated_backup, monkeypatch, collision, create_failure):
    fixture = simulated_backup
    backup.create_backup(SOURCE, fixture.archive, approved=True)
    runtime = creation_engines(monkeypatch, collision=collision, create_failure=create_failure)
    with pytest.raises(shared.SafetyError):
        backup.create_restore_target(SOURCE, fixture.archive, RESTORE, approved=True)
    assert runtime.engines.call_count == 1
    runtime.empty.assert_not_called()
    assert "restore" not in fixture.calls
    if collision:
        runtime.connection.execute.assert_not_called()
    state = json.loads(backup._restore_manifest(fixture.archive).read_text())
    assert state["status"] == "failed_unknown"


@pytest.mark.parametrize("difference", [None, "allowed_restore_semantics", "source_semantic_drift", "schema", "financial", "revision", "database_metadata", "source_changed"])
def test_restore_verified_requires_exact_schema_rows_revision_and_source_preservation(simulated_backup, monkeypatch, difference):
    fixture = simulated_backup
    completed = backup.create_backup(SOURCE, fixture.archive, approved=True)
    manifest = backup._restore_manifest(fixture.archive)
    backup.exclusive_manifest(manifest, {"database": RESTORE, "archive": str(fixture.archive), "sha256": completed["sha256"], "status": "created_empty"})
    engine = MagicMock()
    monkeypatch.setattr(backup, "_backup_engine", lambda *args, **kwargs: engine)
    monkeypatch.setattr(backup, "_empty_target", MagicMock())
    monkeypatch.setattr(backup, "inspect_allowed_postgres", MagicMock())
    restored = fixture.baseline
    source_after = fixture.baseline
    if difference in {"allowed_restore_semantics", "source_semantic_drift"}:
        from copy import deepcopy
        from test_restore_comparison import KNOWN, TARGET_DEFINITIONS, rehash
        restored = deepcopy(fixture.baseline)
        row = next(row for row in restored["catalog"]["constraints"] if row[:2] == list(KNOWN[0][:2]))
        row[7] = TARGET_DEFINITIONS[0]
        rehash(restored)
        if difference == "source_semantic_drift":
            source_after = deepcopy(restored)
    if difference == "schema":
        restored = restored | {"schema_sha256": "changed"}
    elif difference == "financial":
        restored = restored | {"financial": {}}
    elif difference == "revision":
        restored = restored | {"revision": ["0003_auth"]}
    elif difference == "database_metadata":
        restored = restored | {"database_metadata": ["changed locale"]}
    elif difference == "source_changed":
        source_after = source_after | {"financial": {}}
    snapshots = MagicMock(side_effect=[fixture.baseline, restored, source_after])
    monkeypatch.setattr(backup, "_snapshot", snapshots)
    if difference in {None, "allowed_restore_semantics"}:
        result = backup.restore_archive(SOURCE, fixture.archive, RESTORE, approved=True)
        assert result["status"] == "verified" and result["source_preserved"] is True
    else:
        with pytest.raises(shared.SafetyError):
            backup.restore_archive(SOURCE, fixture.archive, RESTORE, approved=True)
        assert json.loads(manifest.read_text())["status"] == "failed_unknown"
    assert snapshots.call_args_list[1].args[1] == RESTORE
    assert fixture.calls == ["versions", "dump", "restore"]


def test_same_open_archive_stream_is_checked_again_before_native_listing(simulated_backup, monkeypatch):
    import io
    fixture = simulated_backup
    backup.create_backup(SOURCE, fixture.archive, approved=True)
    archive, value = backup._verified_backup(fixture.archive)
    monkeypatch.setattr(backup, "_verified_backup", lambda _: (archive, value))
    monkeypatch.setattr(backup, "_open_private", lambda _: io.BytesIO(b"PGDMP replaced archive stream"))
    before = list(fixture.calls)
    with pytest.raises(shared.SafetyError):
        backup.list_archive(SOURCE, archive)
    assert fixture.calls == before


@pytest.mark.parametrize("metadata_mismatch,source_mismatch", [(True, False), (False, True)])
def test_changed_source_or_template_metadata_prevents_any_create(simulated_backup, monkeypatch, metadata_mismatch, source_mismatch):
    fixture = simulated_backup
    backup.create_backup(SOURCE, fixture.archive, approved=True)
    runtime = creation_engines(monkeypatch)
    if metadata_mismatch:
        original_evidence = backup._collation_evidence
        def changed_template(connection, database):
            evidence = original_evidence(connection, database)
            if database == "template0":
                evidence["metadata"][0] = "LATIN1"
            return evidence
        monkeypatch.setattr(backup, "_collation_evidence", changed_template)
    if source_mismatch:
        fixture.snapshot.return_value = fixture.baseline | {"schema_sha256": "changed"}
    with pytest.raises(shared.SafetyError):
        backup.create_restore_target(SOURCE, fixture.archive, RESTORE, approved=True)
    assert not any(str(call.args[0]).startswith("CREATE DATABASE") for call in runtime.connection.execute.call_args_list)
    runtime.empty.assert_not_called()


def load_backup_cli(name):
    spec = spec_from_file_location(name, ROOT / "backend/verification/backup_restore.py")
    module = module_from_spec(spec); spec.loader.exec_module(module)
    return module


def test_backup_helper_and_cli_import_have_no_external_io(monkeypatch, no_external_processes_or_database):
    forbidden = MagicMock(side_effect=AssertionError("Import must not reserve files, inspect Docker or create connections"))
    monkeypatch.setattr(backup.pwd, "getpwuid", forbidden)
    monkeypatch.setattr(shared, "inspect_allowed_postgres", forbidden)
    import sqlalchemy
    monkeypatch.setattr(sqlalchemy, "create_engine", forbidden)
    for path, name in [("backup_safety.py", "backup_import_only"), ("backup_restore.py", "backup_cli_import_only")]:
        spec = spec_from_file_location(name, ROOT / "backend/verification" / path)
        module = module_from_spec(spec); spec.loader.exec_module(module)
    forbidden.assert_not_called()
    no_external_processes_or_database.assert_not_called()


@pytest.mark.parametrize("matching", [False, True])
def test_restore_cli_approval_must_repeat_the_exact_proposed_target(monkeypatch, matching, capsys):
    import app.config
    monkeypatch.setattr(app.config, "Settings", lambda: SimpleNamespace(database_url=SimpleNamespace(get_secret_value=lambda: SOURCE)))
    restore = MagicMock(return_value={"status": "mocked"})
    monkeypatch.setattr(backup, "restore_archive", restore)
    cli = load_backup_cli("backup_cli_exact_approval_" + str(matching))
    approval = RESTORE if matching else "finance_dashboard"
    assert cli.main(["restore", "--archive", str(backup.PROPOSED_BACKUP_PATH), "--database", RESTORE, "--approve-restore-target", approval]) == 0
    assert restore.call_args.kwargs["approved"] is matching
    assert SOURCE not in capsys.readouterr().out


@pytest.mark.parametrize("catalog,namespace_or_setting", [
    ("pg_operator", "oprnamespace"),
    ("pg_opclass", "opcnamespace"),
    ("pg_opfamily", "opfnamespace"),
    ("pg_ts_config", "cfgnamespace"),
    ("pg_ts_dict", "dictnamespace"),
    ("pg_ts_parser", "prsnamespace"),
    ("pg_ts_template", "tmplnamespace"),
    ("pg_conversion", "connamespace"),
    ("pg_statistic_ext", "stxnamespace"),
    ("pg_class", "reltablespace"),
    ("pg_database", "dattablespace"),
    ("current_setting", "default_tablespace"),
])
def test_unsupported_operator_search_statistics_and_tablespaces_cannot_be_certified(catalog, namespace_or_setting):
    connection = fingerprint_connection()
    def unsupported_inventory(query):
        sql = str(query).lower()
        assert catalog in sql and namespace_or_setting in sql, "Unsupported-object inventory must query this PostgreSQL catalog/setting"
        if namespace_or_setting.endswith("namespace"):
            assert "nspname='public'" in sql, "Only the supported public schema may be certified"
        elif namespace_or_setting == "reltablespace":
            assert "reltablespace<>0" in sql.replace(" ", "")
        else:
            assert "pg_default" in sql
        # Simulate one unsupported object/setting in the requested category.
        return 1
    connection.scalar.side_effect = unsupported_inventory
    with pytest.raises(shared.SafetyError, match="Unexpected user objects"):
        backup.source_fingerprint(connection)
    connection.scalar.assert_called_once()
    sql_after_identity = [str(call.args[0]) for call in connection.execute.call_args_list]
    assert not any('FROM public."' in sql for sql in sql_after_identity), "Reject unsupported objects before financial hashes or success can be certified"
    assert not any("FROM pg_catalog.pg_attribute" in sql for sql in sql_after_identity)


COLLATION_METADATA = ["UTF8", "en_US.utf8", "en_US.utf8", "c", None, "2.41"]


def collation_evidence(database="finance_dashboard", *, metadata=None, actual="2.41", template=False, connections=True):
    return {"database": database, "metadata": list(COLLATION_METADATA if metadata is None else metadata),
            "actual_version": actual, "is_template": template, "allow_connections": connections}


def test_source_collation_preserves_all_six_backup_fields_and_matches_actual_version():
    original = list(COLLATION_METADATA)
    assert backup.validate_source_collation(original, collation_evidence()) == "2.41"
    assert original == COLLATION_METADATA and len(original) == 6


@pytest.mark.parametrize("field,value", [(0, "LATIN1"), (1, "other.UTF8"), (2, "other.UTF8"), (3, "i"), (4, "en-US"), (5, "2.40")])
def test_source_collation_rejects_drift_in_every_recorded_field(field, value):
    changed = list(COLLATION_METADATA); changed[field] = value
    with pytest.raises(shared.SafetyError):
        backup.validate_source_collation(COLLATION_METADATA, collation_evidence(metadata=changed))


@pytest.mark.parametrize("actual", [None, "", "2.40", "2.42"])
def test_source_collation_requires_actual_version_equal_to_backup_recorded_version(actual):
    with pytest.raises(shared.SafetyError):
        backup.validate_source_collation(COLLATION_METADATA, collation_evidence(actual=actual))


@pytest.mark.parametrize("provider", ["i", "b"])
def test_unsupported_icu_or_builtin_collation_provider_is_fail_closed(provider):
    metadata = list(COLLATION_METADATA); metadata[3] = provider
    with pytest.raises(shared.SafetyError):
        backup.validate_source_collation(metadata, collation_evidence(metadata=metadata))


def test_null_source_recorded_version_is_never_treated_as_the_template_exception():
    metadata = list(COLLATION_METADATA); metadata[5] = None
    with pytest.raises(shared.SafetyError):
        backup.validate_source_collation(metadata, collation_evidence(metadata=metadata))


@pytest.mark.parametrize("recorded", [None, "2.41"])
def test_template0_null_recorded_version_is_allowed_only_with_compatible_actual(recorded):
    template = list(COLLATION_METADATA); template[5] = recorded
    source = collation_evidence()
    evidence = collation_evidence("template0", metadata=template, template=True, connections=False)
    before = list(template)
    backup.validate_template_collation(COLLATION_METADATA, source, evidence)
    assert template == before  # Validation never rewrites template or backup metadata.


@pytest.mark.parametrize("field,value", [(0, "LATIN1"), (1, "C"), (2, "C"), (3, "i"), (4, "en-US")])
def test_template0_exception_never_hides_first_five_locale_field_mismatch(field, value):
    template = list(COLLATION_METADATA); template[5] = None; template[field] = value
    with pytest.raises(shared.SafetyError):
        backup.validate_template_collation(COLLATION_METADATA, collation_evidence(), collation_evidence("template0", metadata=template, template=True, connections=False))


@pytest.mark.parametrize("actual,recorded,template,connections", [
    (None, None, True, False), ("2.42", None, True, False),
    ("2.41", "2.40", True, False), ("2.41", None, False, False),
    ("2.41", None, True, True),
])
def test_template0_null_bookkeeping_requires_real_template_flags_and_compatible_version(actual, recorded, template, connections):
    metadata = list(COLLATION_METADATA); metadata[5] = recorded
    with pytest.raises(shared.SafetyError):
        backup.validate_template_collation(COLLATION_METADATA, collation_evidence(), collation_evidence("template0", metadata=metadata, actual=actual, template=template, connections=connections))


@pytest.mark.parametrize("recorded,actual", [(None, "2.41"), ("2.40", "2.41"), ("2.41", None), ("2.41", "2.42")])
def test_new_target_never_inherits_the_template_null_exception(recorded, actual):
    metadata = list(COLLATION_METADATA); metadata[5] = recorded
    with pytest.raises(shared.SafetyError):
        backup.validate_target_collation(COLLATION_METADATA, collation_evidence(), collation_evidence(RESTORE, metadata=metadata, actual=actual))


def test_valid_new_target_requires_full_recorded_and_actual_collation_match():
    backup.validate_target_collation(COLLATION_METADATA, collation_evidence(), collation_evidence(RESTORE))


@pytest.mark.parametrize("database", ["finance_dashboard", "template0", RESTORE])
def test_pg17_collation_evidence_reads_actual_version_with_a_bound_database_identifier(database):
    metadata = list(COLLATION_METADATA)
    template = database == "template0"
    if template:
        metadata[5] = None
    connection = MagicMock()
    connection.execute.return_value.one_or_none.return_value = tuple(metadata) + ("2.41", template, not template)
    evidence = backup._collation_evidence(connection, database)
    assert evidence == collation_evidence(database, metadata=metadata, template=template, connections=not template)
    query, parameters = connection.execute.call_args.args
    assert "pg_database_collation_actual_version(d.oid)" in str(query)
    assert "d.datname=:database" in str(query)
    assert parameters == {"database": database}


def test_old_target_cannot_even_be_queried_for_collation_evidence():
    connection = MagicMock()
    with pytest.raises(shared.SafetyError):
        backup._collation_evidence(connection, OLD_RESTORE)
    connection.execute.assert_not_called()


@pytest.mark.parametrize("where,actual", [("finance_dashboard", None), ("finance_dashboard", "2.42"), ("template0", None), ("template0", "2.42")])
def test_source_or_template_actual_version_drift_stops_before_create(simulated_backup, monkeypatch, where, actual):
    fixture = simulated_backup
    backup.create_backup(SOURCE, fixture.archive, approved=True)
    runtime = creation_engines(monkeypatch)
    original = backup._collation_evidence
    def drifted(connection, database):
        evidence = original(connection, database)
        if database == where:
            evidence["actual_version"] = actual
        return evidence
    monkeypatch.setattr(backup, "_collation_evidence", drifted)
    with pytest.raises(shared.SafetyError):
        backup.create_restore_target(SOURCE, fixture.archive, RESTORE, approved=True)
    assert not any(str(call.args[0]).startswith("CREATE DATABASE") for call in runtime.connection.execute.call_args_list)
    runtime.empty.assert_not_called()
    state = json.loads(backup._restore_manifest(fixture.archive).read_text())
    assert state["status"] == "failed_unknown"
    assert state["failure_stage"] == ("SOURCE_COLLATION" if where == "finance_dashboard" else "TEMPLATE_COLLATION")


@pytest.mark.parametrize("recorded,actual", [(None, "2.41"), ("2.40", "2.41"), ("2.41", None), ("2.41", "2.42")])
def test_created_empty_is_never_marked_before_strict_new_target_collation_validation(simulated_backup, monkeypatch, recorded, actual):
    fixture = simulated_backup
    backup.create_backup(SOURCE, fixture.archive, approved=True)
    runtime = creation_engines(monkeypatch)
    original = backup._collation_evidence
    def invalid_target(connection, database):
        evidence = original(connection, database)
        if database == RESTORE:
            evidence["metadata"][5] = recorded
            evidence["actual_version"] = actual
        return evidence
    monkeypatch.setattr(backup, "_collation_evidence", invalid_target)
    update = MagicMock(wraps=backup.update_manifest)
    monkeypatch.setattr(backup, "update_manifest", update)
    with pytest.raises(shared.SafetyError):
        backup.create_restore_target(SOURCE, fixture.archive, RESTORE, approved=True)
    assert any(str(call.args[0]).startswith("CREATE DATABASE") for call in runtime.connection.execute.call_args_list)
    runtime.empty.assert_called_once()
    assert not any(call.args[1].get("status") == "created_empty" for call in update.call_args_list)
    state = json.loads(backup._restore_manifest(fixture.archive).read_text())
    assert state["status"] == "failed_unknown" and state["failure_stage"] == "TARGET_COLLATION"
    assert "restore" not in fixture.calls


def test_new_creation_checks_metadata_in_order_and_never_reuses_old_failed_reservation(simulated_backup, monkeypatch):
    fixture = simulated_backup
    backup.create_backup(SOURCE, fixture.archive, approved=True)
    old_manifest = Path(str(fixture.archive) + "." + OLD_RESTORE + ".restore.json")
    old_claim = Path(str(old_manifest) + ".create-claim")
    backup.exclusive_manifest(old_manifest, {"database": OLD_RESTORE, "status": "failed_unknown"})
    backup.exclusive_manifest(old_claim, {"database": OLD_RESTORE})
    retained = (old_manifest.read_bytes(), old_claim.read_bytes())
    runtime = creation_engines(monkeypatch)
    events = []
    original_evidence = backup._collation_evidence
    def checked(connection, database):
        events.append(database)
        return original_evidence(connection, database)
    monkeypatch.setattr(backup, "_collation_evidence", checked)
    def create(query):
        if str(query).startswith("CREATE DATABASE"):
            assert events == ["finance_dashboard", "template0"]
            assert "COLLATION_VERSION" not in str(query), "Do not force or hide PostgreSQL's naturally recorded target version"
            events.append("CREATE")
        return runtime.connection.execute.return_value
    runtime.connection.execute.side_effect = create
    original_update = backup.update_manifest
    def update(path, changes):
        if changes.get("status") == "created_empty":
            assert events == ["finance_dashboard", "template0", "CREATE", RESTORE]
        return original_update(path, changes)
    monkeypatch.setattr(backup, "update_manifest", update)
    result = backup.create_restore_target(SOURCE, fixture.archive, RESTORE, approved=True)
    assert result["status"] == "created_empty" and result["database"] == RESTORE
    assert old_manifest.read_bytes() == retained[0] and old_claim.read_bytes() == retained[1]


def reserve_simulated_restore(fixture):
    completed = backup.create_backup(SOURCE, fixture.archive, approved=True)
    manifest = backup._restore_manifest(fixture.archive)
    backup.exclusive_manifest(manifest, {"database": RESTORE, "archive": str(fixture.archive), "sha256": completed["sha256"], "status": "created_empty"})
    return manifest


@pytest.mark.parametrize("recorded,actual", [(None, "2.41"), ("2.40", "2.41"), ("2.41", None), ("2.41", "2.42")])
def test_invalid_target_recorded_or_actual_version_blocks_native_restore(simulated_backup, monkeypatch, recorded, actual):
    fixture = simulated_backup
    reserve_simulated_restore(fixture)
    monkeypatch.setattr(backup, "_empty_target", MagicMock())
    monkeypatch.setattr(backup, "inspect_allowed_postgres", MagicMock())
    original = backup._collation_evidence
    def invalid_target(connection, database):
        evidence = original(connection, database)
        evidence["metadata"][5] = recorded
        evidence["actual_version"] = actual
        return evidence
    monkeypatch.setattr(backup, "_collation_evidence", invalid_target)
    with pytest.raises(shared.SafetyError):
        backup.restore_archive(SOURCE, fixture.archive, RESTORE, approved=True)
    assert "restore" not in fixture.calls


@pytest.mark.parametrize("drift", ["target_recorded", "target_actual", "source_actual"])
def test_post_restore_collation_drift_never_marks_recovery_verified(simulated_backup, monkeypatch, drift):
    fixture = simulated_backup
    manifest = reserve_simulated_restore(fixture)
    monkeypatch.setattr(backup, "_empty_target", MagicMock())
    monkeypatch.setattr(backup, "inspect_allowed_postgres", MagicMock())
    original = backup._collation_evidence
    target_checks = []
    def target_evidence(connection, database):
        evidence = original(connection, database)
        target_checks.append(database)
        if len(target_checks) == 2:
            if drift == "target_recorded":
                evidence["metadata"][5] = None
            elif drift == "target_actual":
                evidence["actual_version"] = "2.42"
        return evidence
    monkeypatch.setattr(backup, "_collation_evidence", target_evidence)
    source_reads = []
    def source_evidence(*args):
        source_reads.append(True)
        if drift == "source_actual" and len(source_reads) == 2:
            raise backup.BackupSafetyError("SOURCE_COLLATION_VERSION_MISMATCH")
        return collation_evidence()
    monkeypatch.setattr(backup, "_read_source_collation", source_evidence)
    with pytest.raises(shared.SafetyError):
        backup.restore_archive(SOURCE, fixture.archive, RESTORE, approved=True)
    assert fixture.calls.count("restore") == 1
    assert len(source_reads) == 2
    if drift != "source_actual":
        assert target_checks == [RESTORE, RESTORE]
    assert json.loads(manifest.read_text())["status"] == "failed_unknown"


def test_stage_diagnostics_never_persist_raw_database_errors_or_secrets(simulated_backup, monkeypatch, capsys):
    fixture = simulated_backup
    backup.create_backup(SOURCE, fixture.archive, approved=True)
    runtime = creation_engines(monkeypatch)
    marker = "synthetic-private-driver-details"
    runtime.engines.side_effect = RuntimeError(marker)
    with pytest.raises(shared.SafetyError) as caught:
        backup.create_restore_target(SOURCE, fixture.archive, RESTORE, approved=True)
    state = json.loads(backup._restore_manifest(fixture.archive).read_text())
    assert state["status"] == "failed_unknown"
    assert state["failure_stage"] == "ADMIN_ENGINE"
    assert state["failure_code"] == "CREATE_TARGET_OPERATION_FAILED"
    assert marker not in str(caught.value) and marker not in json.dumps(state) and marker not in capsys.readouterr().out


@pytest.mark.parametrize("field,value", [(0, "LATIN1"), (1, "C"), (2, "C"), (3, "i"), (4, "en-US")])
def test_new_target_locale_drift_blocks_native_restore(simulated_backup, monkeypatch, field, value):
    fixture = simulated_backup
    reserve_simulated_restore(fixture)
    monkeypatch.setattr(backup, "_empty_target", MagicMock())
    original = backup._collation_evidence
    def invalid_locale(connection, database):
        evidence = original(connection, database)
        evidence["metadata"][field] = value
        return evidence
    monkeypatch.setattr(backup, "_collation_evidence", invalid_locale)
    with pytest.raises(shared.SafetyError):
        backup.restore_archive(SOURCE, fixture.archive, RESTORE, approved=True)
    assert "restore" not in fixture.calls


def test_source_actual_version_drift_blocks_restore_before_any_target_connection(simulated_backup, monkeypatch):
    fixture = simulated_backup
    reserve_simulated_restore(fixture)
    forbidden = MagicMock(side_effect=AssertionError("Source version drift must fail before a target connection"))
    monkeypatch.setattr(backup, "_backup_engine", forbidden)
    monkeypatch.setattr(backup, "_read_source_collation", MagicMock(side_effect=backup.BackupSafetyError("SOURCE_COLLATION_VERSION_MISMATCH")))
    with pytest.raises(shared.SafetyError):
        backup.restore_archive(SOURCE, fixture.archive, RESTORE, approved=True)
    forbidden.assert_not_called()
    assert "restore" not in fixture.calls


def test_collation_fix_does_not_weaken_or_extend_the_existing_six_field_fingerprint():
    fingerprint = backup.source_fingerprint(fingerprint_connection())
    assert set(fingerprint) == {"revision", "schema_sha256", "catalog", "database_metadata", "server_major", "financial"}
    assert fingerprint["database_metadata"] == COLLATION_METADATA
    assert len(fingerprint["database_metadata"]) == 6
    assert fingerprint["database_metadata"][5] == "2.41"
    retained = json.dumps(fingerprint, sort_keys=True)
    template_metadata = list(COLLATION_METADATA); template_metadata[5] = None
    evidence = collation_evidence("template0", metadata=template_metadata, template=True, connections=False)
    backup.validate_template_collation(fingerprint["database_metadata"], collation_evidence(), evidence)
    assert evidence["metadata"][5] is None
    assert json.dumps(fingerprint, sort_keys=True) == retained
