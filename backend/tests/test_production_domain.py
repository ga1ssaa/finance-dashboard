"""Actual deployment-domain contracts with synthetic database/auth services only."""
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

from fastapi.testclient import TestClient
from pydantic import ValidationError
import pytest

from app.auth import COOKIE_NAME, utcnow
from app.config import Settings
from app.main import create_app

FRONTEND = 'https://getavero.app'
API = 'https://api.getavero.app'
PROXY = {'Host':'api.getavero.app','X-Forwarded-Proto':'https','X-Forwarded-For':'198.51.100.25'}
CSRF = {**PROXY,'Origin':FRONTEND,'X-CSRF-Protection':'1'}


def configured(**overrides):
    return Settings(_env_file=None, **{
        'APP_ENV':'production',
        'DATABASE_URL':'postgres://synthetic:unused@synthetic.example.amazonaws.com:5432/synthetic_new_avero',
        'PRODUCTION_DATABASE_HOST':'synthetic.example.amazonaws.com',
        'PRODUCTION_DATABASE_NAME':'synthetic_new_avero',
        'PRODUCTION_SITE_DOMAIN':'getavero.app',
        'PRODUCTION_API_ORIGIN':API,
        'CORS_ALLOWED_ORIGINS':[FRONTEND],
        'TRUSTED_PROXY':'heroku',
        'DATABASE_SSLROOTCERT':'/synthetic/approved-ca.pem', **overrides})


def test_actual_apex_and_api_configuration_remains_explicit_and_secure():
    settings = configured()
    assert settings.production_site_domain == 'getavero.app'
    assert settings.production_api_origin == API
    assert settings.cors_allowed_origins == (FRONTEND,)
    assert settings.trusted_proxy == 'heroku'


@pytest.mark.parametrize('origin', [
    'http://getavero.app','https://getavero.app/','https://getavero.app:443',
    'https://user@getavero.app','https://getavero.app?x=1','https://getavero.app#x',
    'https://other.app','https://notgetavero.app','https://getavero.app.evil.app',
    'https://getavero.me','https://preview.vercel.app','*','null',
])
def test_external_and_malformed_origins_cannot_enter_getavero_allowlist(origin):
    with pytest.raises(ValidationError):configured(CORS_ALLOWED_ORIGINS=[origin])


@pytest.mark.parametrize('api', ['http://api.getavero.app','https://api.other.app','https://api.getavero.app/','https://api.getavero.app:443','https://api.getavero.app.evil.app'])
def test_backend_rejects_insecure_or_external_api_origin(api):
    with pytest.raises(ValidationError):configured(PRODUCTION_API_ORIGIN=api)


@pytest.fixture
def client(monkeypatch):
    engine = MagicMock()
    monkeypatch.setattr('app.main.create_database_engine',lambda _:engine)
    monkeypatch.setenv('DYNO','web.1');monkeypatch.setenv('PORT','17321')
    app = create_app(configured())
    with TestClient(app,base_url=API) as value:
        limiter = MagicMock(return_value=None)
        app.state.auth_rate_limiter = SimpleNamespace(check=limiter)
        yield value,engine,limiter


def test_apex_preflight_is_allowed_with_credentials_and_csrf_header(client):
    api,engine,_ = client
    result = api.options('/api/v1/auth/login',headers={**PROXY,'Origin':FRONTEND,
        'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,x-csrf-protection'})
    assert result.status_code == 200
    assert result.headers['access-control-allow-origin'] == FRONTEND
    assert result.headers['access-control-allow-credentials'] == 'true'
    assert '*' not in result.headers['access-control-allow-origin']
    engine.connect.assert_not_called()


@pytest.mark.parametrize('origin',['https://www.getavero.app','https://other.app','https://getavero.app.evil.app','https://preview.vercel.app'])
def test_unconfigured_origins_cannot_use_cors_or_auth_even_if_same_site(client,origin):
    api,engine,limiter = client
    preflight = api.options('/api/v1/auth/login',headers={**PROXY,'Origin':origin,'Access-Control-Request-Method':'POST'})
    assert preflight.status_code == 400 and 'access-control-allow-origin' not in preflight.headers
    response = api.post('/api/v1/auth/login',headers={**CSRF,'Origin':origin},json={})
    assert response.status_code == 403
    limiter.assert_not_called();engine.connect.assert_not_called()


def test_actual_origin_does_not_remove_csrf_or_proxy_checks(client):
    api,engine,limiter = client
    assert api.post('/api/v1/auth/login',headers={**PROXY,'Origin':FRONTEND},json={}).status_code == 403
    assert api.get('/api/v1/health',headers={**PROXY,'Host':'wrong.getavero.app'}).status_code == 400
    assert api.get('/api/v1/health',headers={**PROXY,'X-Forwarded-Proto':'http'}).status_code == 400
    limiter.assert_not_called();engine.connect.assert_not_called()


def test_apex_to_api_refresh_and_logout_keep_secure_host_only_lax_cookies(client,monkeypatch):
    api,_,_ = client
    user = SimpleNamespace(id=uuid4(),email='synthetic@example.test')
    family = SimpleNamespace(id=uuid4())
    monkeypatch.setattr('app.api.auth.auth.rotate_refresh',lambda session,token:(user,family,'R'*43,utcnow()+timedelta(days=1)))
    monkeypatch.setattr('app.api.auth.auth.logout',lambda session,token:None)
    for action in ['refresh','logout']:
        response = api.post('/api/v1/auth/'+action,headers={**CSRF,'Cookie':COOKIE_NAME+'='+'Q'*43})
        assert response.status_code in (200,204)
        cookie = response.headers['set-cookie']
        assert 'Secure' in cookie and 'HttpOnly' in cookie and 'SameSite=lax' in cookie
        assert 'Path=/api/v1/auth' in cookie and 'Domain=' not in cookie
        assert response.headers['access-control-allow-origin'] == FRONTEND


def test_domain_change_does_not_make_incomplete_production_configuration_valid():
    with pytest.raises(ValidationError):configured(TRUSTED_PROXY='none')
    with pytest.raises(ValidationError):configured(CORS_ALLOWED_ORIGINS=[])
    with pytest.raises(ValidationError):configured(PRODUCTION_SITE_DOMAIN='app')
