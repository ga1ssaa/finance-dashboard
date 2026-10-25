"""Compile the additive receipt migration OFFLINE; never execute SQL or connect."""
import io
import re
from unittest.mock import MagicMock

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import CheckConstraint, ForeignKeyConstraint, UniqueConstraint
from pathlib import Path

BACKEND=Path(__file__).resolve().parents[1]


@pytest.fixture(autouse=True)
def no_live_io(monkeypatch):
    import psycopg
    import subprocess
    import sqlalchemy
    forbidden=MagicMock(side_effect=AssertionError('Only offline SQL generation is authorized'))
    monkeypatch.setattr(psycopg,'connect',forbidden)
    monkeypatch.setattr(subprocess,'run',forbidden)
    monkeypatch.setattr(subprocess,'Popen',forbidden)
    monkeypatch.setattr(sqlalchemy,'create_engine',forbidden)
    monkeypatch.setenv('DATABASE_URL','postgresql+psycopg://synthetic:unused@127.0.0.1:65432/unused')
    yield forbidden
    forbidden.assert_not_called()


@pytest.fixture
def sql():
    stream=io.StringIO()
    config=Config(output_buffer=stream)
    config.set_main_option('script_location',str(BACKEND/'alembic'))
    command.upgrade(config,'0003_auth:0004_data_operations',sql=True)
    return stream.getvalue()


def statements(sql):
    clean=re.sub(r'--[^\n]*','',sql)
    return [' '.join(value.split()) for value in clean.split(';') if value.strip()]


def test_offline_0004_is_only_new_receipt_schema_and_guarded_version_update(sql):
    queries=statements(sql)
    assert queries[0]=='BEGIN' and queries[-1]=='COMMIT'
    created=[re.match(r'CREATE TABLE (\w+) ',query).group(1) for query in queries if query.startswith('CREATE TABLE ')]
    assert created==['data_operation_receipts']
    assert [query for query in queries if query.startswith(('INSERT ','DELETE ','UPDATE ','MERGE '))]==["UPDATE alembic_version SET version_num='0004_data_operations' WHERE alembic_version.version_num = '0003_auth'"]
    assert all(query.startswith(('CREATE TABLE data_operation_receipts ','CREATE INDEX ','CREATE UNIQUE INDEX ','UPDATE alembic_version ')) for query in queries[1:-1])
    assert not any(query.startswith(('DROP ','TRUNCATE ','ALTER ','GRANT ','DO ','CALL ')) for query in queries)
    assert not re.search(r'\b(?:INSERT INTO|UPDATE|DELETE FROM|ALTER TABLE|DROP TABLE) (?:owners|transactions|subscriptions|budget_profiles|preferences|users|auth_sessions|auth_refresh_tokens)\b',sql,re.I)


def test_receipt_model_contains_only_durable_nonsecret_identity_and_result_columns():
    from app.db import Base
    table=Base.metadata.tables['data_operation_receipts']
    assert set(table.c.keys())=={'owner_id','idempotency_key','preview_id','kind','request_sha256','result_json','completed_at'}
    assert [column.name for column in table.primary_key.columns]==['owner_id','idempotency_key']
    assert not any(word in name for name in table.c.keys() for word in ('password','token','document','session','user_id'))
    owner_fk,=table.c.owner_id.foreign_keys
    assert owner_fk.target_fullname=='owners.id' and owner_fk.ondelete=='RESTRICT'
    assert any(isinstance(constraint,UniqueConstraint) and [column.name for column in constraint.columns]==['owner_id','preview_id'] for constraint in table.constraints)
    assert table.c.result_json.type.__class__.__name__=='JSONB'
    assert table.c.completed_at.type.timezone
    assert all(not column.nullable for column in table.c)


def test_migration_checks_protect_request_hash_kind_and_json_result(sql):
    normalized=' '.join(sql.split())
    assert 'import_replace' in normalized and 'reset' in normalized
    assert 'request_sha256' in normalized and '[0-9a-f]' in normalized
    assert 'jsonb_typeof(result_json)' in normalized and "'object'" in normalized
    assert 'FOREIGN KEY(owner_id) REFERENCES owners (id) ON DELETE RESTRICT' in normalized
    assert 'UNIQUE (owner_id, preview_id)' in normalized


def test_reviewed_sql_artifact_matches_offline_generated_migration(sql):
    artifact=(BACKEND/'alembic/sql/0004_data_operations.sql').read_text()
    assert statements(artifact)==statements(sql)
