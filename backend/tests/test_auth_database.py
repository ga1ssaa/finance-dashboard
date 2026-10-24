"""Real auth against the explicitly prepared Phase5 disposable PostgreSQL only."""
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import os
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.main import create_app

pytestmark = pytest.mark.skipif(os.environ.get("RUN_DATABASE_TESTS") != "1", reason="requires the prepared disposable Phase5 database")
ORIGIN = "http://127.0.0.1:5173"
CSRF = {"Origin": ORIGIN, "X-CSRF-Protection": "1"}
PASSWORD = "Synthetic-only-password-42!"


@pytest.fixture
def api(phase5_settings, phase5_engine, guarded_app):
    with TestClient(guarded_app(), base_url="http://127.0.0.1:18085") as client:
        yield client


def register(client, email=None):
    email = email or f"qa-{uuid4().hex}@example.test"
    response = client.post("/api/v1/auth/register", headers=CSRF, json={"email": email, "password": PASSWORD})
    assert response.status_code == 201
    return response, email


def bearer(response):
    return {"Authorization": "Bearer " + response.json()["access_token"]}


def refresh(client):
    return client.post("/api/v1/auth/refresh", headers=CSRF)


def test_registration_normalization_argon2_storage_and_fresh_namespace(api, phase5_engine):
    email = f"Qa-{uuid4().hex}@Example.Test"
    response, _ = register(api, " " + email + " ")
    data = response.json()
    assert data["user"]["email"] == email.lower()
    assert data["token_type"] == "bearer" and data["expires_in"] == 300
    assert set(data["user"]) == {"id", "email"}
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["pragma"] == "no-cache"
    cookie = response.headers["set-cookie"]
    assert "HttpOnly" in cookie and "Path=/api/v1/auth" in cookie
    assert "SameSite=lax" in cookie and "Domain=" not in cookie and "Secure" not in cookie
    assert 0 < int(cookie.split("Max-Age=")[1].split(";")[0]) <= 604800
    raw_cookie = api.cookies.get("fd_refresh")
    with phase5_engine.connect() as connection:
        row = connection.execute(text("SELECT owner_id, password_hash FROM users WHERE id=:id"), {"id": UUID(data["user"]["id"])}).one()
        assert row.password_hash.startswith("$argon2id$v=19$m=65536,t=3,p=1$")
        assert PASSWORD not in row.password_hash
        assert connection.scalar(text("SELECT count(*) FROM transactions WHERE owner_id=:owner"), {"owner": row.owner_id}) == 0
        assert connection.scalar(text("SELECT count(*) FROM auth_refresh_tokens WHERE token_hash=:hash"), {"hash": sha256(raw_cookie.encode()).hexdigest()}) == 1
    assert api.get("/api/v1/auth/me", headers=bearer(response)).json() == data["user"]
    duplicate = api.post("/api/v1/auth/register", headers=CSRF, json={"email": email.lower(), "password": PASSWORD})
    assert duplicate.status_code == 409


def test_login_generic_failures_and_logout_revokes_access_and_cookie(api):
    registered, email = register(api)
    wrong = api.post("/api/v1/auth/login", headers=CSRF, json={"email": email, "password": PASSWORD + "wrong"})
    unknown = api.post("/api/v1/auth/login", headers=CSRF, json={"email": f"missing-{uuid4().hex}@example.test", "password": PASSWORD})
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()
    login = api.post("/api/v1/auth/login", headers=CSRF, json={"email": email.upper(), "password": PASSWORD})
    assert login.status_code == 200
    assert api.get("/api/v1/transactions", headers=bearer(login)).status_code == 200
    cookie = api.cookies.get("fd_refresh")
    logout = api.post("/api/v1/auth/logout", headers=CSRF)
    assert logout.status_code == 204 and logout.content == b""
    assert "Max-Age=0" in logout.headers["set-cookie"]
    assert "Path=/api/v1/auth" in logout.headers["set-cookie"]
    assert api.get("/api/v1/auth/me", headers=bearer(login)).status_code == 401
    api.cookies.set("fd_refresh", cookie, domain="127.0.0.1", path="/api/v1/auth")
    assert refresh(api).status_code == 401
    # An independently created session is not revoked by logout of this session.
    assert api.get("/api/v1/auth/me", headers=bearer(registered)).status_code == 200
    assert api.post("/api/v1/auth/logout", headers=CSRF).status_code == 204


