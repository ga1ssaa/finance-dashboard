"""Effective migration target checks. Synthetic driver/server replies only; no network."""
import runpy
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

from alembic.config import Config
from pydantic import SecretStr
import pytest
from sqlalchemy.engine import make_url

from app.production_migrations import (
    AUTHORIZATION, IDENTITY_FAILURE_CODES, IdentityVerificationError,
    checked_target, require_authorization,
)

LOCAL = 'postgresql+psycopg://synthetic:unused@127.0.0.1:5434/synthetic_local'
REMOTE = 'postgresql+psycopg://synthetic:unused@synthetic.example.amazonaws.com:5432/synthetic_production'
CA = '/synthetic/approved-ca.pem'


def settings(url=LOCAL, mode='development'):
    return SimpleNamespace(database_url=SecretStr(url), app_env=mode, database_sslrootcert=CA)


def synthetic_connection(url=LOCAL):
    target = make_url(url)
    remote = target.host not in {'localhost','127.0.0.1','::1','postgres'}
    address = '203.0.113.10' if remote else '127.0.0.1'
    info = SimpleNamespace(host=target.host, port=target.port or 5432, dbname=target.database,
                           user=target.username, hostaddr=address,
                           get_parameters=lambda: {'sslmode':'verify-full','sslrootcert':CA})
    driver = MagicMock()
    driver.info = info
    driver.pgconn = SimpleNamespace(ssl_in_use=True)
    cursor = driver.cursor.return_value.__enter__.return_value
    cursor.fetchone.return_value = (target.database,target.username,target.username,address,5432)
    connection = SimpleNamespace(engine=SimpleNamespace(url=target), connection=SimpleNamespace(driver_connection=driver),
                                 execute=MagicMock(side_effect=AssertionError('No SQLAlchemy recursion permitted')))
    return connection, driver, cursor


def config_for(connection, *, authorized=False):
    config = Config()
    config.attributes['connection'] = connection
    if authorized:
        config.attributes['production_authorization'] = AUTHORIZATION
    return config


@pytest.mark.parametrize('url', [LOCAL, LOCAL.replace('127.0.0.1','localhost'), LOCAL.replace('127.0.0.1','[::1]'), LOCAL.replace('127.0.0.1','postgres')])
def test_approved_local_connection_is_checked_without_changing_caller_transaction(url):
    connection,driver,cursor = synthetic_connection(url)
    require_authorization(settings(url),config_for(connection))
    cursor.execute.assert_called_once()
    assert cursor.execute.call_args.args[0].startswith('SELECT current_database(), current_user, session_user')
    driver.commit.assert_not_called();driver.rollback.assert_not_called();driver.close.assert_not_called()
    connection.execute.assert_not_called()


def test_approved_production_connection_requires_both_authorization_and_effective_identity():
    connection,_,cursor = synthetic_connection(REMOTE)
    require_authorization(settings(REMOTE,'production'),config_for(connection,authorized=True))
    cursor.execute.assert_called_once()


def test_original_development_settings_remote_connection_bypass_is_rejected_before_any_sql():
    connection,_,cursor = synthetic_connection(REMOTE)
    with pytest.raises(RuntimeError):require_authorization(settings(),config_for(connection))
    cursor.execute.assert_not_called()


@pytest.mark.parametrize('actual', [LOCAL.replace('synthetic_local','other'), LOCAL.replace(':5434',':5435'), LOCAL.replace('synthetic:','other:'), REMOTE])
def test_configured_and_supplied_connection_target_mismatch_fails_closed(actual):
    connection,_,cursor = synthetic_connection(actual)
    with pytest.raises(RuntimeError):require_authorization(settings(),config_for(connection))
    cursor.execute.assert_not_called()


