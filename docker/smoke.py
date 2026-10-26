"""Exercise the isolated local stack using newly registered synthetic data only.

Never logs credentials, cookies, tokens, or response bodies. Does not use host
database configuration. Only transaction IDs created by this run can be mutated.
"""

import argparse
from datetime import date
from http.cookiejar import CookieJar
import json
import re
import secrets
from urllib.error import HTTPError
from urllib.request import HTTPCookieProcessor, Request, build_opener
from uuid import uuid4


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("port must be between 1 and 65535")
    origin = f"http://127.0.0.1:{args.port}"
    api = origin + "/api/v1"
    cookies = CookieJar()
    browser = build_opener(HTTPCookieProcessor(cookies))
    anonymous = build_opener()

    def call(path, expected=200, method="GET", body=None, token=None,
             opener=browser, request_origin=origin, csrf="1"):
        headers = {"Origin": request_origin, "X-CSRF-Protection": csrf}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        if body is not None:
            headers["Content-Type"] = "application/json"
        request = Request(api + path, method=method, headers=headers,
                          data=None if body is None else json.dumps(body).encode())
        try:
            response = opener.open(request, timeout=15)
        except HTTPError as error:
            response = error
        with response:
            assert response.status == expected, f"{method} {path}: expected {expected}, got {response.status}"
            payload = response.read()
            return json.loads(payload) if payload else None

    # Refuse to write unless the expected isolated frontend marker is present.
    with anonymous.open(origin + "/healthz", timeout=15) as response:
        assert response.read() == b"avero-local\n", "Not the AVERO Compose frontend"
    for route in ("/", "/login", "/register", "/transactions"):
        with anonymous.open(origin + route, timeout=15) as response:
            html = response.read().decode()
            assert response.status == 200 and '<div id="root">' in html
    asset = re.search(r'src="(/assets/[^" ]+\.js)"', html)
    assert asset, "Production JavaScript bundle missing"
    with anonymous.open(origin + asset[1], timeout=15) as response:
        assert api.encode() in response.read(), "Frontend API origin does not match this stack"
    assert call("/health") == {"status": "ok"}
    assert call("/health/ready") == {"status": "ready"}
    print("PASS frontend, SPA routes, production bundle and proxied API readiness")

    call("/transactions", expected=401, opener=anonymous)
    call("/auth/register", expected=403, method="POST", body={}, request_origin="https://invalid.example")
    call("/auth/login", expected=403, method="POST", body={}, csrf="0")
    credentials = {"email": f"phase8-{uuid4().hex}@example.test", "password": secrets.token_urlsafe(32)}
    registered = call("/auth/register", expected=201, method="POST", body=credentials)
    user_id = registered["user"]["id"]
    refresh_cookie = next(cookie for cookie in cookies if cookie.name == "fd_refresh")
    assert refresh_cookie.path == "/api/v1/auth" and refresh_cookie.has_nonstandard_attr("HttpOnly")
    assert refresh_cookie.get_nonstandard_attr("SameSite").lower() == "lax"
    logged_in = call("/auth/login", method="POST", body=credentials)
    assert logged_in["user"]["id"] == user_id
    refreshed = call("/auth/refresh", method="POST")
    token = refreshed["access_token"]
    assert call("/auth/me", token=token)["id"] == user_id
    assert call("/transactions", token=token)["total"] == 0, "New test account must be empty"
    print("PASS register, login, HttpOnly cookie, refresh, current user and CSRF rejection")

    created_ids = []
    for kind, amount in (("income", "1000.12345678"), ("expense", "12.34000000")):
        body = {"title": f"Phase 8 synthetic {kind}", "amount_usd": amount,
                "type": kind, "category": "Compose smoke", "transaction_date": date.today().isoformat()}
        record = call("/transactions", expected=201, method="POST", body=body, token=token)
        record_id = record["id"]
        created_ids.append(record_id)
        assert record["amount_usd"] == amount and record["type"] == kind
        assert call(f"/transactions/{record_id}", token=token)["amount_usd"] == amount
        edited = call(f"/transactions/{record_id}", method="PATCH", body={"title": "Phase 8 edited"}, token=token)
        assert edited["amount_usd"] == amount, "Title edit changed canonical money"
    assert call("/transactions", token=token)["total"] == 2
    dashboard = call("/dashboard", token=token)
    assert dashboard["income_usd"] == "1000.12345678"
    assert dashboard["expenses_usd"] == "12.34000000"
    assert dashboard["balance_usd"] == "987.78345678"
    for record_id in created_ids:
        call(f"/transactions/{record_id}", expected=204, method="DELETE", token=token)
        call(f"/transactions/{record_id}", expected=404, token=token)
    assert call("/transactions", token=token)["total"] == 0
    print("PASS income/expense CRUD, exact USD values, title-only edits and aggregates")

    call("/auth/logout", expected=204, method="POST")
    call("/auth/me", expected=401, token=token)
    call("/auth/refresh", expected=401, method="POST")
    print("PASS logout revokes session and refresh; synthetic account retained, test transactions removed")


if __name__ == "__main__":
    main()
