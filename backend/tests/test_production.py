"""Production security contracts: fakes only, no network or PostgreSQL connections."""
from contextlib import contextmanager
from concurrent.futures import ThreadPoolExecutor
from io import StringIO
from pathlib import Path
import threading
from types import SimpleNamespace
from unittest.mock import MagicMock

from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from pydantic import ValidationError
import pytest
from sqlalchemy.exc import OperationalError
from sqlalchemy.engine import make_url

from app.config import Settings
from app.main import create_app
from app.rate_limits import PostgresAuthRateLimiter, RateLimitUnavailable, PRODUCTION_REVISION
from app.production_migrations import migrate_new_database, require_authorization, AUTHORIZATION, PHRASE

ROOT = Path(__file__).resolve().parents[2]
HOST = "synthetic.example.amazonaws.com"
DB = "synthetic_new_avero"
ORIGIN = "https://app.synthetic-avero.me"
API = "https://api.synthetic-avero.me"
HEADERS = {"Host": "api.synthetic-avero.me", "X-Forwarded-Proto": "https", "X-Forwarded-For": "198.51.100.10"}
CSRF = {**HEADERS, "Origin": ORIGIN, "X-CSRF-Protection": "1"}


def configured(**overrides):
    return Settings(_env_file=None, **{
        "APP_ENV": "production", "DATABASE_URL": f"postgres://synthetic:unused@{HOST}:5432/{DB}",
        "PRODUCTION_DATABASE_HOST": HOST, "PRODUCTION_DATABASE_NAME": DB,
        "PRODUCTION_SITE_DOMAIN": "synthetic-avero.me", "PRODUCTION_API_ORIGIN": API,
        "CORS_ALLOWED_ORIGINS": [ORIGIN], "TRUSTED_PROXY": "heroku",
        "DATABASE_SSLROOTCERT": "/synthetic/approved-ca.pem", **overrides})


@pytest.mark.parametrize("origin", ["http://app.synthetic-avero.me", "https://other.me", "https://app.synthetic-avero.me/", "https://app.synthetic-avero.me:443", "https://user@app.synthetic-avero.me", "https://app.synthetic-avero.me?x=1", "https://app.synthetic-avero.me#x", "*", "null", "https://localhost", "https://app.synthetic-avero.me.evil.test"])
def test_production_rejects_unapproved_or_malformed_origins(origin):
    with pytest.raises(ValidationError):
        configured(CORS_ALLOWED_ORIGINS=[origin])


@pytest.mark.parametrize("overrides", [{"TRUSTED_PROXY": "none"}, {"CORS_ALLOWED_ORIGINS": []}, {"PRODUCTION_SITE_DOMAIN": "vercel.app"}, {"DATABASE_SSLROOTCERT": "relative.pem"}, {"PRODUCTION_DATABASE_HOST": "wrong.amazonaws.com"}, {"PRODUCTION_DATABASE_NAME": "wrong"}, {"DATABASE_URL": "postgres://synthetic:unused@127.0.0.1/finance_dashboard"}, {"DATABASE_URL": f"postgres://synthetic:unused@{HOST}/finance_dashboard", "PRODUCTION_DATABASE_NAME": "finance_dashboard"}, {"DATABASE_URL": f"postgres://synthetic:unused@{HOST}/{DB}?sslmode=disable"}, {"DATABASE_URL": f"postgres://synthetic:unused@{HOST}/{DB}?host=127.0.0.1"}, {"DATABASE_URL": f"postgres://synthetic:unused@{HOST}/{DB}?options=-csearch_path=evil"}])
def test_production_rejects_unsafe_database_or_network_configuration(overrides):
    with pytest.raises(ValidationError) as error:
        configured(**overrides)
    assert "synthetic:unused@" not in str(error.value)