@pytest.mark.parametrize('field,value', [('host','synthetic.example.amazonaws.com'),('port',5432),('dbname','other'),('user','other'),('hostaddr','203.0.113.10'),('hostaddr',''),('port','5434')])
def test_forged_engine_url_cannot_hide_effective_driver_redirect(field,value):
    connection,driver,cursor = synthetic_connection()
    setattr(driver.info,field,value)
    with pytest.raises(RuntimeError):require_authorization(settings(),config_for(connection))
    cursor.execute.assert_not_called()


@pytest.mark.parametrize('row', [('other','synthetic','synthetic','127.0.0.1',5432),('synthetic_local','other','synthetic','127.0.0.1',5432),('synthetic_local','synthetic','other','127.0.0.1',5432),('synthetic_local','synthetic','synthetic','203.0.113.10',5432),('synthetic_local','synthetic','synthetic',None,5432),None,()])
def test_server_identity_overrides_plausible_connection_metadata(row):
    connection,_,cursor = synthetic_connection()
    cursor.fetchone.return_value = row
    with pytest.raises(RuntimeError):require_authorization(settings(),config_for(connection))


@pytest.mark.parametrize('connection', [SimpleNamespace(),SimpleNamespace(engine=SimpleNamespace(url=LOCAL)),MagicMock()])
def test_missing_or_unverifiable_connection_metadata_is_rejected(connection):
    with pytest.raises(RuntimeError):require_authorization(settings(),config_for(connection))


@pytest.mark.parametrize('raw', ['',None,'private-invalid-marker','sqlite:///unused','postgresql+psycopg://localhost/unused','postgresql+psycopg://synthetic:unused@localhost:0/unused',LOCAL+'?host=remote.example',LOCAL+'?hostaddr=203.0.113.10',LOCAL+'?service=other',LOCAL+'?dbname=other',LOCAL+'#fragment'])
def test_malformed_or_routing_override_urls_fail_without_disclosure(raw):
    with pytest.raises(RuntimeError) as error:checked_target(raw)
    assert 'private-invalid-marker' not in str(error.value)


@pytest.mark.parametrize('authorized', [False,True])
def test_development_cannot_authorize_a_remote_target_using_caller_metadata(authorized):
    connection,_,cursor = synthetic_connection(REMOTE)
    config = config_for(connection,authorized=authorized)
    config.attributes['migration_target_url'] = REMOTE
    with pytest.raises(RuntimeError,match='Remote migrations'):
        require_authorization(settings(),config)
    cursor.execute.assert_not_called()


def test_explicit_local_proof_target_is_still_verified_and_remote_override_is_never_allowed():
    other = LOCAL.replace('synthetic_local','synthetic_disposable')
    connection,_,cursor = synthetic_connection(other)
    config = config_for(connection);config.attributes['migration_target_url'] = other
    require_authorization(settings(),config)
    cursor.execute.assert_called_once()
    # The declaration cannot disguise a driver actually attached to another DB.
    connection.connection.driver_connection.info.dbname = 'unapproved'
    with pytest.raises(RuntimeError):require_authorization(settings(),config)


def test_missing_production_authorization_is_rejected_without_querying_server():
    connection,_,cursor = synthetic_connection(REMOTE)
    with pytest.raises(RuntimeError,match='explicit'):
        require_authorization(settings(REMOTE,'production'),config_for(connection))
    cursor.execute.assert_not_called()


def test_production_authorization_cannot_be_transferred_to_another_connection_or_target():
    original,_,_ = synthetic_connection(REMOTE)
    other,_,cursor = synthetic_connection(REMOTE)
    with pytest.raises(RuntimeError):require_authorization(settings(REMOTE,'production'),config_for(original,authorized=True),connection=other)
    cursor.execute.assert_not_called()
    config = config_for(original,authorized=True);config.attributes['migration_target_url'] = LOCAL
    with pytest.raises(RuntimeError):require_authorization(settings(REMOTE,'production'),config)


