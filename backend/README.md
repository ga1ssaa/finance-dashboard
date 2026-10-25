# Finance Dashboard backend API

Python 3.12 or newer, FastAPI, PostgreSQL, SQLAlchemy 2.0, Alembic, and
Pydantic 2. The backend supplies versioned CRUD endpoints, owner-scoped financial
aggregates, persisted budget inputs and display preferences, database sessions,
migrations, and health endpoints.

Authentication isolates each account's financial namespace. Every financial
route requires a short-lived Bearer token and checks its active server session;
health checks and interactive documentation remain public. Bind the development
API to `127.0.0.1`. Production startup is deliberately blocked until a shared
rate limiter and an approved reverse-proxy contract are implemented.

Existing owners and financial records are preserved and remain unclaimed.
Registration always creates a fresh owner. `SINGLE_OWNER_ID` is no longer used
for routing or authorization; leaving an old value in a private `.env` does not
grant access. Any transfer of legacy records needs a separately reviewed,
explicitly approved manual migration. This phase performs no such transfer.

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

user = "finance_local"
database = "finance_dashboard"
password = secrets.token_hex(32)
content = (
    f"POSTGRES_USER={user}\n"
    f"POSTGRES_PASSWORD={password}\n"
    f"POSTGRES_DB={database}\n"
    f"DATABASE_URL=postgresql+psycopg://{quote(user, safe='')}:{quote(password, safe='')}"
    f"@127.0.0.1:5434/{quote(database, safe='')}\n"
    f"AUTH_JWT_SECRET={secrets.token_urlsafe(48)}\n"
    f"APP_ENV=development\n"
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
the URL; do not log its unwrapped value. `AUTH_JWT_SECRET` is required, must
contain at least 32 UTF-8 bytes, and has no fallback. Generate it privately
with `secrets.token_urlsafe(48)`; preserve an existing key rather than replacing
it during setup. Never print the key or commit it. `APP_ENV` defaults to
`development`; `test` is also available. `production` startup is blocked.

The React development server may call the API from `http://localhost:5173` or
`http://127.0.0.1:5173` by default. The explicit API origin
`http://127.0.0.1:8000` also permits the Swagger UI's auth requests.
`CORS_ALLOWED_ORIGINS` optionally overrides
this exact allowlist using a JSON array, for example
`CORS_ALLOWED_ORIGINS=["http://127.0.0.1:5174"]` for a different Vite port.
Start Vite with `npm run dev -- --strictPort` to avoid silently switching away
from its configured port when that port is occupied.
Only `http://` or `https://` origins on `localhost`, `127.0.0.1`, or `[::1]`
with an explicit port from 1 through 65535 are accepted. URLs with paths,
trailing slashes, credentials, queries, fragments, wildcards, or public hosts
are rejected at startup. Set `CORS_ALLOWED_ORIGINS=[]` to disable cross-origin
access. Browser credentials are enabled only for exact configured origins;
permitted cross-origin API methods are GET, POST, PATCH, and DELETE, with
Content-Type, Authorization, and X-CSRF-Protection headers. Use the same hostname
for frontend and backend (for example `127.0.0.1` for both) so SameSite cookies
work. A custom API port must be added explicitly for Swagger auth requests.
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

Migration `0003_auth` only adds `users`, `auth_sessions`, and
`auth_refresh_tokens` with their own constraints and indexes. It does not alter
or update owners, financial tables, or existing rows. Apply migrations only
after explicit approval of the target and a preservation snapshot; verify on
a fresh disposable database first. For an approved target:

```sh
alembic upgrade head
uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000 --no-proxy-headers
```

Revision `0001_infrastructure` establishes Alembic's version baseline;
`0002_models` creates the five financial model tables described below;
`0003_auth` adds authentication. Application
startup never connects to the database, creates tables, or applies migrations.
Engine creation is lazy; its pool is disposed when the application shuts down.

`0004_data_operations` adds only `data_operation_receipts`, its constraints and
indexes. It does not alter or backfill financial, owner, user or auth tables.
The complete generated offline SQL is `alembic/sql/0004_data_operations.sql`.
Generating that file does not apply it. Applying this revision requires separate
approval, current schema/financial preservation fingerprints and verified backup
readiness; no live migration is performed by this feature. New preview/write/status
operations fail closed with 503 until the exact revision and required receipt
schema are available. Financial CRUD and export do not apply or require it.

From the repository root, use the explicit config and application paths:

```sh
backend/.venv/bin/alembic -c backend/alembic.ini current
backend/.venv/bin/uvicorn --app-dir backend app.main:create_app --factory --host 127.0.0.1 --port 8000 --no-proxy-headers
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
| `users` / `User` | Unique normalized email, Argon2id password hash, unique owner reference. |
| `auth_sessions` / `AuthSession` | User reference, absolute 30-day family expiry, optional revocation timestamp. |
| `auth_refresh_tokens` / `AuthRefreshToken` | Unique SHA-256 token hash, family reference, expiry and optional used timestamp. Raw refresh tokens are never persisted. |
| `data_operation_receipts` / `DataOperationReceipt` | Permanent owner/key receipt with a unique owner/preview nonce, semantic request hash and bounded result summary. No document, password or token is stored. |

Financial and auth models have their own UUID primary key, generated by Python `uuid4`
when the ORM inserts a row. No database UUID extension or server UUID default
is needed; raw SQL inserts must explicitly supply IDs. Financial columns are nonnull;
auth revocation and token-use timestamps are nullable.
Budget and preferences each have a separate named unique constraint on
`owner_id`. Owners may exist without any child records.

Each child references `owners.id` with `ON DELETE RESTRICT`. Bidirectional ORM
relationships use `back_populates`; owner collections and one-to-one relationships
use `passive_deletes="all"` and have no delete/delete-orphan cascade. Deleting an
owner with children fails even when those children have already been loaded.
Deletion would need an explicitly designed service and authorization policy.
Owner foreign keys provide the boundary used by authenticated API services.

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

## Authentication contract

`POST /api/v1/auth/register` and `/login` take `{email,password}` JSON and return
`{access_token,token_type:"bearer",expires_in:300,user:{id,email}}` (201/200).
Email is normalized by stripping outer whitespace and lowercasing ASCII. Passwords
must contain 8–128 Unicode characters, fit 512 UTF-8 bytes, and are never trimmed
or truncated. Stored Argon2id hashes use 65536 KiB memory, time cost 3, parallelism
1, 32-byte output and a random 16-byte salt. Unknown accounts still verify a
dummy Argon2id hash. Wrong logins return the same generic 401; duplicate accounts
return generic 409. Validation responses omit raw inputs and error context.

All authentication POST requests require an exact configured `Origin` and
`X-CSRF-Protection: 1`; missing, null or foreign origins return 403. Register/login
also require `Content-Type: application/json` (415 otherwise). Same-origin
Swagger auth calls use the explicit API origin above; set the CSRF header to `1`.
Token and user responses, including auth errors, have `Cache-Control: no-store`
and `Pragma: no-cache`. Do not log request bodies, Authorization headers, cookies,
access tokens or passwords.

`POST /api/v1/auth/refresh` takes no body and rotates the `fd_refresh` cookie.
`POST /api/v1/auth/logout` takes no body, revokes that cookie's entire session
family, and returns 204 even for an unknown/missing cookie. `GET /api/v1/auth/me`
requires Bearer authorization and returns only `{id,email}`. Access JWTs are
HS256-only with issuer `finance-dashboard`, audience `finance-dashboard-web`,
UUID subject/session/token IDs, access type, and required issued/not-before/expiry
times (five-second leeway). They expire after five minutes; every protected request
also checks that the referenced session is active and unexpired, using a separate
short-lived read session.

Refresh tokens have 256 random bits, are hashed with SHA-256 for storage, and live
up to seven days within a 30-day absolute session lifetime. Rotation locks the
family before its token, marks the old token used, and commits before issuing a
new cookie/token. Used tokens are retained to detect replay; replay revokes the
family and commits before returning 401. Logout likewise revokes the family,
including when presented an old used token. There is no replay grace period;
clients must serialize refresh, login, register and logout cookie operations.

The host-only cookie is HttpOnly, SameSite=Lax, and scoped to `/api/v1/auth`.
Local HTTP uses Secure=false; the production cookie helper uses Secure=true.
Cookie deletion repeats the same attributes. The browser client keeps access
tokens in memory and sends `credentials: include` for auth cookie requests.

A bounded process-local limiter uses the ASGI client IP: login 20/IP/minute
and 5/normalized-email/minute, registration 5/IP/hour, refresh and logout each
30/IP/minute. Invalid credentials and malformed requests from a permitted origin
with the CSRF header count; cross-site requests are rejected before quota use.
Limits use monotonic time, locks, TTL expiry
and at most 10000 keys; a full active key set fails closed. Rejections return 429
with Retry-After. Production startup remains blocked pending a shared limiter and
an approved proxy/client-IP contract. The development commands above explicitly
disable Uvicorn proxy-header processing; retain `--no-proxy-headers` so an
untrusted forwarded header cannot change the client IP used by the limiter.
Recovery, email verification, MFA and breached
password checking are future production hardening, not implemented endpoints.

## Financial API contract

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

Registration creates the authenticated account's fresh owner atomically.
Ordinary list/detail/aggregate reads create nothing. Budget and preferences
persist zero/USD defaults on their first GET or PATCH within that account's
namespace. Unique constraints and PostgreSQL `ON CONFLICT DO NOTHING` make
singleton bootstrap safe for concurrent requests. Unauthorized or invalid
requests create no financial records.

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
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"title":"Groceries","amount_usd":"24.50","type":"expense","category":"Food","transaction_date":"2026-10-24"}'
curl --fail -H "Authorization: Bearer $ACCESS_TOKEN" 'http://127.0.0.1:8000/api/v1/transactions?type=expense&limit=20&sort_by=amount_usd&sort_direction=desc'
curl --fail -H "Authorization: Bearer $ACCESS_TOKEN" 'http://127.0.0.1:8000/api/v1/dashboard?date_from=2026-10-01&date_to=2026-10-31'
curl --fail -X PATCH http://127.0.0.1:8000/api/v1/preferences \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' --data '{"display_currency":"KZT"}'
```

## Tests

```sh
python -m pytest
```

Tests live in `tests/`. The default suite skips database integration checks.
New authentication integration tests run only against a separately prepared,
explicitly approved disposable database identified by the guarded Phase 5 test
state. Provisioning a current disposable fixture requires a separately reviewed
and approved procedure. The frozen Phase 5 preparation/proof helpers are not a
`0004_data_operations` provisioning path and must not be rerun or reused for it.
After approved preparation, run the auth tests from `backend/`:

```sh
RUN_DATABASE_TESTS=1 python -m pytest tests/test_auth_database.py
```

Model, finance API and authentication integration tests share the guarded
Phase 5 fixture in `tests/conftest.py`. It requires the private test manifest
at stage `ready`, the exact approved disposable database
`finance_dashboard_phase5_f0e1554a4e98` on `127.0.0.1:5434`, ten public tables
including `alembic_version`, and revision `0004_data_operations`. The previously
approved `0003_auth` fixture does not meet this gate and must fail closed; these
checks never upgrade it automatically or fall back to `finance_dashboard`.
These fixtures do not apply migrations or wipe tables. Model/finance test rows
stay inside an externally owned transaction with session savepoints and are
rolled back after each test. Authentication tests commit only inside their
disposable target to verify logout and replay revocation across independent
connections. Never point these checks at development, personal or production
data. Setting `RUN_DATABASE_TESTS=1` is not approval to prepare or modify a
database; every live run requires separate approval of its exact target.

A manual upgrade/downgrade rollback proof, when separately authorized, must
first lock all five empty business tables in an external transaction and confirm
they are empty. Pass that connection to Alembic, downgrade to
`0001_infrastructure`, upgrade back to `0002_models`, then roll back the outer
transaction and verify the original schema and revision remain. This checks DDL
reversibility without committing the downgrade. Never downgrade a populated
database. The regular tests do not perform this manual proof.

## Verification tools and approval boundary

`backend/verification/` contains import-safe tools for separately approved
verification. Importing them does not inspect Docker, connect to PostgreSQL,
reserve a database name, or run a proof. Static and mocked tests can review
the guards without a running Docker daemon or database. These tools are not
application startup hooks and do not run automatically.

The frozen backup/restore fingerprint workflow in `verification/backup_safety.py`
accepts only revision `0002_models`; it intentionally rejects the development
schema now at `0003_auth`. Future backup/restore work requires separately
reviewed targets and explicit approval.

The read-only entry point, when read-only inspection is authorized, is:

```sh
backend/.venv/bin/python backend/verification/read_only_inspect.py
```

It checks only `backend-postgres-1` through the local account's explicit Docker
Desktop Unix socket. Container name, Compose project `backend`, service
`postgres`, running/healthy state, and the live `5432/tcp` binding must match
exactly `127.0.0.1:5434`. Docker context/host environment overrides are rejected.
It connects to maintenance `postgres` with forced read-only transactions to
list only database names matching `finance_dashboard_phase5_[0-9a-f]{12}`, then
connects read-only to `finance_dashboard` for revision, table names, financial
row counts and row hashes. No row values or connection credentials are printed.

The migration proof is `backend/verification/auth_migration_proof.py`. Execution
requires separate explicit approval of its full current contents and one literal
`--database finance_dashboard_phase5_<12 lowercase hex digits>` argument. It
never generates a hidden target, resumes an old proof, or reuses an uncertain
database. Do not execute it merely to inspect or test the script.

Both tools reject every URL query/fragment and every `PG*` routing environment
variable rather than relying on libpq precedence. They construct canonical
loopback connection parameters and verify the actual database before handing
out connections. `finance_dashboard` is permitted only through a forced
read-only engine; writable targets must match the disposable namespace. All
critical guards use explicit exceptions and remain active under `python -O`.

Before `CREATE DATABASE`, the proof exclusively reserves its exact identifier
in `backend/auth-migration-proof.local`, with mode 0600 and file/directory fsync.
A second exclusive creation claim prevents concurrent or interrupted retries.
Progress updates use atomic replace and fsync; reservations remain on failure.
Creation uses only maintenance `postgres` with AUTOCOMMIT. Duplicate creation
aborts before any target connection. The new database is migrated to `0002`,
seeded with five synthetic legacy records, fingerprinted, then upgraded to
`0003` and checked for preserved records, unclaimed legacy ownership, and ORM
consistency. The development fingerprint is compared before and after. No
drop, reset, downgrade, deletion, or automatic cleanup is implemented. A prior
interrupted proof has an unknown execution outcome until separately authorized
read-only inspection establishes what exists.

## Stop local PostgreSQL

```sh
docker compose --env-file .env -f compose.yaml down
```

This preserves the named volume. Do not add `-v`: that deletes local database
data. Real-database migrations, deployment, commits, and remote changes require
separate explicit approval.

## Financial JSON export

`GET /api/v1/data/export` requires the same Bearer session as the financial API
and accepts no query parameters, filters, pagination, owner selector, or body.
It downloads a version-one `finance-dashboard` JSON document containing the full
authenticated owner's transactions, subscriptions, budget inputs and display
currency. Missing budget/preferences are `null` and are not created by export.
The envelope includes `schema_version: 1`, a UTC `exported_at`, and
`base_currency: "USD"`. Business records contain no IDs, owner/account fields,
audit timestamps, credentials or session data. Money uses exactly eight decimal
places and calendar dates use `YYYY-MM-DD`; identical records remain distinct.

All reads use one dedicated repeatable-read, read-only transaction that is
rolled back and closed after serialization. The response has `Cache-Control:
no-store`, `Pragma: no-cache`, `X-Content-Type-Options: nosniff`, and a safe UTC
attachment filename. Exports exceeding 10000 transactions, 1000 subscriptions,
or 5 MiB of UTF-8 JSON return 413 without truncation or a partial download.
Database and stored-data failures return generic errors without row values.

This endpoint does not run PostgreSQL archive utilities or modify the database.
This export-only behavior describes Phase 6.1. Later confirmed replacement/reset
are described below and require separately approved `0004_data_operations`
provisioning before they can operate; merge remains unsupported.

## Financial JSON import preview

`POST /api/v1/data/import/preview` accepts Bearer-authenticated JSON with exactly
`mode: "replace"`, `source_format: "v1"`, and `document`, the original JSON file
as a string. No query parameters or owner selector are accepted. Authentication
precedes body processing; the HTTP body is bounded to 10 MiB before JSON parsing,
and the document itself is bounded to 5 MiB of strict UTF-8.

Only the required version-one export envelope and business fields are accepted.
Before recursive JSON decoding, both layers enforce a maximum depth of eight
containers and a budget of 150000 tokens (container starts, strings and primitive
atoms). During decoding, duplicate keys and nonfinite/float numbers are rejected;
integer lexemes are limited to 32 characters before conversion. Unknown fields, missing metadata,
IDs, audit fields, invalid Unicode, numeric money, non-USD base currency and legacy
formats are rejected. The version must be the integer `1`; money must be unsigned
strings with exactly eight decimal places, with a positive transaction amount.
Dates require `YYYY-MM-DD`; the export timestamp requires UTC `Z` or `+00:00`,
with at most six fractional-second digits. Limits remain 10000 transactions and
1000 subscriptions. Validation errors do not echo document contents or key names.

Complete document validation happens before a financial connection is acquired.
Current account state uses one dedicated repeatable-read, read-only transaction,
owner-scoped full row hashing, rollback and connection cleanup. Preview never
creates missing defaults, imports rows, or stages a document or receipt.
The response contains only source metadata, SHA-256 of the exact document UTF-8
bytes, source/current counts, hypothetical replacement counts and fixed warnings.
The document digest is informational and authorizes no later action. A separate
signed preview token binds the complete current financial state as described
below. Responses and errors are not cached.

Private PostgreSQL archive utilities are never invoked; legacy formats and owner
assignment remain unsupported.

## Confirmed replacement, reset and reconciliation

Import preview adds `preview_token` and UTC `expires_at` to its summary.
`POST /api/v1/data/reset/preview` accepts exactly `{}` and returns current counts,
removal/zero-creation impact, warnings, a preview token and expiry. Both previews
are authenticated read-only operations. Tokens live exactly ten minutes, are
purpose-separated from access JWTs, and bind the user, active session, owner,
operation, original document digest, complete state digest and a random one-use
nonce. State includes all four financial tables' IDs, audit timestamps, business
fields and absence, with typed canonical hashing and bounded row buffering.

`POST /api/v1/data/import` takes the same `mode`, `source_format`, and raw
`document` as preview, plus `preview_token`, the current `password`, and exact
`confirmation: "REPLACE MY FINANCIAL DATA"`. It supports replacement only, never
merge or append. `POST /api/v1/data/reset` takes `preview_token`, current
`password`, and exact `confirmation: "RESET MY FINANCIAL DATA"`. Both require a
canonical UUID `Idempotency-Key`, an exact trusted `Origin`,
`X-CSRF-Protection: 1`, and JSON. The password is never trimmed. Combined import
and reset attempts are limited to five/user and ten/client-IP per ten minutes;
cross-site requests are rejected before quota use. The limiter is process-local
and production startup remains blocked.

Every financial mutation and singleton-creating budget/preferences GET uses the
same existing-owner row lock. Replacement/reset take that lock first, then a
shared lock on the active auth session, and check the exact receipt schema and
owner-scoped idempotency receipt before any delete. A matching committed receipt
returns its recorded result before password/token-expiry/state checks; a reused
key with different semantic input returns 409. Fresh operations require current
password, typed confirmation, an unused matching token nonce and an unchanged
full state. Session validity and token expiry are checked again before commit.
Ordinary non-creating reads and exports do not take the writer lock. All writers
must follow this protocol; direct administrative SQL needs separate coordination.

One transaction removes only the authenticated owner's transactions,
subscriptions, budget and preferences, creates replacement rows with fresh UUIDs
and server audit timestamps, and inserts the immutable receipt. Identical input
rows remain distinct. Missing singletons remain absent. Reset creates no defaults.
Owner, User, authentication records, unclaimed legacy ownership and every receipt
are preserved. Receipt retention is indefinite; the application never updates or
deletes receipts. Semantic hashes exclude password, confirmation, token, preview
nonce, session and time. A nonce cannot commit twice under different keys.

Successful writes and `GET /api/v1/data/operations/{key}` return the same immutable
summary: `idempotency_key`, `operation`, `status: "completed"`, UTC `completed_at`,
import `document_sha256` (null for reset), and `removed`/`created` counts. Results
are visible only within the authenticated owner's namespace. Cache-hit results
are materialized before releasing the owner lock through rollback.

Known validation/authorization/conflict failures roll back before commit. An
uncertain commit acknowledgment returns 503 `OPERATION_OUTCOME_UNKNOWN`; never
automatically retry, generate a new key, downgrade, restore or clean up. Status
404 `OPERATION_NOT_OBSERVED` means unknown, not proof that nothing happened: the
original transaction may still be in flight. After an earlier unknown outcome,
a failed retry does not resolve that original uncertainty. Reconcile by the
original key; any explicit retry must retain that key and semantic request.
Responses and errors use no-store headers and omit credentials, document
contents, driver messages and private validation paths.
