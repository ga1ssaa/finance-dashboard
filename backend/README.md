# Finance Dashboard backend API

Python 3.12 or newer, FastAPI, PostgreSQL, SQLAlchemy 2.0, Alembic, and
Pydantic 2. The backend supplies versioned CRUD endpoints, owner-scoped financial
aggregates, persisted budget inputs and display preferences, database sessions,
migrations, and health endpoints.

This is a local single-user API with no authentication. Bind it to
`127.0.0.1`; exposing it publicly is unsafe. `SINGLE_OWNER_ID` is required server
configuration, not a client parameter or authentication credential. Keep it
stable to retain access to the same namespace. Every record lookup, mutation,
and aggregate is scoped to it; API responses never expose ownership IDs.

Run the following commands from `backend/` unless stated otherwise.

## Install

```sh
python3.13 -m venv .venv
source .venv/bin/activate
python -m pip install -e '.[dev]'
```

Use another Python 3.12+ executable if `python3.13` is unavailable.

## Configure the local database

`.env.example` documents variable names using placeholders. Create a private
`.env` with a generated password using the command below. It refuses to overwrite
an existing file and does not print credentials:

```sh
python - <<'PY'
import os
from pathlib import Path
import secrets
from urllib.parse import quote
from uuid import uuid4

user = "finance_local"
database = "finance_dashboard"
password = secrets.token_hex(32)
content = (
    f"POSTGRES_USER={user}\n"
    f"POSTGRES_PASSWORD={password}\n"
    f"POSTGRES_DB={database}\n"
    f"DATABASE_URL=postgresql+psycopg://{quote(user, safe='')}:{quote(password, safe='')}"
    f"@127.0.0.1:5434/{quote(database, safe='')}\n"
    f"SINGLE_OWNER_ID={uuid4()}\n"
)
descriptor = os.open(Path(".env"), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(descriptor, "w") as file:
    file.write(content)
PY
```

Never commit `.env` or paste its contents into logs or issue reports. If setting
a password manually, URL-encode the username and password in `DATABASE_URL`;
the `POSTGRES_PASSWORD` value remains the original password. The generated hex
password avoids URL and Compose interpolation characters.

The application and Alembic resolve `.env` relative to this backend directory,
independent of the working directory. Explicit process environment variables
override the file. `DATABASE_URL` is required and must use
`postgresql+psycopg`, with a host and database. Settings representations mask
the URL; do not log its unwrapped value. `SINGLE_OWNER_ID` must be a valid UUID.
For an existing private `.env`, add a generated UUID without printing the file.

The React development server may call the API from `http://localhost:5173` or
`http://127.0.0.1:5173` by default. `CORS_ALLOWED_ORIGINS` optionally overrides
this exact allowlist using a JSON array, for example
`CORS_ALLOWED_ORIGINS=["http://127.0.0.1:5174"]` for a different Vite port.
Start Vite with `npm run dev -- --strictPort` to avoid silently switching away
from its configured port when that port is occupied.
Only `http://` or `https://` origins on `localhost`, `127.0.0.1`, or `[::1]`
with an explicit port from 1 through 65535 are accepted. URLs with paths,
trailing slashes, credentials, queries, fragments, wildcards, or public hosts
are rejected at startup. Set `CORS_ALLOWED_ORIGINS=[]` to disable cross-origin
access. Browser credentials are disabled; permitted cross-origin API methods
are GET, POST, PATCH, and DELETE, with the Content-Type request header.
CORS controls browser access, and does not replace authentication or a local bind.

Start a fresh local PostgreSQL service:

```sh
docker compose --env-file .env -f compose.yaml up -d --wait postgres
```

Compose requires all three PostgreSQL variables and binds only to
`127.0.0.1:5434`; the local database is `finance_dashboard`. Data lives in the
project-scoped `postgres_data` named volume.
Changing `.env` does not change credentials in an already initialized volume.
Avoid printing `docker compose config`, which can expose substituted secrets.

## Apply migrations and run

For the local database configured above:

```sh
alembic upgrade head
uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000
```

Revision `0001_infrastructure` establishes Alembic's version baseline;
`0002_models` creates the five model tables described below. Application
startup never connects to the database, creates tables, or applies migrations.
Engine creation is lazy; its pool is disposed when the application shuts down.

From the repository root, use the explicit config and application paths:

```sh
backend/.venv/bin/alembic -c backend/alembic.ini current
backend/.venv/bin/uvicorn --app-dir backend app.main:create_app --factory --host 127.0.0.1 --port 8000
```

Preview migration SQL without connecting:

```sh
alembic upgrade head --sql
```

Alembic obtains the URL directly from settings rather than the INI file, so
percent-encoded credentials are not interpreted as INI interpolation. Alembic
imports `app.models` to register all mapped tables in `Base.metadata`.

