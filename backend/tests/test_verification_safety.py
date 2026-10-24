"""Behavioral safety regressions with fake Docker/DB; no live DB calls allowed."""
from importlib.util import module_from_spec, spec_from_file_location
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from sqlalchemy.exc import ProgrammingError

from verification import db_safety as safety

ROOT = Path(__file__).resolve().parents[2]
SOURCE = "postgresql+psycopg://synthetic:unused@127.0.0.1:5434/finance_dashboard"
TARGET = "finance_dashboard_phase5_f0e1554a4e98"


def load_script(relative, name):
    spec = spec_from_file_location(name, ROOT / relative)
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize("query", ["host=remote.example", "hostaddr=192.0.2.1", "port=5432", "dbname=other", "service=other", "servicefile=elsewhere", "user=other", "options=-csearch_path=other", "sslmode=disable"])
def test_source_url_rejects_every_query_override(query):
    with pytest.raises(safety.SafetyError):
        safety.canonical_source_url(SOURCE + "?" + query, environ={})


@pytest.mark.parametrize("url", [SOURCE + "#fragment", SOURCE.replace("127.0.0.1", "localhost"), SOURCE.replace(":5434", ":5432"), SOURCE.replace("finance_dashboard", TARGET), SOURCE.replace("127.0.0.1", "192.0.2.1")])
def test_source_url_is_exact_and_fragment_free(url):
    with pytest.raises(safety.SafetyError):
        safety.canonical_source_url(url, environ={})