@pytest.mark.parametrize('sslmode,ca,encrypted', [('require',CA,True),('verify-full','/other-ca.pem',True),('verify-full',CA,False)])
def test_production_supplied_connection_must_retain_verified_tls(sslmode,ca,encrypted):
    connection,driver,cursor = synthetic_connection(REMOTE)
    driver.info.get_parameters = lambda: {'sslmode':sslmode,'sslrootcert':ca}
    driver.pgconn.ssl_in_use = encrypted
    with pytest.raises(RuntimeError):require_authorization(settings(REMOTE,'production'),config_for(connection,authorized=True))
    cursor.execute.assert_not_called()


def test_driver_or_read_only_identity_probe_failure_never_reaches_migrations():
    connection,_,cursor = synthetic_connection()
    cursor.execute.side_effect = RuntimeError('sensitive-private-driver-marker')
    with pytest.raises(RuntimeError) as error:require_authorization(settings(),config_for(connection))
    assert 'sensitive-private-driver-marker' not in str(error.value)


@pytest.mark.parametrize('supplied,redirected', [(True,True),(False,True),(True,False),(False,False)])
def test_alembic_checks_both_supplied_and_new_connections_before_any_migration(monkeypatch,supplied,redirected):
    connection,driver,_ = synthetic_connection()
    if redirected:driver.info.dbname = 'unapproved'
    config = config_for(connection) if supplied else Config()
    context = MagicMock(config=config)
    context.is_offline_mode.return_value = False
    engine = MagicMock();engine.connect.return_value.__enter__.return_value = connection
    monkeypatch.setattr('alembic.context',context)
    monkeypatch.setattr('app.config.Settings',lambda:settings())
    monkeypatch.setattr('app.db.create_database_engine',lambda _:engine)
    path = Path(__file__).resolve().parents[1]/'alembic/env.py'
    if redirected:
        with pytest.raises(RuntimeError):runpy.run_path(str(path))
        context.configure.assert_not_called();context.run_migrations.assert_not_called()
    else:
        runpy.run_path(str(path));context.run_migrations.assert_called_once()


DIAGNOSTIC_CASES = [
    ('engine', 'ENGINE_TARGET_MISMATCH'),
    ('malformed_engine', 'ENGINE_TARGET_MISMATCH'),
    ('missing_engine', 'UNSUPPORTED_CONNECTION_METADATA'),
    ('missing_driver', 'UNSUPPORTED_CONNECTION_METADATA'),
    ('missing_host', 'UNSUPPORTED_CONNECTION_METADATA'),
    ('host', 'DRIVER_TARGET_MISMATCH'),
    ('port', 'DRIVER_TARGET_MISMATCH'),
    ('dbname', 'DRIVER_TARGET_MISMATCH'),
    ('user', 'DRIVER_TARGET_MISMATCH'),
    ('hostaddr', 'DRIVER_TARGET_MISMATCH'),
    ('tls_mode', 'TLS_POLICY_MISMATCH'),
    ('tls_ca', 'TLS_POLICY_MISMATCH'),
    ('tls_missing_mode', 'TLS_POLICY_MISMATCH'),
    ('tls_missing_ca', 'TLS_POLICY_MISMATCH'),
    ('tls_plaintext', 'TLS_POLICY_MISMATCH'),
    ('missing_parameters', 'UNSUPPORTED_CONNECTION_METADATA'),
    ('server_database', 'SERVER_DATABASE_MISMATCH'),
    ('server_user', 'SERVER_CURRENT_USER_MISMATCH'),
    ('session_user', 'SERVER_SESSION_USER_MISMATCH'),
    ('server_address', 'SERVER_ADDRESS_INVALID'),
    ('server_port', 'SERVER_PORT_INVALID'),
    ('missing_row', 'SERVER_IDENTITY_QUERY_INVALID'),
    ('short_row', 'SERVER_IDENTITY_QUERY_INVALID'),
    ('long_row', 'SERVER_IDENTITY_QUERY_INVALID'),
    ('non_sequence_row', 'SERVER_IDENTITY_QUERY_INVALID'),
    ('query', 'SERVER_IDENTITY_QUERY_FAILED'),
    ('fetch', 'SERVER_IDENTITY_QUERY_FAILED'),
    ('cursor_close', 'SERVER_IDENTITY_QUERY_FAILED'),
    ('timeout', 'IDENTITY_TIMEOUT'),
    ('metadata_timeout', 'IDENTITY_TIMEOUT'),
    ('unexpected', 'IDENTITY_CHECK_ERROR'),
]