def test_production_normalizes_heroku_url_but_never_loads_development_dotenv(tmp_path, monkeypatch):
    dotenv = tmp_path / ".env"
    dotenv.write_text("AUTH_JWT_SECRET=private-file-must-not-be-used\n")
    settings = configured()
    assert settings.database_url.get_secret_value().startswith("postgresql+psycopg://")
    monkeypatch.delenv("AUTH_JWT_SECRET")
    # Even an explicitly passed private file is ignored in production.
    with pytest.raises(ValidationError):
        Settings(_env_file=dotenv, APP_ENV="production", DATABASE_URL=f"postgres://test:unused@{HOST}/{DB}")


def test_production_engine_is_lazy_and_has_bounded_pool_and_verified_tls(monkeypatch):
    from app.db import create_database_engine
    captured = MagicMock()
    monkeypatch.setattr("app.db.create_engine", captured)
    create_database_engine(configured())
    options = captured.call_args.kwargs
    assert options["pool_size"] == 3 and options["max_overflow"] == 0
    assert options["connect_args"] == {"connect_timeout": 3, "sslmode": "verify-full", "sslrootcert": "/synthetic/approved-ca.pem", "ssl_min_protocol_version": "TLSv1.2", "options": "-csearch_path=public"}
    assert options["hide_parameters"] and not options["echo"]


@pytest.fixture
def production_client(monkeypatch):
    engine = MagicMock()
    monkeypatch.setattr("app.main.create_database_engine", lambda _: engine)
    monkeypatch.setenv("DYNO", "web.1"); monkeypatch.setenv("PORT", "12345")
    app = create_app(configured())
    with TestClient(app, base_url=API) as client:
        assert isinstance(app.state.auth_rate_limiter, PostgresAuthRateLimiter)
        yield client, engine


