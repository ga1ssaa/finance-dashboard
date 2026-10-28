"""Effective migration target checks. Synthetic driver/server replies only; no network."""
import runpy
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

from alembic.config import Config
from pydantic import SecretStr
import pytest
from sqlalchemy.engine import make_url

from app.production_migrations import AUTHORIZATION, checked_target, require_authorization

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