def diagnostic_failure(case, connection, driver, cursor):
    private = 'synthetic-secret-details-never-print'
    if case == 'engine':
        connection.engine.url = make_url(REMOTE).set(database='unapproved')
    elif case == 'malformed_engine':
        connection.engine.url = private
    elif case == 'missing_engine':
        del connection.engine
    elif case == 'missing_driver':
        del connection.connection.driver_connection
    elif case == 'missing_host':
        del driver.info.host
    elif case in {'host', 'dbname', 'user', 'hostaddr', 'port'}:
        setattr(driver.info, case, 5433 if case == 'port' else private)
    elif case.startswith('tls_'):
        parameters = {'sslmode': 'verify-full', 'sslrootcert': CA}
        if case == 'tls_mode': parameters['sslmode'] = 'require'
        elif case == 'tls_ca': parameters['sslrootcert'] = private
        elif case == 'tls_missing_mode': del parameters['sslmode']
        elif case == 'tls_missing_ca': del parameters['sslrootcert']
        elif case == 'tls_plaintext': driver.pgconn.ssl_in_use = False
        driver.info.get_parameters = lambda: parameters
    elif case == 'missing_parameters':
        del driver.info.get_parameters
    elif case in {'server_database', 'server_user', 'session_user', 'server_address', 'server_port'}:
        row = list(cursor.fetchone.return_value)
        index = {'server_database': 0, 'server_user': 1, 'session_user': 2, 'server_address': 3, 'server_port': 4}[case]
        row[index] = private
        cursor.fetchone.return_value = tuple(row)
    elif case in {'query', 'timeout'}:
        cursor.execute.side_effect = TimeoutError(private) if case == 'timeout' else RuntimeError(private)
    elif case == 'fetch':
        cursor.fetchone.side_effect = RuntimeError(private)
    elif case == 'cursor_close':
        driver.cursor.return_value.__exit__.side_effect = RuntimeError(private)
    elif case in {'unexpected', 'metadata_timeout'}:
        def broken():
            raise TimeoutError(private) if case == 'metadata_timeout' else RuntimeError(private)
        driver.info.get_parameters = broken
    elif case == 'missing_row':
        cursor.fetchone.return_value = None
    elif case == 'short_row':
        cursor.fetchone.return_value = cursor.fetchone.return_value[:4]
    elif case == 'long_row':
        cursor.fetchone.return_value += (private,)
    elif case == 'non_sequence_row':
        cursor.fetchone.return_value = 1
    else:
        raise AssertionError('Unknown synthetic case')


@pytest.mark.parametrize('case,code', DIAGNOSTIC_CASES)
@pytest.mark.parametrize('entrypoint', ['authorization', 'runner'])
def test_fixed_diagnostics_block_authorization_and_runner(monkeypatch, case, code, entrypoint):
    from app import production_migrations as migrations
    import traceback

    connection, driver, cursor = synthetic_connection(REMOTE)
    diagnostic_failure(case, connection, driver, cursor)
    configured = settings(REMOTE, 'production')
    upgrade = MagicMock()
    monkeypatch.setattr(migrations.command, 'upgrade', upgrade)
    engine = MagicMock()
    engine.begin.return_value.__enter__.return_value = connection
    monkeypatch.setattr(migrations, 'create_database_engine', lambda _: engine)
    with pytest.raises(IdentityVerificationError) as error:
        if entrypoint == 'authorization':
            require_authorization(configured, config_for(connection, authorized=True))
        else:
            target = make_url(REMOTE)
            configured.production_database_host = target.host
            configured.production_database_name = target.database
            migrations.migrate_new_database(configured, target.host, target.database, migrations.PHRASE,
                                           environ={'DYNO': 'run.1234'})
    assert error.value.code == str(error.value) == code
    assert error.value.args == (code,)
    rendered = ''.join(traceback.format_exception(error.value))
    assert 'synthetic-secret-details-never-print' not in rendered
    assert REMOTE not in rendered
    upgrade.assert_not_called()
    connection.execute.assert_not_called()
    driver.commit.assert_not_called()
    driver.rollback.assert_not_called()
    if entrypoint == 'runner': engine.dispose.assert_called_once()