def test_production_liveness_cors_csrf_and_shared_limiter_failure(production_client):
    client, engine = production_client
    response = client.get('/api/v1/health', headers=HEADERS)
    assert response.status_code == 200 and response.headers['strict-transport-security'] == 'max-age=31536000'
    assert response.headers['cache-control'] == 'no-store'
    engine.connect.assert_not_called()
    preflight = client.options('/api/v1/auth/login', headers={**HEADERS, 'Origin': ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-csrf-protection'})
    assert preflight.status_code == 200 and preflight.headers['access-control-allow-origin'] == ORIGIN
    assert preflight.headers['access-control-allow-credentials'] == 'true'
    hostile = client.post('/api/v1/auth/login', headers={**CSRF, 'Origin': 'https://hostile.me'}, json={})
    assert hostile.status_code == 403
    assert client.post('/api/v1/auth/login', headers=HEADERS, json={}).status_code == 403
    engine.begin.side_effect = OperationalError(None, None, Exception('hidden-database-details'))
    rejected = client.post('/api/v1/auth/login', headers=CSRF, json={})
    assert rejected.status_code == 503 and 'hidden-database' not in rejected.text


@pytest.mark.parametrize('change', [{'X-Forwarded-Proto':'http'}, {'X-Forwarded-Proto':'https,http'}, {'X-Forwarded-For':'invalid'}, {'X-Forwarded-For':''}, {'Host':'evil.me'}, {'Host':'api.synthetic-avero.me.evil.test'}])
def test_proxy_rejects_invalid_transport_or_host_before_application(production_client, change):
    client, engine = production_client
    assert client.get('/api/v1/health', headers={**HEADERS, **change}).status_code == 400
    engine.connect.assert_not_called()


def test_proxy_uses_only_router_appended_rightmost_ip(production_client):
    client, _ = production_client
    seen = []
    client.app.state.auth_rate_limiter = SimpleNamespace(check=lambda rules: seen.extend(rules))
    response = client.post('/api/v1/auth/login', headers={**CSRF, 'X-Forwarded-For':'forged, 203.0.113.9', 'X-Forwarded-Host':'evil.me'}, json={})
    assert response.status_code == 422
    assert any(key == 'login:ip:203.0.113.9' for key, _, _ in seen)
    assert all('forged' not in key for key, _, _ in seen)


def test_production_login_register_refresh_logout_cookie_flags(production_client, monkeypatch):
    from datetime import timedelta
    from uuid import uuid4
    from app.auth import COOKIE_NAME, utcnow
    client, _ = production_client
    client.app.state.auth_rate_limiter = SimpleNamespace(check=lambda _: None)
    user = SimpleNamespace(id=uuid4(), email='synthetic@example.test')
    family = SimpleNamespace(id=uuid4())
    monkeypatch.setattr('app.api.auth.auth.rotate_refresh', lambda session, token: (user,family,'R'*43,utcnow()+timedelta(days=1)))
    monkeypatch.setattr('app.api.auth.auth.login', lambda session, email, password: (user,family,'R'*43,utcnow()+timedelta(days=1)))
    monkeypatch.setattr('app.api.auth.auth.register', lambda session, email, password: (user,family,'R'*43,utcnow()+timedelta(days=1)))
    monkeypatch.setattr('app.api.auth.auth.logout', lambda session, token: None)
    for action in ['login','register','refresh','logout']:
        response = client.post('/api/v1/auth/'+action, headers={**CSRF, 'Cookie': COOKIE_NAME+'='+'Q'*43},
                               **({'json': {'email': 'synthetic@example.test', 'password': 'synthetic-password'}} if action in {'login','register'} else {}))
        assert response.status_code in (200,201,204)
        cookie = response.headers['set-cookie']
        assert 'Secure' in cookie and 'HttpOnly' in cookie and 'SameSite=lax' in cookie and 'Domain=' not in cookie


@pytest.mark.parametrize('header', ['Host', 'X-Forwarded-Proto', 'X-Forwarded-For'])
def test_proxy_rejects_duplicate_security_headers(production_client, header):
    client, _ = production_client
    response = client.get('/api/v1/health', headers=[*HEADERS.items(), (header, HEADERS[header])])
    assert response.status_code == 400


def test_production_readiness_requires_exact_security_revision(production_client, monkeypatch):
    client, _ = production_client
    monkeypatch.setattr('app.main.production_schema_ready', lambda connection: False)
    assert client.get('/api/v1/health/ready', headers=HEADERS).status_code == 503
    monkeypatch.setattr('app.main.production_schema_ready', lambda connection: True)
    assert client.get('/api/v1/health/ready', headers=HEADERS).status_code == 200


@pytest.mark.parametrize('revision,accepted', [('0004_data_operations',True),(PRODUCTION_REVISION,True),('0003_auth',False),('0006_unreviewed',False)])
def test_financial_operation_schema_guard_accepts_only_reviewed_compatible_heads(revision,accepted):
    from app.services.data_state import require_data_schema
    from app.data_operation_errors import DataOperationError
    connection=MagicMock();connection.execute.return_value.scalars.return_value.all.return_value=[revision]
    if accepted:
        require_data_schema(connection)
        assert connection.execute.call_count==2  # Receipt columns are still checked.
    else:
        with pytest.raises(DataOperationError):require_data_schema(connection)


class FakeQuotaDatabase:
    """Executes the limiter's actual SQLAlchemy statements against a locked synthetic store."""
    def __init__(self):
        self.rows, self.now, self.lock, self.statements = {}, 1000, threading.RLock(), []
    @contextmanager
    def begin(self):
        with self.lock:
            yield self
    def scalar(self, statement):
        return self.now if 'clock_timestamp' in str(statement) else len(self.rows)
    def execute(self, statement, params=None):
        sql = str(statement); self.statements.append(sql)
        values = statement.compile().params
        if sql.startswith('DELETE'):
            self.rows = {key: row for key,row in self.rows.items() if row['expires_at'] > self.now}
        elif sql.startswith('SELECT auth_rate_limits'):
            return SimpleNamespace(mappings=lambda: SimpleNamespace(one_or_none=lambda: self.rows.get(values['key_hash_1'])))
        elif sql.startswith('INSERT'):
            self.rows[values['key_hash']] = values.copy()
        elif sql.startswith('UPDATE'):
            self.rows[values['key_hash_1']].update({key: values[key] for key in ['attempts','expires_at','window_seconds']})
        return MagicMock()


def test_shared_quota_survives_limiter_recreation_and_concurrency_without_storing_pii():
    db = FakeQuotaDatabase()
    first = PostgresAuthRateLimiter(db, 'synthetic-secret')
    second = PostgresAuthRateLimiter(db, 'synthetic-secret')
    with ThreadPoolExecutor(max_workers=8) as workers:
        results = list(workers.map(lambda i: (first if i%2 else second).check([('login:email:synthetic@example.test',5,60)]), range(12)))
    assert results.count(None) == 5 and sum(result is not None for result in results) == 7
    assert all(len(key)==64 and 'synthetic' not in key for key in db.rows)
    assert any('pg_advisory_xact_lock' in sql for sql in db.statements)
    db.now += 61
    assert second.check([('login:email:synthetic@example.test',5,60)]) is None


def test_shared_quota_cardinality_and_database_failure_fail_closed():
    db = FakeQuotaDatabase(); limiter = PostgresAuthRateLimiter(db,'secret',max_keys=1)
    assert limiter.check([('A',5,60)]) is None
    assert limiter.check([('B',5,60)]) == 60
    broken=MagicMock();broken.begin.side_effect=OperationalError(None,None,Exception('private'))
    with pytest.raises(RateLimitUnavailable,match='protection unavailable'):
        PostgresAuthRateLimiter(broken,'secret').check([('A',5,60)])


@pytest.mark.parametrize('overrides', [{}, {'DYNO':'web.1','PORT':'0'}, {'DYNO':'web.1','PORT':'65536'}, {'DYNO':'worker.1','PORT':'8080'}])
def test_heroku_entry_rejects_unsafe_runtime(overrides):
    from app.production import require_heroku
    with pytest.raises(RuntimeError): require_heroku(overrides)


def test_heroku_startup_respects_port_worker_and_proxy_limits(monkeypatch):
    import app.production as start
    monkeypatch.setattr(start,'Settings',lambda **kw:configured())
    monkeypatch.setenv('DYNO','web.1');monkeypatch.setenv('PORT','17123')
    monkeypatch.setattr(start.Path,'is_file',lambda _:True)
    run=MagicMock();monkeypatch.setattr(start.uvicorn,'run',run)
    start.main()
    options=run.call_args.kwargs
    assert options['port']==17123 and options['workers']==1 and not options['proxy_headers'] and not options['access_log']
    assert options['limit_concurrency']==16
    assert (ROOT/'Procfile').read_text().strip()=='web: python -m app.production'
    assert 'release:' not in (ROOT/'Procfile').read_text()
    assert (ROOT/'requirements.txt').read_text().strip()=='./backend'


@pytest.mark.parametrize('host,db,phrase', [(HOST,DB,'wrong'),('wrong.amazonaws.com',DB,PHRASE),(HOST,'finance_dashboard',PHRASE)])
def test_migration_guard_refuses_before_any_connection(monkeypatch,host,db,phrase):
    engine=MagicMock();monkeypatch.setattr('app.production_migrations.create_database_engine',engine)
    with pytest.raises(RuntimeError):migrate_new_database(configured(),host,db,phrase,environ={'DYNO':'run.1234'})
    engine.assert_not_called()


def test_normal_production_alembic_is_refused_even_with_provided_connection():
    config=Config();config.attributes['connection']=MagicMock()
    with pytest.raises(RuntimeError,match='explicit'):require_authorization(configured(),config)


def test_development_mode_cannot_bypass_remote_migration_authorization():
    settings = Settings(_env_file=None, APP_ENV='development', DATABASE_URL=f'postgresql+psycopg://synthetic:unused@{HOST}/{DB}')
    with pytest.raises(RuntimeError,match='Remote migrations'):
        require_authorization(settings, Config())


def synthetic_migration_engine():
    engine = MagicMock()
    engine.url = make_url(configured().database_url.get_secret_value())
    connection = engine.begin.return_value.__enter__.return_value
    connection.engine = engine
    info = connection.connection.driver_connection.info
    info.host, info.port, info.dbname, info.user, info.hostaddr = HOST, 5432, DB, 'synthetic', '203.0.113.10'
    connection.connection.driver_connection.pgconn.ssl_in_use = True
    info.get_parameters.return_value = {'sslmode': 'verify-full', 'sslrootcert': '/synthetic/approved-ca.pem'}
    cursor = connection.connection.driver_connection.cursor.return_value.__enter__.return_value
    cursor.fetchone.return_value = (DB, 'synthetic', 'synthetic', '203.0.113.10', 5432)
    def inspect(sql, **kwargs):
        from app.initial_database import RELATIONS_SQL, SCHEMAS_SQL, EXTENSION_VERSION_SQL
        assert kwargs == {'execution_options': {'no_parameters': True}}
        result = MagicMock()
        if sql == RELATIONS_SQL:
            result.fetchmany.return_value = [(connection.scalar.return_value, 0)]
        elif sql == SCHEMAS_SQL:
            result.fetchmany.return_value = [('public',)]
        elif sql == EXTENSION_VERSION_SQL:
            result.fetchmany.return_value = []
        else:
            raise AssertionError('Unexpected initial-target query')
        return result
    connection.exec_driver_sql.side_effect = inspect
    return engine, connection


@pytest.mark.parametrize('existing,identity', [(1,(DB,'synthetic')),(0,('finance_dashboard','synthetic'))])
def test_authorized_migration_still_refuses_nonempty_or_wrong_database(monkeypatch,existing,identity):
    engine,connection=synthetic_migration_engine()
    connection.execute.return_value.one.return_value=identity;connection.scalar.return_value=existing
    monkeypatch.setattr('app.production_migrations.create_database_engine',lambda _:engine)
    upgrade=MagicMock();monkeypatch.setattr('app.production_migrations.command.upgrade',upgrade)
    with pytest.raises(RuntimeError):migrate_new_database(configured(),HOST,DB,PHRASE,environ={'DYNO':'run.1234'})
    upgrade.assert_not_called();engine.dispose.assert_called_once()


def test_authorized_empty_target_passes_same_connection_and_fixed_revision(monkeypatch):
    engine,connection=synthetic_migration_engine()
    connection.execute.return_value.one.return_value=(DB,'synthetic');connection.scalar.return_value=0
    monkeypatch.setattr('app.production_migrations.create_database_engine',lambda _:engine)
    upgrade=MagicMock();monkeypatch.setattr('app.production_migrations.command.upgrade',upgrade)
    migrate_new_database(configured(),HOST,DB,PHRASE,environ={'DYNO':'run.1234'})
    config,revision=upgrade.call_args.args
    assert revision==PRODUCTION_REVISION and config.attributes['connection'] is connection and config.attributes['production_authorization'] is AUTHORIZATION


def test_migration_cli_uses_canonical_module_authorization_identity(monkeypatch):
    import runpy
    import app.production_migrations as migrations
    main = MagicMock()
    monkeypatch.setattr(migrations, 'main', main)
    runpy.run_path(migrations.__file__, run_name='__main__')
    main.assert_called_once_with()


def test_new_security_migration_generates_additive_sql_only(monkeypatch):
    monkeypatch.setenv('APP_ENV','test')
    monkeypatch.setenv('DATABASE_URL','postgresql+psycopg://test:unused@invalid.invalid/unused')
    output=StringIO();config=Config(str(ROOT/'backend/alembic.ini'),output_buffer=output)
    command.upgrade(config,'0004_data_operations:'+PRODUCTION_REVISION,sql=True)
    sql=output.getvalue()
    assert 'CREATE TABLE auth_rate_limits' in sql and 'CREATE INDEX' in sql
    assert 'ALTER TABLE' not in sql and 'DROP TABLE' not in sql and 'INSERT INTO' not in sql