For transactional migration verification, callers can provide an open SQLAlchemy
`Connection` through `config.attributes["connection"]`. If that connection already
has an active transaction, Alembic uses it without committing or closing the
caller-owned transaction or connection. Otherwise the usual CLI path owns its
engine and transaction. Database-backed verification uses only the explicitly
confirmed empty local target described under Tests.

## Data models

| Table / model | Stored values and relationships |
| --- | --- |
| `owners` / `Owner` | UUID namespace and audit timestamps only; no login, password, email, or account data. |
| `transactions` / `Transaction` | Owner, nonblank title, positive `amount_usd`, income/expense type, free-text nonblank category, and date-only `transaction_date`. |
| `subscriptions` / `Subscription` | Owner, nonblank service name, nonnegative `amount_usd`, date-only next payment, nonblank icon (default `credit-card`), and active/paused status (default active). Dates are maintained manually. |
| `budget_profiles` / `BudgetProfile` | At most one per owner, with independent monthly income, needs spent, wants spent, and savings USD amounts, each defaulting to zero. No transaction aggregation or month history. |
| `preferences` / `Preferences` | At most one per owner, with USD/KZT/EUR/RUB display currency, default USD. Theme remains browser-local. |

All five models have their own UUID primary key, generated by Python `uuid4`
when the ORM inserts a row. No database UUID extension or server UUID default
is needed; raw SQL inserts must explicitly supply IDs. Every column is nonnull.
Budget and preferences each have a separate named unique constraint on
`owner_id`. Owners may exist without any child records.

Each child references `owners.id` with `ON DELETE RESTRICT`. Bidirectional ORM
relationships use `back_populates`; owner collections and one-to-one relationships
use `passive_deletes="all"` and have no delete/delete-orphan cascade. Deleting an
owner with children fails even when those children have already been loaded.
Deletion would need an explicitly designed service and authorization policy.
Owner foreign keys are an ownership boundary in the schema, not an authentication
or authorization implementation.

All money columns use `NUMERIC(20,8)` and Python `Decimal`: twelve integer digits
and eight fractional digits, in USD base currency. Checks reject PostgreSQL `NaN`,
positive/negative infinity, and negative values; transactions also reject zero.
The API rejects excess fractional precision before insertion, with no input
rounding. Direct SQL callers still encounter PostgreSQL's declared-scale rounding
before constraint checks. Changing display currency does not
rewrite stored money, and exchange rates are not part of these models.

Named database checks enforce supported transaction types, subscription statuses,
currencies, and nonblank text. Text must contain at least one non-whitespace
character, including rejecting tab/newline-only strings; surrounding whitespace
is preserved. Composite indexes cover transactions by `(owner_id,
transaction_date, id)` and subscriptions by `(owner_id, next_payment_date, id)`.

`created_at` and `updated_at` use timezone-aware database timestamps with `now()`
defaults. SQLAlchemy emits `updated_at = now()` on its update statements; there
is no database trigger, so raw SQL updates must maintain that field explicitly.
PostgreSQL `now()` reflects transaction time and is not a per-statement clock.
The migration creates schema only: no owners, demo data, seed records, financial
automation, or migration from browser storage is included.

## Health checks

```sh
curl --fail http://127.0.0.1:8000/api/v1/health
curl --fail http://127.0.0.1:8000/api/v1/health/ready
```

- Liveness returns HTTP 200 with `{"status":"ok"}`, even with PostgreSQL down,
  provided the required URL is configured correctly.
- Readiness runs `SELECT 1`, returning HTTP 200 with `{"status":"ready"}` or
  HTTP 503 with `{"status":"not_ready"}`. Responses omit connection details.
- New database connections and pool acquisition each use a three-second timeout;
  these bound separate operations rather than imposing a total request deadline.

Interactive API documentation is available at `http://127.0.0.1:8000/docs`.
Request sessions come from `app.db.get_session`; they close after the request,
and routes commit successful writes before returning. Services do not commit.

## API contract

All routes below use `/api/v1`. UUID path parameters, unsupported enum values,
unknown body fields (including `owner_id`), explicit PATCH nulls, and empty PATCH
bodies are validated. Query models reject unknown parameters on lists/dashboard;
`owner_id` is rejected on every financial endpoint. `transaction_date`,
`next_payment_date`, `date_from`, and `date_to` require `YYYY-MM-DD` calendar dates.
Audit timestamps are returned in UTC RFC3339 format.