def test_diagnostic_allowlist_is_exact_and_error_output_revalidates():
    assert IDENTITY_FAILURE_CODES == {
        'ENGINE_TARGET_MISMATCH', 'DRIVER_TARGET_MISMATCH', 'TLS_POLICY_MISMATCH',
        'SERVER_IDENTITY_QUERY_INVALID', 'SERVER_DATABASE_MISMATCH',
        'SERVER_CURRENT_USER_MISMATCH', 'SERVER_SESSION_USER_MISMATCH',
        'SERVER_PORT_INVALID', 'SERVER_ADDRESS_INVALID', 'UNSUPPORTED_CONNECTION_METADATA',
        'SERVER_IDENTITY_QUERY_FAILED', 'IDENTITY_TIMEOUT', 'IDENTITY_CHECK_ERROR',
    }
    for value in ['unapproved-private-marker', None, {}, ['private']]:
        error = IdentityVerificationError(value)
        assert error.code == str(error) == 'IDENTITY_CHECK_ERROR'
    error.args = ('unapproved-private-marker',)
    assert error.code == str(error) == 'IDENTITY_CHECK_ERROR'


@pytest.mark.parametrize('address', ['203.0.113.10/32', '10.0.0.12/32', '2001:db8::1/128'])
def test_identity_query_uses_host_only_address_for_postgres_inet(address):
    from ipaddress import ip_interface
    connection, driver, cursor = synthetic_connection(REMOTE)
    original = cursor.fetchone.return_value

    def reply(statement):
        assert statement == ('SELECT current_database(), current_user, session_user, '
                             'pg_catalog.host(inet_server_addr()), inet_server_port()')
        # Synthetic SQL result per PostgreSQL host(inet) documentation, no SQL execution.
        cursor.fetchone.return_value = (*original[:3], str(ip_interface(address).ip), original[4])

    cursor.execute.side_effect = reply
    require_authorization(settings(REMOTE, 'production'), config_for(connection, authorized=True))
    cursor.execute.assert_called_once()
    driver.commit.assert_not_called(); driver.rollback.assert_not_called()


@pytest.mark.parametrize('index,value,code', [
    (0, None, 'SERVER_DATABASE_MISMATCH'),
    (1, None, 'SERVER_CURRENT_USER_MISMATCH'),
    (2, None, 'SERVER_SESSION_USER_MISMATCH'),
    (3, None, 'SERVER_ADDRESS_INVALID'),
    (3, '', 'SERVER_ADDRESS_INVALID'),
    (3, '203.0.113.10/32', 'SERVER_ADDRESS_INVALID'),
    (3, '2001:db8::1/128', 'SERVER_ADDRESS_INVALID'),
    (4, None, 'SERVER_PORT_INVALID'),
    (4, '5432', 'SERVER_PORT_INVALID'),
    (4, True, 'SERVER_PORT_INVALID'),
    (4, 0, 'SERVER_PORT_INVALID'),
    (4, 65536, 'SERVER_PORT_INVALID'),
])
def test_invalid_server_fields_still_block_authorization(index, value, code):
    connection, driver, cursor = synthetic_connection(REMOTE)
    row = list(cursor.fetchone.return_value)
    row[index] = value
    cursor.fetchone.return_value = tuple(row)
    with pytest.raises(IdentityVerificationError) as error:
        require_authorization(settings(REMOTE, 'production'), config_for(connection, authorized=True))
    assert error.value.code == code
    connection.execute.assert_not_called()
    driver.commit.assert_not_called(); driver.rollback.assert_not_called()