def test_refresh_rotation_replay_commits_family_revocation(api, phase5_engine):
    first, _ = register(api)
    old = api.cookies.get("fd_refresh")
    second = refresh(api)
    assert second.status_code == 200
    newest = api.cookies.get("fd_refresh")
    assert newest != old
    assert api.get("/api/v1/auth/me", headers=bearer(second)).status_code == 200
    api.cookies.set("fd_refresh", old, domain="127.0.0.1", path="/api/v1/auth")
    assert refresh(api).status_code == 401
    assert api.get("/api/v1/auth/me", headers=bearer(first)).status_code == 401
    assert api.get("/api/v1/auth/me", headers=bearer(second)).status_code == 401
    api.cookies.set("fd_refresh", newest, domain="127.0.0.1", path="/api/v1/auth")
    assert refresh(api).status_code == 401
    # Independent DB connection proves revocation survived the HTTP401 boundary.
    with phase5_engine.connect() as connection:
        assert connection.scalar(text("SELECT s.revoked_at IS NOT NULL FROM auth_sessions s JOIN auth_refresh_tokens t ON t.session_id=s.id WHERE t.token_hash=:hash"), {"hash": sha256(old.encode()).hexdigest()}) is True


def test_unknown_refresh_does_not_revoke_another_session(api):
    registered, _ = register(api)
    known = api.cookies.get("fd_refresh")
    api.cookies.set("fd_refresh", "unknown-token", domain="127.0.0.1", path="/api/v1/auth")
    assert refresh(api).status_code == 401
    assert api.get("/api/v1/auth/me", headers=bearer(registered)).status_code == 200
    api.cookies.set("fd_refresh", known, domain="127.0.0.1", path="/api/v1/auth")
    assert refresh(api).status_code == 200


def test_access_claims_are_checked_and_cannot_select_another_identity(api, signing_key):
    import jwt
    registered, _ = register(api)
    token = registered.json()["access_token"]
    claims = jwt.decode(token, signing_key, algorithms=["HS256"], audience="finance-dashboard-web", issuer="finance-dashboard")
    assert set(("sub", "sid", "jti", "iat", "nbf", "exp", "type")).issubset(claims)
    assert claims["type"] == "access" and claims["exp"] - claims["iat"] == 300
    for key in ("sub", "sid", "jti"):
        UUID(claims[key])
    variants = [claims | {"iss": "other"}, claims | {"aud": "other"}, claims | {"type": "refresh"},
                claims | {"exp": int(datetime.now(timezone.utc).timestamp()) - 60},
                claims | {"nbf": int(datetime.now(timezone.utc).timestamp()) + 60},
                claims | {"sub": str(uuid4())}, claims | {"sid": str(uuid4())}, claims | {"sub": "invalid"}]
    variants += [{key: value for key, value in claims.items() if key != missing} for missing in ("sub", "sid", "jti", "iat", "nbf", "exp", "type")]
    invalid_tokens = [jwt.encode(value, signing_key, algorithm="HS256") for value in variants]
    invalid_tokens += [jwt.encode(claims, signing_key, algorithm="HS384"), jwt.encode(claims, "different-key-of-at-least-thirty-two-bytes", algorithm="HS256"), jwt.encode(claims, "", algorithm="none")]
    for invalid in invalid_tokens:
        response = api.get("/api/v1/auth/me", headers={"Authorization": "Bearer " + invalid})
        assert response.status_code == 401
        assert response.headers["www-authenticate"] == "Bearer"


