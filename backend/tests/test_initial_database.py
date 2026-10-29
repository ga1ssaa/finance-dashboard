"""Initial production compatibility, synthetic catalogs only; never a database."""

from types import SimpleNamespace
from unittest.mock import MagicMock
import traceback

import pytest
from psycopg import ProgrammingError
from sqlalchemy import Column, Integer, Table
from psycopg._queries import PostgresQuery
from psycopg.adapt import Transformer

from app import initial_database as policy
from app import production_migrations as migrations
from app.db import Base
from test_migration_authorization import REMOTE, settings, synthetic_connection
from test_heroku_pg_preflight import Cursor, outcome, synthetic  # noqa: F401 -- shared fixture


APPROVED = [
    ('public', 'pg_stat_statements', 'v', 'pg_stat_statements', '1.12', True),
    ('public', 'pg_stat_statements_info', 'v', 'pg_stat_statements', '1.12', True),
]


def changed(index, value):
    row = list(APPROVED[0])
    row[index] = value
    return [tuple(row), APPROVED[1]]


CASES = [
    ('empty', [], [('public',)], True),
    ('approved', APPROVED, [('public',)], True),
    ('reversed', APPROVED[::-1], [('public',)], True),
    ('missing-first', APPROVED[1:], [('public',)], False),
    ('missing-second', APPROVED[:1], [('public',)], False),
    ('duplicate', [APPROVED[0], APPROVED[0]], [('public',)], False),
    ('unknown-view', changed(1, 'unreviewed_view'), [('public',)], False),
    ('unknown-extension', changed(3, 'unreviewed_extension'), [('public',)], False),
    ('version', changed(4, '1.11'), [('public',)], False),
    ('future-version', changed(4, '1.13'), [('public',)], False),
    ('nonmember', changed(5, False), [('public',)], False),
    ('integer-member', changed(5, 1), [('public',)], False),
    ('missing-member', changed(5, None), [('public',)], False),
    ('no-extension', changed(3, None), [('public',)], False),
    ('no-version', changed(4, None), [('public',)], False),
    ('wrong-type', changed(2, 'm'), [('public',)], False),
    ('wrong-schema', changed(0, 'unexpected'), [('public',), ('unexpected',)], False),
    ('empty-extra-schema', [], [('public',), ('unexpected',)], False),
    ('legacy-wildcard-schema', APPROVED, [('public',), ('pgXtest',)], False),
    ('missing-public', [], [], False),
    ('malformed-schema', APPROVED, [(None,)], False),
    ('duplicate-schema', APPROVED, [('public',), ('public',)], False),
    ('extra-column', [APPROVED[0] + ('private-marker',), APPROVED[1]], [('public',)], False),
    ('short-row', [APPROVED[0][:-1], APPROVED[1]], [('public',)], False),
    ('integer-name', changed(1, 1), [('public',)], False),
    ('app-name', changed(1, 'owners'), [('public',)], False),
    ('index-name', changed(1, 'pk_users'), [('public',)], False),
    ('alembic-state', [('public', 'alembic_version', 'r', None, None, False)], [('public',)], False),
]
for kind in ('r', 'p', 'v', 'm', 'S', 'f'):
    CASES.append(('extra-' + kind, APPROVED + [('public', 'unexpected', kind, None, None, False)],
                  [('public',)], False))
CASES.append(('extra-extension-member', APPROVED + [
    ('public', 'unexpected', 'v', 'pg_stat_statements', '1.12', True)], [('public',)], False))


@pytest.mark.parametrize('name,rows,schemas,accepted', CASES, ids=[case[0] for case in CASES])
@pytest.mark.parametrize('entrypoint', ['runner', 'preflight'])
def test_identical_initial_policy_blocks_every_other_inventory(
        synthetic, capsys, monkeypatch, name, rows, schemas, accepted, entrypoint):
    counts = (len(rows), sum(row[-1] is True for row in rows))
    if entrypoint == 'preflight':
        synthetic.relations, synthetic.inventory, synthetic.schemas = counts, rows, schemas
        synthetic.extension_versions = [('1.12',)] if rows else []
        outcome(synthetic, capsys, 0 if accepted else 1)
        return
    connection, _, _ = synthetic_connection(REMOTE)
    connection.execute = MagicMock()
    target = connection.engine.url
    connection.execute.return_value.one.return_value = (target.database, target.username)
    results = []

    def inspect(sql, **kwargs):
        assert kwargs == {'execution_options': {'no_parameters': True}}
        assert sql.lstrip().startswith('SELECT') and ';' not in sql
        adapter = PostgresQuery(Transformer())
        adapter.convert(sql, None)
        assert adapter.query.decode() == sql
        reply = {policy.RELATIONS_SQL: [counts], policy.SCHEMAS_SQL: schemas,
                 policy.EXTENSION_VERSION_SQL: [('1.12',)] if rows else [],
                 policy.EXTENSION_RELATIONS_SQL: rows}[sql]
        result = MagicMock()
        result.fetchmany.side_effect = lambda size: reply[:size]
        results.append(result)
        return result

    connection.exec_driver_sql = MagicMock(side_effect=inspect)
    configured = settings(REMOTE, 'production')
    configured.production_database_host, configured.production_database_name = target.host, target.database
    engine, upgrade = MagicMock(), MagicMock()
    engine.begin.return_value.__enter__.return_value = connection
    monkeypatch.setattr(migrations, 'create_database_engine', lambda _: engine)
    monkeypatch.setattr(migrations.command, 'upgrade', upgrade)

    def run():
        migrations.migrate_new_database(configured, target.host, target.database, migrations.PHRASE,
                                       environ={'DYNO': 'run.1234'})

    if accepted:
        run()
        config, revision = upgrade.call_args.args
        assert revision == '0005_auth_rate_limits'
        assert config.attributes['connection'] is connection
        assert config.attributes['production_authorization'] is migrations.AUTHORIZATION
    else:
        with pytest.raises(RuntimeError, match='^' + policy.FAILURE + '$'):
            run()
        upgrade.assert_not_called()
    assert results
    for result in results:
        result.close.assert_called_once()
    engine.dispose.assert_called_once()