@pytest.mark.parametrize('url,address', [
    (LOCAL, '127.0.0.1'),
    (LOCAL.replace('127.0.0.1', '[::1]'), '::1'),
    (REMOTE, '10.0.0.12'),
    (REMOTE, '2001:db8::1'),
])
def test_valid_host_only_server_addresses_keep_existing_target_rules(url, address):
    connection, _, cursor = synthetic_connection(url)
    original = cursor.fetchone.return_value
    cursor.fetchone.return_value = (*original[:3], address, original[4])
    mode = 'production' if url == REMOTE else 'development'
    require_authorization(settings(url, mode), config_for(connection, authorized=mode == 'production'))


def test_local_target_cannot_accept_a_public_server_address():
    connection, _, cursor = synthetic_connection()
    original = cursor.fetchone.return_value
    cursor.fetchone.return_value = (*original[:3], '203.0.113.10', original[4])
    with pytest.raises(IdentityVerificationError, match='^SERVER_ADDRESS_INVALID$'):
        require_authorization(settings(), config_for(connection))


@pytest.mark.parametrize('relations', [
    [('v', 'public', 'pg_stat_statements'), ('v', 'public', 'pg_stat_statements')],
    [('v', 'public', 'unreviewed_extension')],
    [('v', 'public', None)], [('r', 'public', None)], [('S', 'public', None)],
    [('v', 'public', 'pg_stat_statements'), ('v', 'public', None)],
    [('v', 'unexpected_schema', 'pg_stat_statements')],
], ids=['documented-extension-fixture', 'unknown-extension', 'application-view',
        'table', 'sequence', 'mixed-provider-application', 'unexpected-schema'])
def test_runner_rejects_unapproved_inventory_and_preserves_literal_percent(monkeypatch, relations):
    from app import production_migrations as migrations
    from app.initial_database import RELATIONS_SQL, SCHEMAS_SQL, PUBLIC_READY_SQL
    from psycopg._queries import PostgresQuery
    from psycopg.adapt import Transformer

    connection, _, _ = synthetic_connection(REMOTE)
    target = make_url(REMOTE)
    configured = settings(REMOTE, 'production')
    configured.production_database_host, configured.production_database_name = target.host, target.database
    connection.execute = MagicMock()
    connection.execute.return_value.one.return_value = (target.database, target.username)
    connection.execute.return_value.scalar_one.return_value = False
    def inspect(sql, **kwargs):
        assert kwargs == {'execution_options': {'no_parameters': True}}
        adapted = PostgresQuery(Transformer())
        adapted.convert(sql, None)
        assert adapted.query.decode() == sql
        result = MagicMock()
        result.fetchmany.return_value = ([('public', True)] if sql == SCHEMAS_SQL else [(True,)] if sql == PUBLIC_READY_SQL else
            [(len(relations), sum(ext is not None for _, _, ext in relations))] if sql == RELATIONS_SQL else [])
        return result
    connection.exec_driver_sql = MagicMock(side_effect=inspect)
    engine = MagicMock()
    engine.begin.return_value.__enter__.return_value = connection
    monkeypatch.setattr(migrations, 'create_database_engine', lambda _: engine)
    upgrade = MagicMock()
    monkeypatch.setattr(migrations.command, 'upgrade', upgrade)
    with pytest.raises(RuntimeError, match='target is not a new empty or approved initial database'):
        migrations.migrate_new_database(configured, target.host, target.database, migrations.PHRASE,
                                       environ={'DYNO': 'run.1234'})
    upgrade.assert_not_called()
    engine.dispose.assert_called_once()
    assert "NOT LIKE 'pg_%'" in RELATIONS_SQL