| Routes | Behavior |
| --- | --- |
| `POST /transactions`, `GET /transactions`, `GET/PATCH/DELETE /transactions/{id}` | Positive USD amount, income/expense type, nonblank title/category, and date. |
| `POST /subscriptions`, `GET /subscriptions`, `GET/PATCH/DELETE /subscriptions/{id}` | Nonnegative USD amount, service name, next payment date, icon (default `credit-card`), status active/paused (default active). |
| `GET /subscriptions/summary` | Full owner set: `active_count`, `paused_count`, `monthly_cost_usd`; paused costs excluded. |
| `GET/PATCH /budget` | Four independent amounts: `monthly_income_usd`, `needs_spent_usd`, `wants_spent_usd`, `savings_usd`. |
| `GET/PATCH /preferences` | `display_currency`: USD, KZT, EUR, or RUB. |
| `GET /dashboard` | `income_usd`, `expenses_usd`, `balance_usd`, `transaction_count`, `expense_by_category` entries with `category`/`amount_usd`. |

First successful transaction/subscription creation atomically inserts the owner
if missing. Ordinary list/detail/aggregate reads create nothing. Budget and
preferences persist zero/USD defaults on their first GET or PATCH, atomically
with owner creation. Unique constraints and PostgreSQL `ON CONFLICT DO NOTHING`
make bootstrap safe for concurrent requests. Invalid requests create no records.

Send all money as JSON **strings**, using unsigned base-10 digits and an optional
decimal point with one to eight fractional digits. Up to twelve
integer digits fit `NUMERIC(20,8)`. Transactions must be greater than zero; all
other inputs may be zero. JSON numbers, signs, exponents, NaN/infinity, and
excess precision return 422. Requests are never rounded. Every monetary response,
including PostgreSQL-computed sums and differences, uses exactly eight fractional
digits; balances may be negative. All computations use Decimal/NUMERIC, with no
binary floating-point conversion. Display currency does not convert stored USD.

Lists return `{"items": [], "total": 0, "limit": 50, "offset": 0}`. `total` counts
the filtered set before pagination. Parameters shared by both lists are `limit`
(1–100, default 50), `offset` (nonnegative), `sort_by`, `sort_direction` (`asc` or
`desc`), and inclusive `date_from`/`date_to`. Inverted date intervals return 422.
UUID `id ASC` breaks sort ties consistently.

- Transactions filter by `type`, exact `category`, and `q` (case-insensitive
  literal substring across title/category; `%`, `_`, and backslash are literals).
  Sort fields: `transaction_date` (default, descending), `amount_usd`, `title`,
  `created_at`.
- Subscriptions filter by `status` and their next payment date. Sort fields:
  `next_payment_date` (default, ascending), `amount_usd`, `service_name`, `created_at`.
- Dashboard accepts only the inclusive date interval, defaults to all time, and
  aggregates the full matching transaction set. Expense categories exclude income
  and sort by amount descending, then category ascending.

Create returns 201, reads/PATCH return 200, DELETE returns 204 with no body.
Missing or foreign-owner IDs return identical 404 responses. Known database
conflicts return generic 409, unavailable database operations generic 503, and
invalid input 422. Responses omit SQL, connection strings, and tracebacks.

```sh
curl --fail http://127.0.0.1:8000/api/v1/transactions \
  -H 'Content-Type: application/json' \
  --data '{"title":"Groceries","amount_usd":"24.50","type":"expense","category":"Food","transaction_date":"2026-10-24"}'
curl --fail 'http://127.0.0.1:8000/api/v1/transactions?type=expense&limit=20&sort_by=amount_usd&sort_direction=desc'
curl --fail 'http://127.0.0.1:8000/api/v1/dashboard?date_from=2026-10-01&date_to=2026-10-31'
curl --fail -X PATCH http://127.0.0.1:8000/api/v1/preferences \
  -H 'Content-Type: application/json' --data '{"display_currency":"KZT"}'
```

## Tests

```sh
python -m pytest
```

Tests live in `tests/`. The default suite skips database integration checks.
After explicitly confirming the local test target and applying its migrations
separately, enable those checks from `backend/`:

```sh
RUN_DATABASE_TESTS=1 python -m pytest
```

The database suite accepts only the PostgreSQL/psycopg target
`127.0.0.1:5434`, database `finance_dashboard`, at revision `0002_models`, with
exactly the five business tables plus `alembic_version` in the public schema.
It requires every business table to be empty before tests begin. Tests do not
apply migrations, launch the application, or wipe tables. Test rows stay inside
an externally owned transaction with session savepoints and are rolled back
after each test. Never point these checks at an existing personal or production
database.

A manual upgrade/downgrade rollback proof, when separately authorized, must
first lock all five empty business tables in an external transaction and confirm
they are empty. Pass that connection to Alembic, downgrade to
`0001_infrastructure`, upgrade back to `0002_models`, then roll back the outer
transaction and verify the original schema and revision remain. This checks DDL
reversibility without committing the downgrade. Never downgrade a populated
database. The regular tests do not perform this manual proof.

## Stop local PostgreSQL

```sh
docker compose --env-file .env -f compose.yaml down
```

This preserves the named volume. Do not add `-v`: that deletes local database
data. Real-database migrations, deployment, commits, and remote changes require
separate explicit approval.