@pytest.mark.parametrize('counts', [None, (), (0,), (0, 0, 0), (False, 0), (2, True),
                                    (-1, -1), (0, 1), (2, 1), ('2', 2)])
def test_malformed_counts_fail_closed_and_are_sanitized(counts):
    result = MagicMock()
    result.fetchmany.return_value = [counts]
    connection = SimpleNamespace(exec_driver_sql=MagicMock(return_value=result))
    with pytest.raises(RuntimeError) as error:
        policy.require_initial_database(connection)
    assert str(error.value) == policy.FAILURE
    result.close.assert_called_once()


@pytest.mark.parametrize('failure', ['query', 'fetch', 'close'])
def test_catalog_errors_are_sanitized(failure):
    result = MagicMock()
    result.fetchmany.return_value = [(0, 0)]
    connection = SimpleNamespace(exec_driver_sql=MagicMock(return_value=result))
    error = RuntimeError('synthetic-private-marker')
    if failure == 'query':
        connection.exec_driver_sql.side_effect = error
    elif failure == 'fetch':
        result.fetchmany.side_effect = error
    else:
        result.close.side_effect = error
    with pytest.raises(RuntimeError) as caught:
        policy.require_initial_database(connection)
    assert str(caught.value) == policy.FAILURE
    assert 'synthetic-private-marker' not in ''.join(traceback.format_exception(caught.value))
    if failure != 'query':
        result.close.assert_called_once()


@pytest.mark.parametrize('entrypoint', ['runner-policy', 'preflight'])
def test_future_model_collision_rejects_previously_approved_view(synthetic, capsys, entrypoint):
    table = Table('pg_stat_statements', Base.metadata, Column('id', Integer, primary_key=True))
    try:
        if entrypoint == 'preflight':
            synthetic.relations, synthetic.inventory = (2, 2), APPROVED
            synthetic.extension_versions = [('1.12',)]
            outcome(synthetic, capsys, 1)
        else:
            replies = iter([[(2, 2)], [('public',)], [('1.12',)], APPROVED])
            def inspect(*args, **kwargs):
                result = MagicMock()
                result.fetchmany.return_value = next(replies)
                return result
            with pytest.raises(RuntimeError, match='^' + policy.FAILURE + '$'):
                policy.require_initial_database(SimpleNamespace(exec_driver_sql=inspect))
    finally:
        Base.metadata.remove(table)


def test_reserved_names_cover_tables_backing_indexes_and_alembic():
    names = policy.application_relation_names()
    assert {'owners', 'transactions', 'auth_rate_limits', 'pk_users', 'auth_rate_limits_pkey',
            'uq_users_email', 'ix_transactions_owner_date_id', 'alembic_version',
            'alembic_version_pkc'} <= names
    assert not {'pg_stat_statements', 'pg_stat_statements_info'} & names


def test_preflight_uses_exact_same_validator():
    from verification import heroku_pg_preflight as probe
    assert probe.require_initial_database is migrations.require_initial_database is policy.require_initial_database
    assert probe.RELATIONS_SQL is policy.RELATIONS_SQL


@pytest.mark.parametrize('sql', [policy.RELATIONS_SQL, policy.SCHEMAS_SQL,
                                 policy.EXTENSION_VERSION_SQL, policy.EXTENSION_RELATIONS_SQL])
def test_inspection_sql_and_percent_adaptation(sql):
    assert sql.lstrip().startswith('SELECT') and ';' not in sql
    adapter = PostgresQuery(Transformer())
    adapter.convert(sql, None)
    assert adapter.query.decode() == sql
    if 'LIKE' in sql:
        with pytest.raises(ProgrammingError):
            adapter.convert(sql, {})
    if 'LEFT JOIN' in sql:
        assert 'd.objsubid = 0' in sql and 'd.refobjsubid = 0' in sql and "d.deptype = 'e'" in sql
    assert 'pg_stat_statements(' not in sql  # Never execute extension functions or read the views.


@pytest.mark.parametrize('point', ['fetch', 'query'])
def test_inventory_timeout_preserves_preflight_cleanup(synthetic, capsys, monkeypatch, point):
    original = Cursor.fetchmany if point == 'fetch' else Cursor.execute
    def fail(cursor, *args):
        if (point == 'fetch' and any('count(*) FILTER' in sql for sql in cursor.driver.sql)
            or point == 'query' and 'count(*) FILTER' in args[0]):
            raise TimeoutError('synthetic-private-marker')
        return original(cursor, *args)
    monkeypatch.setattr(Cursor, 'fetchmany' if point == 'fetch' else 'execute', fail)
    outcome(synthetic, capsys, 1)


@pytest.mark.parametrize('versions', [[], [('1.11',)], [(None,)], [('1.12',), ('1.12',)]])
def test_approved_views_require_consistent_extension_registry(synthetic, capsys, versions):
    synthetic.relations, synthetic.inventory = (2, 2), APPROVED
    synthetic.extension_versions = versions
    outcome(synthetic, capsys, 1)


def test_installed_extension_with_both_views_missing_is_not_empty(synthetic, capsys):
    synthetic.extension_versions = [('1.12',)]
    outcome(synthetic, capsys, 1)