def test_identification_query_compiles_without_exempting_any_objects():
    import app.models  # Register the existing schema; importing never connects.
    from app.db import Base
    from app.rate_limits import rate_table
    from sqlalchemy import PrimaryKeyConstraint, UniqueConstraint, text
    from sqlalchemy.dialects.postgresql.psycopg import PGDialect_psycopg
    from psycopg._queries import PostgresQuery
    from psycopg.adapt import Transformer

    names = {'alembic_version', 'alembic_version_pkc'}
    for table in list(Base.metadata.tables.values()) + [rate_table]:
        names.add(table.name)
        names.update(index.name for index in table.indexes if index.name)
        for constraint in table.constraints:
            if isinstance(constraint, (PrimaryKeyConstraint, UniqueConstraint)):
                names.add(constraint.name or table.name + '_pkey')
    sql = (Path(__file__).parents[1] / 'verification/heroku_relation_identity.sql').read_text()
    statement = text(sql).bindparams(avero_relation_names=sorted(names))
    compiled = statement.compile(dialect=PGDialect_psycopg())
    query = PostgresQuery(Transformer())
    query.convert(str(compiled), compiled.params)
    assert "n.nspname NOT LIKE 'pg_%'" in query.query.decode()
    assert "'UNVERIFIED'::text AS provider_provenance" in sql
    assert 'd.objsubid = 0' in sql and 'd.refobjsubid = 0' in sql and "d.deptype = 'e'" in sql
    assert {'owners', 'auth_rate_limits', 'pk_users', 'auth_rate_limits_pkey', 'alembic_version'} <= names
    assert 'relowner' not in sql and 'pg_get_viewdef' not in sql


def test_complete_migration_chain_generates_postgres_sql_offline(monkeypatch):
    from io import StringIO
    from alembic import command
    from alembic.script import ScriptDirectory

    monkeypatch.setenv('APP_ENV', 'test')
    monkeypatch.setenv('DATABASE_URL', 'postgresql+psycopg://test:unused@invalid.invalid/unused')
    output = StringIO()
    config = Config(str(Path(__file__).parents[1] / 'alembic.ini'), output_buffer=output)
    revisions = list(reversed([rev.revision for rev in ScriptDirectory.from_config(config).walk_revisions()]))
    assert revisions == ['0001_infrastructure', '0002_models', '0003_auth',
                         '0004_data_operations', '0005_auth_rate_limits']
    command.upgrade(config, '0005_auth_rate_limits', sql=True)  # Generate text only; no connection.
    sql = output.getvalue()
    for expected in ('NUMERIC(20, 8)', 'UUID', 'TIMESTAMP WITH TIME ZONE', 'JSONB',
                     'CREATE TABLE auth_rate_limits', 'CREATE TABLE data_operation_receipts'):
        assert expected in sql
    assert 'DROP TABLE' not in sql and 'TRUNCATE' not in sql
    import re
    from app.initial_database import application_relation_names, TARGET_TABLE_NAMES
    created_names = set(re.findall(r'CREATE (?:UNIQUE )?(?:TABLE|INDEX|SEQUENCE) (\w+)', sql))
    backed_constraint_names = set(re.findall(r'CONSTRAINT (\w+) (?:PRIMARY KEY|UNIQUE)', sql))
    assert created_names and backed_constraint_names
    assert created_names | backed_constraint_names <= application_relation_names()
    assert not {'pg_stat_statements', 'pg_stat_statements_info'} & created_names
    assert set(re.findall(r'CREATE TABLE (\w+)', sql)) == TARGET_TABLE_NAMES
    for forbidden in ('_heroku', 'pg_stat_statements', 'CREATE SCHEMA', 'CREATE FUNCTION', 'CREATE EVENT TRIGGER'):
        assert forbidden not in sql