def test_two_users_cannot_read_mutate_or_aggregate_each_others_finances(api, signing_key):
    first, _ = register(api)
    a = bearer(first)
    transaction = api.post("/api/v1/transactions", headers=a, json={"title": "Private A", "amount_usd": "12.12345678", "type": "expense", "category": "Private", "transaction_date": "2026-10-24"})
    subscription = api.post("/api/v1/subscriptions", headers=a, json={"service_name": "Private A", "amount_usd": "9", "next_payment_date": "2026-11-01"})
    assert transaction.status_code == subscription.status_code == 201
    assert api.patch("/api/v1/budget", headers=a, json={"monthly_income_usd": "123"}).status_code == 200
    assert api.patch("/api/v1/preferences", headers=a, json={"display_currency": "EUR"}).status_code == 200
    second, _ = register(api)
    b = bearer(second)
    import jwt
    claims = jwt.decode(first.json()["access_token"], signing_key, algorithms=["HS256"], audience="finance-dashboard-web", issuer="finance-dashboard")
    forged = jwt.encode(claims | {"sub": second.json()["user"]["id"]}, signing_key, algorithm="HS256")
    assert api.get("/api/v1/auth/me", headers={"Authorization": "Bearer " + forged}).status_code == 401
    for resource, response in [("transactions", transaction), ("subscriptions", subscription)]:
        url = f'/api/v1/{resource}/{response.json()["id"]}'
        assert api.get(url, headers=b).status_code == 404
        assert api.patch(url, headers=b, json={"amount_usd": "1"}).status_code == 404
        assert api.delete(url, headers=b).status_code == 404
        assert api.get(f"/api/v1/{resource}", headers=b).json()["total"] == 0
        assert api.get(url, headers=a).status_code == 200
    assert api.get("/api/v1/dashboard", headers=b).json()["transaction_count"] == 0
    assert api.get("/api/v1/subscriptions/summary", headers=b).json()["active_count"] == 0
    assert api.get("/api/v1/budget", headers=b).json()["monthly_income_usd"] == "0.00000000"
    assert api.get("/api/v1/preferences", headers=b).json()["display_currency"] == "USD"
    assert api.get("/api/v1/dashboard", headers=a).json()["expenses_usd"] == "12.12345678"
    assert api.get("/api/v1/preferences", headers=a).json()["display_currency"] == "EUR"
    assert api.get("/api/v1/budget", headers=a).json()["monthly_income_usd"] == "123.00000000"
    own_transaction = f'/api/v1/transactions/{transaction.json()["id"]}'
    own_subscription = f'/api/v1/subscriptions/{subscription.json()["id"]}'
    changed = api.patch(own_transaction, headers=a, json={"title": "Private A edited"})
    assert changed.status_code == 200
    assert changed.json()["amount_usd"] == "12.12345678"
    assert api.patch(own_subscription, headers=a, json={"status": "paused"}).status_code == 200
    assert api.delete(own_transaction, headers=a).status_code == 204
    assert api.delete(own_subscription, headers=a).status_code == 204
    assert api.get("/api/v1/dashboard", headers=a).json()["transaction_count"] == 0


def test_unauthenticated_financial_requests_never_bootstrap_records(api, phase5_engine):
    tables = ("owners", "transactions", "subscriptions", "budget_profiles", "preferences")
    with phase5_engine.connect() as connection:
        before = {table: connection.scalar(text(f'SELECT count(*) FROM "{table}"')) for table in tables}
    for path in ("transactions", "subscriptions", "subscriptions/summary", "dashboard", "budget", "preferences"):
        assert api.get("/api/v1/" + path).status_code == 401
    assert api.post("/api/v1/transactions", json={"title": "X", "amount_usd": "1", "type": "income", "category": "X", "transaction_date": "2026-10-24"}).status_code == 401
    for path in ("budget", "preferences"):
        assert api.patch("/api/v1/" + path, json={"owner_id": str(uuid4())}).status_code == 401
    with phase5_engine.connect() as connection:
        assert {table: connection.scalar(text(f'SELECT count(*) FROM "{table}"')) for table in tables} == before


def test_login_throttles_attempts_with_retry_after(api):
    _, email = register(api)
    statuses = [api.post("/api/v1/auth/login", headers=CSRF, json={"email": email, "password": "Wrong-password-42!"}) for _ in range(6)]
    assert [response.status_code for response in statuses[:5]] == [401] * 5
    assert statuses[5].status_code == 429
    assert int(statuses[5].headers["retry-after"]) > 0