@pytest.mark.parametrize("name", ["PGHOST", "PGHOSTADDR", "PGPORT", "PGDATABASE", "PGSERVICE", "PGSERVICEFILE", "PGOPTIONS", "PGPASSFILE", "PGPASSWORD", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG", "DOCKER_TLS_VERIFY"])
def test_environment_redirects_fail_before_database_or_docker(monkeypatch, name):
    inspect = MagicMock(side_effect=AssertionError("Docker must not run"))
    create = MagicMock(side_effect=AssertionError("DB must not run"))
    monkeypatch.setattr(safety, "inspect_allowed_postgres", inspect)
    monkeypatch.setattr(safety, "create_engine", create)
    with pytest.raises(safety.SafetyError):
        safety.guarded_engine(SOURCE, TARGET, mode="target_write", environ={name: "synthetic-override"})
    inspect.assert_not_called(); create.assert_not_called()


@pytest.mark.parametrize("database", ["finance_dashboard", "postgres", "other", "finance_dashboard_phase5_012345ABCDEf", "finance_dashboard_phase5_012345abcde", 'finance_dashboard_phase5_f0e1554a4e98";DROP DATABASE other;--'])
def test_write_mode_rejects_every_nonfixed_namespace_before_engine(monkeypatch, database):
    create = MagicMock()
    monkeypatch.setattr(safety, "create_engine", create)
    with pytest.raises(safety.SafetyError):
        safety.guarded_engine(SOURCE, database, mode="target_write", environ={})
    create.assert_not_called()


def docker_record():
    return {"name": "/backend-postgres-1", "project": "backend", "service": "postgres", "running": True, "health": "healthy", "ports": {"5432/tcp": [{"HostIp": "127.0.0.1", "HostPort": "5434"}]}}


def fake_docker(monkeypatch, record):
    monkeypatch.setattr(safety.pwd, "getpwuid", lambda _: SimpleNamespace(pw_dir=str(ROOT / ".docker-test.local")))
    monkeypatch.setattr(safety.Path, "stat", lambda _: SimpleNamespace(st_mode=stat.S_IFSOCK | 0o600))
    run = MagicMock(return_value=SimpleNamespace(stdout=json.dumps(record)))
    monkeypatch.setattr(safety.subprocess, "run", run)
    return run


@pytest.mark.parametrize("change", [{"name": "/other-postgres-1"}, {"project": "other"}, {"service": "other"}, {"running": False}, {"health": "starting"}, {"ports": {"5432/tcp": [{"HostIp": "0.0.0.0", "HostPort": "5434"}]}}, {"ports": {"5432/tcp": [{"HostIp": "127.0.0.1", "HostPort": "5432"}]}}, {"ports": {"5432/tcp": [{"HostIp": "127.0.0.1", "HostPort": "5434"}, {"HostIp": "::", "HostPort": "5434"}]}}])
def test_wrong_container_labels_health_or_live_binding_are_refused(monkeypatch, change):
    fake_docker(monkeypatch, docker_record() | change)
    with pytest.raises(safety.SafetyError):
        safety.inspect_allowed_postgres(environ={})


def test_docker_inspection_uses_pinned_local_socket_and_only_allowed_container(monkeypatch):
    run = fake_docker(monkeypatch, docker_record())
    assert safety.inspect_allowed_postgres(environ={"PATH": "untrusted"}) == docker_record()
    command = run.call_args.args[0]
    assert command[:3] == [safety.DOCKER_BINARY, "--host", "unix://" + str(ROOT / ".docker-test.local/.docker/run/docker.sock")]
    assert "backend-postgres-1" in command and "--type" in command
    assert run.call_args.kwargs["env"]["PATH"] == "/usr/bin:/bin:/usr/sbin:/sbin"
    run.reset_mock()
    with pytest.raises(safety.SafetyError):
        safety.inspect_allowed_postgres(environ={"DOCKER_HOST": "tcp://192.0.2.1:2375"})
    run.assert_not_called()


def fake_engine_factory(monkeypatch):
    listeners, created = {}, []
    monkeypatch.setattr(safety, "inspect_allowed_postgres", MagicMock(return_value=docker_record()))
    def listens_for(engine, name, **options):
        def register(callback):
            listeners[name] = callback
            return callback
        return register
    monkeypatch.setattr(safety.event, "listens_for", listens_for)
    monkeypatch.setattr(safety, "create_engine", lambda url, **kwargs: created.append((url, kwargs)) or MagicMock())
    return listeners, created


def test_engine_canonical_parameters_revalidated_before_connect_and_checkout(monkeypatch):
    listeners, created = fake_engine_factory(monkeypatch)
    environment = {}
    safety.guarded_engine(SOURCE, TARGET, "target_write", environ=environment)
    params = created[0][1]["connect_args"]
    assert {key: params[key] for key in ("host", "hostaddr", "port", "dbname")} == {"host": "127.0.0.1", "hostaddr": "127.0.0.1", "port": 5434, "dbname": TARGET}
    listeners["do_connect"](None, None, [], params.copy())
    for override in [{"host": "other"}, {"hostaddr": "192.0.2.1"}, {"dbname": "finance_dashboard"}, {"service": "other"}]:
        with pytest.raises(safety.SafetyError):
            listeners["do_connect"](None, None, [], params | override)
    with pytest.raises(safety.SafetyError):
        listeners["do_connect"](None, None, ["dsn"], params.copy())
    environment["PGHOST"] = "other"
    with pytest.raises(safety.SafetyError):
        listeners["checkout"](None, None, None)


@pytest.mark.parametrize("actual,setting", [("finance_dashboard", "on"), (TARGET, "off")])
def test_database_identity_and_readonly_are_verified_before_handoff(monkeypatch, actual, setting):
    listeners, _ = fake_engine_factory(monkeypatch)
    safety.guarded_engine(SOURCE, TARGET, "readonly", environ={})
    connection = MagicMock(autocommit=False, closed=False)
    connection.cursor.return_value.__enter__.return_value.fetchone.return_value = (actual, setting)
    with pytest.raises(safety.SafetyError):
        listeners["connect"](connection, None)
    connection.close.assert_called_once()


def test_manifest_is_durable_before_create_and_duplicate_creation_never_reaches_seeding(monkeypatch, tmp_path):
    path = tmp_path / "reservation.local"
    events = []
    original_sync = safety.os.fsync
    def sync(descriptor):
        events.append("directory-sync" if stat.S_ISDIR(os.fstat(descriptor).st_mode) else "file-sync")
        original_sync(descriptor)
    monkeypatch.setattr(safety.os, "fsync", sync)
    safety.reserve_manifest(path, TARGET)
    assert events == ["file-sync", "directory-sync"]
    engine = MagicMock()
    connection = engine.connect.return_value.__enter__.return_value
    connection.scalar.side_effect = ["postgres", "170000"]
    def execute(sql, *args):
        if str(sql).startswith("CREATE DATABASE"):
            # Reservation+claim+creating-stage were all durably synced first.
            assert events.count("file-sync") >= 3 and events.count("directory-sync") >= 3
            assert safety.load_manifest(path)["stage"] == "creating"
            events.append("create")
            raise ProgrammingError("duplicate database", None, Exception("already exists"))
    connection.execute.side_effect = execute
    monkeypatch.setattr(safety, "guarded_engine", lambda *args, **kwargs: engine)
    with pytest.raises(safety.SafetyError):
        safety.create_reserved_database(SOURCE, path, environ={})
    assert events.count("create") == 1
    assert safety.load_manifest(path)["stage"] == "failed"
    connection.reset_mock()
    with pytest.raises(safety.SafetyError):
        safety.create_reserved_database(SOURCE, path, environ={})
    connection.execute.assert_not_called()


def test_existing_manifest_and_symlink_are_never_overwritten(tmp_path):
    path = tmp_path / "manifest.local"
    safety.reserve_manifest(path, TARGET)
    before = path.read_bytes()
    with pytest.raises(safety.SafetyError):
        safety.reserve_manifest(path, TARGET)
    assert path.read_bytes() == before
    alias = tmp_path / "alias.local"
    alias.symlink_to(path)
    with pytest.raises(safety.SafetyError):
        safety.reserve_manifest(alias, TARGET)
    with pytest.raises(safety.SafetyError):
        safety.load_manifest(alias)
    assert path.read_bytes() == before


def test_server_stops_before_migration_or_seeding_if_creation_fails(monkeypatch, tmp_path):
    server = load_script("tests/phase5_server.py", "phase5_failed_create")
    monkeypatch.setattr(server, "STATE", tmp_path / "server.local")
    monkeypatch.setattr(server, "fingerprint", lambda _: {"unchanged": True})
    def duplicate(*args, **kwargs):
        raise safety.SafetyError("duplicate")
    monkeypatch.setattr(server, "create_reserved_database", duplicate)
    engine = MagicMock(side_effect=AssertionError("No target seeding or migration after failed CREATE"))
    monkeypatch.setattr(server, "guarded_engine", engine)
    with pytest.raises(safety.SafetyError):
        server.prepare(safety.canonical_source_url(SOURCE, environ={}), TARGET)
    engine.assert_not_called()


def test_read_only_inspection_never_uses_write_mode(monkeypatch):
    calls = []
    engine = MagicMock()
    connection = engine.connect.return_value.__enter__.return_value
    connection.scalar.side_effect = ["postgres"]
    connection.execute.return_value.scalars.return_value.all.return_value = [TARGET]
    def factory(source, database, mode="readonly", environ=None):
        calls.append((database, mode))
        return engine
    monkeypatch.setattr(safety, "guarded_engine", factory)
    monkeypatch.setattr(safety, "preservation_snapshot", lambda _: {"preserved": True})
    result = safety.read_only_inspection(SOURCE, environ={})
    assert calls == [("postgres", "readonly"), ("finance_dashboard", "readonly")]
    assert result["matching_disposable_databases"] == [TARGET]
    assert all(not str(call.args[0]).startswith(("CREATE", "INSERT", "UPDATE", "DELETE")) for call in connection.execute.call_args_list)


def test_verification_imports_and_retired_phase4_cli_perform_no_external_io(monkeypatch):
    forbidden = MagicMock(side_effect=AssertionError("External IO is forbidden"))
    monkeypatch.setattr(safety, "create_engine", forbidden)
    monkeypatch.setattr(safety.subprocess, "run", forbidden)
    import sqlalchemy
    monkeypatch.setattr(sqlalchemy, "create_engine", forbidden)
    load_script("backend/verification/db_safety.py", "safety_import_only")
    load_script("tests/phase5_server.py", "phase5_import_only")
    load_script("backend/verification/auth_migration_proof.py", "proof_import_only")
    load_script("backend/verification/read_only_inspect.py", "inspection_import_only")
    retired = load_script("tests/phase4_server.py", "phase4_retired")
    monkeypatch.setattr(retired, "config", forbidden)
    for mode in ("serve", "seed", "verify"):
        monkeypatch.setattr(sys, "argv", ["phase4_server.py", mode])
        with pytest.raises(RuntimeError, match="retired"):
            retired.main()
    forbidden.assert_not_called()


def test_guards_remain_active_under_optimized_python():
    code = """from verification.db_safety import canonical_source_url, canonical_test_url, SafetyError
source = 'postgresql+psycopg://synthetic:unused@127.0.0.1:5434/finance_dashboard'
for action in (lambda: canonical_source_url(source+'?host=other', environ={}), lambda: canonical_test_url(source, 'finance_dashboard', environ={}), lambda: canonical_source_url(source, environ={'PGHOST':'other'})):
    try: action()
    except SafetyError: continue
    raise SystemExit('guard failed under optimized Python')
print('optimized guards active')
"""
    environment = dict(os.environ, PYTHONPATH=str(ROOT / "backend"), PYTHONPYCACHEPREFIX=str(ROOT / "backend/.pycache.local"))
    result = subprocess.run([sys.executable, "-O", "-c", code], cwd=ROOT, env=environment, capture_output=True, text=True, check=False)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "optimized guards active"


def test_late_environment_redirect_is_refused_before_dbapi_connect(monkeypatch):
    listeners, _ = fake_engine_factory(monkeypatch)
    # Keep the real environment check while substituting the external Docker read.
    def checked_inspection(environ=None):
        safety.validate_environment(environ)
        return docker_record()
    monkeypatch.setattr(safety, "inspect_allowed_postgres", checked_inspection)
    environment = {}
    safety.guarded_engine(SOURCE, TARGET, "target_write", environ=environment)
    environment["PGSERVICE"] = "late-redirect"
    with pytest.raises(safety.SafetyError):
        listeners["do_connect"](None, None, [], {})


def test_runtime_app_factory_cannot_bypass_the_shared_connection_guard(monkeypatch):
    import app.main as application
    from app.config import Settings
    from pydantic import SecretStr
    server = load_script("tests/phase5_server.py", "phase5_runtime_binding")
    source = safety.canonical_source_url(SOURCE, environ={})
    target = safety.canonical_test_url(source, TARGET, environ={})
    settings = Settings(_env_file=None, DATABASE_URL=target.render_as_string(hide_password=False))
    fake_app = MagicMock()
    monkeypatch.setattr(application, "create_app", lambda _: fake_app)
    monkeypatch.setattr(application, "create_database_engine", MagicMock())
    guarded = MagicMock(return_value="guarded-runtime-engine")
    monkeypatch.setattr(server, "guarded_engine", guarded)
    assert server.build_app(settings, source, {"database": TARGET, "run_nonce": "a" * 64}) is fake_app
    assert application.create_database_engine(settings) == "guarded-runtime-engine"
    guarded.assert_called_once_with(source, TARGET, mode="target_write")
    guarded.reset_mock()
    redirected = settings.model_copy(update={"database_url": SecretStr(SOURCE)})
    with pytest.raises(safety.SafetyError):
        application.create_database_engine(redirected)
    with pytest.raises(safety.SafetyError):
        server.build_app(redirected, source, {"database": TARGET, "run_nonce": "a" * 64})
    guarded.assert_not_called()


def test_manifest_identifier_and_incomplete_state_cannot_be_rebound_or_served(tmp_path):
    path = tmp_path / "reserved.local"
    safety.reserve_manifest(path, TARGET)
    with pytest.raises(safety.SafetyError):
        safety.update_manifest(path, {"database": "finance_dashboard"})
    with pytest.raises(safety.SafetyError):
        safety.load_manifest(path, require_stage="ready")
    assert safety.load_manifest(path)["database"] == TARGET


def test_server_requires_explicit_target_before_any_configuration_or_io(monkeypatch):
    server = load_script("tests/phase5_server.py", "phase5_explicit_target")
    forbidden = MagicMock(side_effect=AssertionError("Missing target must fail before configuration"))
    monkeypatch.setattr(server, "source_settings", forbidden)
    monkeypatch.setattr(sys, "argv", ["phase5_server.py", "prepare"])
    with pytest.raises(SystemExit) as caught:
        server.main()
    assert caught.value.code == 2
    forbidden.assert_not_called()


def test_server_verifies_target_before_serving_and_disables_proxy_headers(monkeypatch):
    server = load_script("tests/phase5_server.py", "phase5_safe_serve")
    state = {"database": TARGET, "run_nonce": "a" * 64}
    monkeypatch.setattr(server, "ready_state", lambda: state)
    engine = MagicMock()
    events = []
    monkeypatch.setattr(server, "guarded_engine", lambda *args, **kwargs: engine)
    monkeypatch.setattr(server, "verify_target", lambda *args: events.append("verified"))
    app = object()
    monkeypatch.setattr(server, "build_app", lambda *args: app)
    def run(received, **options):
        assert events == ["verified"]
        assert received is app
        assert options == {"host": "127.0.0.1", "port": 18085, "access_log": False, "proxy_headers": False}
        events.append("served")
    monkeypatch.setitem(sys.modules, "uvicorn", SimpleNamespace(run=run))
    settings = SimpleNamespace(model_copy=lambda **kwargs: SimpleNamespace())
    server.serve(settings, safety.canonical_source_url(SOURCE, environ={}))
    assert events == ["verified", "served"]
    engine.dispose.assert_called_once()


def test_manifest_public_permissions_and_hardlinks_are_refused(tmp_path):
    path = tmp_path / "manifest.local"
    safety.reserve_manifest(path, TARGET)
    path.chmod(0o644)
    with pytest.raises(safety.SafetyError):
        safety.load_manifest(path)
    path.chmod(0o600)
    os.link(path, tmp_path / "hardlink.local")
    with pytest.raises(safety.SafetyError):
        safety.load_manifest(path)


@pytest.mark.parametrize("url", [
    "postgresql+psycopg://127.0.0.1:5434/finance_dashboard",
    "postgresql+psycopg://synthetic@127.0.0.1:5434/finance_dashboard",
    "postgresql+psycopg://synthetic:@127.0.0.1:5434/finance_dashboard",
    "postgresql+psycopg://:unused@127.0.0.1:5434/finance_dashboard",
])
def test_explicit_nonempty_credentials_prevent_pgpass_fallback(monkeypatch, url):
    create = MagicMock(side_effect=AssertionError("Incomplete credentials must fail before connecting"))
    monkeypatch.setattr(safety, "create_engine", create)
    with pytest.raises(safety.SafetyError):
        safety.guarded_engine(url, TARGET, mode="target_write", environ={})
    create.assert_not_called()


def test_only_the_dialects_own_adapter_context_may_extend_connection_parameters(monkeypatch):
    listeners, created = fake_engine_factory(monkeypatch)
    safety.guarded_engine(SOURCE, TARGET, "target_write", environ={})
    params = created[0][1]["connect_args"]
    adapter = object()
    dialect = SimpleNamespace(_psycopg_adapters_map=adapter)
    listeners["do_connect"](dialect, None, [], params | {"context": adapter})
    for context in (None, object()):
        with pytest.raises(safety.SafetyError):
            listeners["do_connect"](dialect, None, [], params | {"context": context})


@pytest.mark.parametrize("name", ["PGHOST", "DOCKER_HOST"])
def test_injected_empty_environment_cannot_hide_real_process_redirects(monkeypatch, name):
    monkeypatch.setenv(name, "synthetic-redirect")
    with pytest.raises(safety.SafetyError):
        safety.canonical_source_url(SOURCE, environ={})


def test_regex_valid_third_database_is_refused_before_engine_or_manifest(monkeypatch, tmp_path):
    third = "finance_dashboard_phase5_111111111111"
    create = MagicMock(side_effect=AssertionError("Unapproved database must not reach an engine"))
    monkeypatch.setattr(safety, "create_engine", create)
    with pytest.raises(safety.SafetyError):
        safety.guarded_engine(SOURCE, third, mode="target_write", environ={})
    with pytest.raises(safety.SafetyError):
        safety.reserve_manifest(tmp_path / "unapproved.local", third)
    assert not (tmp_path / "unapproved.local").exists()
    create.assert_not_called()


def raw_connection(database):
    raw = MagicMock(autocommit=False, closed=False)
    checker = raw.cursor.return_value
    checker.__enter__.return_value = checker
    checker.fetchone.return_value = (database,)
    connection = SimpleNamespace(connection=SimpleNamespace(driver_connection=raw, dbapi_connection=raw, cursor=raw.cursor),
                                 execute=MagicMock(side_effect=AssertionError("Guard must not recurse through SQLAlchemy")),
                                 scalar=MagicMock(side_effect=AssertionError("Guard must use raw DBAPI")),
                                 exec_driver_sql=MagicMock(side_effect=AssertionError("Guard must use raw DBAPI")))
    return connection, raw, checker


def call_statement_guard(listeners, connection, statement):
    return listeners["before_cursor_execute"](connection, MagicMock(), statement, {}, None, False)


def test_each_changing_statement_rechecks_raw_database_without_recursion_or_transaction_changes(monkeypatch):
    listeners, _ = fake_engine_factory(monkeypatch)
    safety.guarded_engine(SOURCE, TARGET, "target_write", environ={})
    connection, raw, checker = raw_connection(TARGET)
    statements = ["CREATE TABLE synthetic (id integer)", "INSERT INTO synthetic VALUES (1)", "UPDATE synthetic SET id=2", "DELETE FROM synthetic WHERE id=2", "ALTER TABLE synthetic ADD COLUMN note text"]
    for index, statement in enumerate(statements, start=1):
        call_statement_guard(listeners, connection, statement)
        assert checker.execute.call_count == index
        assert "current_database()" in checker.execute.call_args.args[0]
    assert raw.autocommit is False
    raw.commit.assert_not_called(); raw.rollback.assert_not_called()
    connection.execute.assert_not_called(); connection.scalar.assert_not_called(); connection.exec_driver_sql.assert_not_called()
    checker.fetchone.return_value = ("finance_dashboard",)
    with pytest.raises(safety.SafetyError):
        call_statement_guard(listeners, connection, "INSERT INTO synthetic VALUES (3)")


def test_readonly_transaction_controls_are_not_preceded_by_raw_select(monkeypatch):
    listeners, _ = fake_engine_factory(monkeypatch)
    safety.guarded_engine(SOURCE, "finance_dashboard", "readonly", environ={})
    connection, raw, checker = raw_connection("finance_dashboard")
    call_statement_guard(listeners, connection, "SET TRANSACTION READ ONLY")
    checker.execute.assert_not_called()
    assert raw.autocommit is False
    raw.commit.assert_not_called(); raw.rollback.assert_not_called()
    with pytest.raises(safety.SafetyError):
        call_statement_guard(listeners, connection, "UPDATE transactions SET title='Forbidden'")


def test_admin_connection_accepts_only_approved_create_and_reads(monkeypatch):
    listeners, _ = fake_engine_factory(monkeypatch)
    safety.guarded_engine(SOURCE, "postgres", "create_admin", environ={})
    connection, raw, checker = raw_connection("postgres")
    call_statement_guard(listeners, connection, 'CREATE DATABASE "' + TARGET + '"')
    assert checker.execute.call_count == 1
    call_statement_guard(listeners, connection, "SELECT current_database()")
    call_statement_guard(listeners, connection, "SHOW server_version_num")
    for forbidden in ['CREATE DATABASE "finance_dashboard_phase5_111111111111"', 'DROP DATABASE "' + TARGET + '"', "INSERT INTO users VALUES (1)", "UPDATE pg_database SET datname='other'", "CREATE TABLE unintended(id integer)", 'CREATE DATABASE "' + TARGET + '"; DROP DATABASE other', "SELECT 1; UPDATE pg_database SET datname='other'", "WITH changed AS (DELETE FROM users RETURNING id) SELECT * FROM changed"]:
        with pytest.raises(safety.SafetyError):
            call_statement_guard(listeners, connection, forbidden)
    raw.commit.assert_not_called(); raw.rollback.assert_not_called()