def test_concurrent_rotation_one_success_one_replay_revokes_winning_access(api, phase5_engine):
    from concurrent.futures import ThreadPoolExecutor
    first, _ = register(api)
    old = api.cookies.get("fd_refresh")
    headers = CSRF | {"Cookie": "fd_refresh=" + old}
    with ThreadPoolExecutor(max_workers=2) as workers:
        pending = [workers.submit(api.post, "/api/v1/auth/refresh", headers=headers) for _ in range(2)]
        responses = [future.result(timeout=20) for future in pending]
    assert sorted(response.status_code for response in responses) == [200, 401]
    winner = next(response for response in responses if response.status_code == 200)
    assert api.get("/api/v1/auth/me", headers=bearer(winner)).status_code == 401
    assert api.get("/api/v1/auth/me", headers=bearer(first)).status_code == 401
    with phase5_engine.connect() as connection:
        revoked = connection.scalar(text("SELECT s.revoked_at IS NOT NULL FROM auth_sessions s JOIN auth_refresh_tokens t ON t.session_id=s.id WHERE t.token_hash=:hash"), {"hash": sha256(old.encode()).hexdigest()})
        assert revoked is True


@pytest.mark.parametrize("expired", ["family", "refresh"])
def test_expired_database_family_or_refresh_cookie_is_rejected(api, phase5_engine, signing_key, expired):
    import jwt
    registered, _ = register(api)
    raw = api.cookies.get("fd_refresh")
    claims = jwt.decode(registered.json()["access_token"], signing_key, algorithms=["HS256"], audience="finance-dashboard-web", issuer="finance-dashboard")
    now = datetime.now(timezone.utc)
    with phase5_engine.begin() as connection:
        if expired == "family":
            connection.execute(text("UPDATE auth_sessions SET created_at=:created, expires_at=:expires WHERE id=:id"), {"created": now - timedelta(days=31), "expires": now - timedelta(minutes=1), "id": UUID(claims["sid"])})
        else:
            connection.execute(text("UPDATE auth_refresh_tokens SET created_at=:created, expires_at=:expires WHERE token_hash=:hash"), {"created": now - timedelta(days=8), "expires": now - timedelta(minutes=1), "hash": sha256(raw.encode()).hexdigest()})
    response = refresh(api)
    assert response.status_code == 401
    assert "Max-Age=0" in response.headers["set-cookie"]
    assert api.get("/api/v1/auth/me", headers=bearer(registered)).status_code == (401 if expired == "family" else 200)


def test_registration_never_adopts_or_changes_synthetic_legacy_financials(api, phase5_engine):
    from datetime import date
    from decimal import Decimal
    from sqlalchemy.orm import Session
    from app.models import BudgetProfile, Owner, Preferences, Subscription, Transaction
    with Session(phase5_engine) as session, session.begin():
        owner = Owner()
        session.add(owner); session.flush()
        legacy = owner.id
        session.add_all([
            Transaction(owner_id=legacy, title="Synthetic legacy", amount_usd=Decimal("12.12345678"), type="expense", category="Synthetic", transaction_date=date(2026, 10, 24)),
            Subscription(owner_id=legacy, service_name="Synthetic legacy", amount_usd=Decimal("1"), next_payment_date=date(2026, 11, 1)),
            BudgetProfile(owner_id=legacy, monthly_income_usd=Decimal("123.12345678")),
            Preferences(owner_id=legacy, display_currency="EUR"),
        ])
    def snapshot(connection):
        result = {}
        for table, field in [("owners", "id"), ("transactions", "owner_id"), ("subscriptions", "owner_id"), ("budget_profiles", "owner_id"), ("preferences", "owner_id")]:
            result[table] = connection.scalar(text(f"SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text, '[]')) FROM {table} t WHERE {field}=:owner"), {"owner": legacy})
        return result
    with phase5_engine.connect() as connection:
        before = snapshot(connection)
    registered, _ = register(api)
    with phase5_engine.connect() as connection:
        assert snapshot(connection) == before
        assert connection.scalar(text("SELECT count(*) FROM users WHERE owner_id=:owner"), {"owner": legacy}) == 0
        registered_owner = connection.scalar(text("SELECT owner_id FROM users WHERE id=:id"), {"id": UUID(registered.json()["user"]["id"])})
        assert registered_owner != legacy
    headers = bearer(registered)
    assert api.get("/api/v1/dashboard", headers=headers).json()["transaction_count"] == 0
    assert api.get("/api/v1/budget", headers=headers).json()["monthly_income_usd"] == "0.00000000"
    assert api.get("/api/v1/preferences", headers=headers).json()["display_currency"] == "USD"
