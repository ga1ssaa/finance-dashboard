# Production preparation: Vercel + Heroku

Prepared offline only. No resource, domain, credential, migration or deployment
has been created by this phase. A separate approval is required for each real
target, migration and deployment. Keep the existing local PostgreSQL databases,
Docker project and volumes untouched.

## Architecture and budget

Use **https://getavero.app** on Vercel Hobby and **https://api.getavero.app** on
one Heroku Basic web dyno, with Heroku Postgres Essential-0. Both origins use
HTTPS on the **same registered `getavero.app` site**, so the existing host-only
Secure, HttpOnly, SameSite=Lax cookie remains compatible with cross-origin auth.
No cross-site cookie mode is supported. Validators support explicitly configured
two-label `.app` or `.me` sites; this does not authorize other domains or origins.
Default `vercel.app` and `herokuapp.com` pairs, and arbitrary preview origins,
are intentionally rejected. No wildcard CORS, cookie Domain, SameSite=None,
public database port, Redis, extra worker dyno or paid add-on is added.

Basic is $7/month; Essential-0 is $5/month: **$12/month eligible Heroku compute
and database**, leaving $1 under the requested ceiling. Check the account's
current plan prices/credit eligibility before provisioning. One-off migration
dynos, extra concurrent dynos, taxes, credit expiry and storage/plan upgrades can
increase charges. Domain renewal is separate. Vercel Hobby is limited to personal
non-commercial use and its resource quotas; do not enable paid upgrades implicitly.

The domain is already registered. This phase changes repository configuration
only; DNS setup, provider domain binding and certificate issuance need separate
approval and verification.

Official references: [Heroku billing](https://devcenter.heroku.com/articles/usage-and-billing),
[Postgres pricing](https://www.heroku.com/pricing#databases),
[Essential limits](https://devcenter.heroku.com/articles/heroku-postgres-plans),
[Vercel Hobby use](https://vercel.com/docs/limits/fair-use-guidelines).
Essential-0 has 1 GB and 20 connections and no HA. This is a small portfolio
deployment, not a highly available financial service.

## Backend configuration and startup

Choose the **Heroku Python buildpack explicitly**: the monorepo also has a root
package.json. Root `.python-version` selects Python 3.13; `requirements.txt`
installs the existing `./backend` package. `Procfile` runs
`python -m app.production`; it has **no release/migration command**. Existing
Docker Compose and backend Dockerfile keep their local development command.
The production path uses no persistent filesystem or private dotenv files.

Set these as private Heroku process config variables, using
`backend/production.env.example` only as a variable-name reference:

| Variable | Required value |
|---|---|
| `APP_ENV` | `production` |
| `AUTH_JWT_SECRET` | Private cryptographically random key, at least 32 bytes; generate with `secrets.token_urlsafe(48)` and never print/share it |
| `DATABASE_URL` | Provider-managed new database URL; postgres/postgresql schemes normalize to psycopg; do not edit the provider value |
| `PRODUCTION_DATABASE_HOST` / `PRODUCTION_DATABASE_NAME` | Exact approved provider host and new database identity; update deliberately after provider relocation |
| `PRODUCTION_SITE_DOMAIN` | `getavero.app`, without scheme or path |
| `PRODUCTION_API_ORIGIN` | `https://api.getavero.app` |
| `CORS_ALLOWED_ORIGINS` | `["https://getavero.app"]`; do not add wildcard, preview or unapproved subdomain origins |
| `TRUSTED_PROXY` | `heroku`, only for the reviewed Heroku Common Runtime router boundary |
| `DATABASE_SSLROOTCERT` | Absolute path to the approved CA bundle available in the dyno; Heroku documents `/usr/lib/ssl/certs/ca-certificates.crt` for its stack |

Heroku supplies `PORT` and `DYNO`; do not invent them to run this path on another
host. Startup requires a web dyno, the CA bundle, one Uvicorn worker, disabled
blanket proxy-header trust/access logging, and bounded concurrency (16 requests).
Password hashing/verification shares a two-slot semaphore (64 MiB Argon2 per
slot); hashing parameters, token lifetime, rotation/replay detection, session
revocation and account ownership remain unchanged. Load/memory testing on the
actual Basic dyno remains a pre-launch requirement.

Production SQLAlchemy uses three connections, no overflow, short checkout/connect
timeouts, recycling and a fixed public-schema search path. Reserve remaining connections for backups, a separately
authorized migration or one-off inspection; do not add workers without reviewing
the total. TLS requires **verify-full, TLS >=1.2 and the approved CA**; no fallback
to require/disable is implemented. Actual Essential-0 hostname/certificate chain
verification must pass before launch. If that plan cannot verify with the
documented bundle, stop for a security/provider review instead of weakening TLS.
[Heroku SSL documentation](https://devcenter.heroku.com/articles/connecting-heroku-postgres).

## Proxy, CORS, CSRF and cookies

Only the configured API Host is accepted (default Heroku hostname is rejected).
The middleware requires one overwritten `X-Forwarded-Proto: https` and reads only
the **rightmost** IP appended by Heroku in `X-Forwarded-For`; client-supplied left
entries and X-Forwarded-Host are ignored. Invalid/duplicate/missing headers fail
closed. This relies on router-only access to the Heroku dyno network: never reuse
the contract on a public VM, another proxy, or by setting Uvicorn's forwarded
allowlist to `*`. HTTP is rejected before credential/body processing; HSTS,
nosniff and no-store are applied to accepted production responses.
[Heroku routing contract](https://devcenter.heroku.com/articles/http-routing),
[overwritten protocol header](https://help.heroku.com/J2R1S4T8/can-heroku-force-an-application-to-use-ssl-tls).

Refresh cookies remain HttpOnly, Secure in production, host-only, SameSite=Lax
and scoped to `/api/v1/auth`. Auth POSTs and destructive data operations retain
exact Origin plus `X-CSRF-Protection: 1` enforcement; credentialed CORS allows
only the configured origins/methods/headers. Authorization still checks the
server-side active session on every protected financial request. CORS is not
authorization and does not prevent non-browser requests.

Auth and data-write quotas use the new PostgreSQL `auth_rate_limits` table,
with atomic advisory-locked transactions, database clock, expiry cleanup,
bounded windows and 10,000 maximum buckets. HMAC keys contain no plaintext
emails/IPs; quota state survives web restarts and is shared between processes.
Connection/lock/database failures return unavailable, never a process-local
fallback. No quota DDL runs from application startup. Existing dev/test instances
continue using their existing bounded in-memory limiter.

## Frontend / Vercel

Root directory: repository root. Node: 24. Framework: Vite. Build: `npm run build`;
output: `dist`; dependency install uses the existing npm lockfile. Existing
React Router routes use the `vercel.json` SPA fallback. No API rewrite or
additional server function is introduced.

Production public build variables only:

```
VITE_API_BASE_URL=https://api.getavero.app/api/v1
VITE_APP_ORIGIN=https://getavero.app
```

The apex is the exact frontend origin. `www.getavero.app` is not currently
configured: any alias/redirect needs separate approval, never an implicit CORS
expansion. These variables are **public bundle contents**, never secrets. Never
set DATABASE_URL, JWT keys, passwords or other private values under VITE_*.
The shared API URL validator covers auth, CRUD, import/preview/reset and export;
it rejects insecure, cross-site, credential-bearing and malformed endpoints.
The running browser origin must match the configured frontend origin. Public
frontends cannot fall back to localhost. Rebuild after changing these values.
Keep preview deployments disconnected from production auth/data unless they
receive a separately approved same-site test origin and isolated backend.
[Vercel Vite/SPA documentation](https://vercel.com/docs/frameworks/frontend/vite).

## Explicit new-database migration approval

Historical migrations `0001`–`0004` are unchanged. `0005_auth_rate_limits` only
adds the independent security table/index; monetary columns/calculations and
financial rows are not changed. Readiness requires exactly this revision and
the quota columns; health liveness does not connect to the database. Data
operations accept the reviewed `0004` or `0005` schema and still probe receipt
columns; other revisions remain blocked. Frozen historical database test and
backup fixtures remain scoped to their original approved revisions.

Before approving a real migration: verify the app/add-on identity, exact host,
database/user, TLS chain, an empty dedicated database (or the exact initial
extension-view inventory below), and review
the offline Alembic SQL. Never use the existing `finance_dashboard`, any
`finance_dashboard_*`, `avero_compose`, template database or local Docker volume.

After **separate explicit authorization**, a Heroku one-off dyno from the reviewed
release may run this command (placeholders only, do not execute now):

```
python -m app.production_migrations --host <approved-provider-host> \
  --database <approved-new-database> \
  --confirm 'MIGRATE NEW AVERO PRODUCTION DATABASE'
```

It rejects mismatched targets before connecting; checks server database/user
identity and non-system relations; locks and applies only the fixed approved
revision through the same transaction/connection. Existing application data or
any inventory outside the initial-target policy below is refused. Normal online
`alembic upgrade`, including caller-provided connections,
is blocked in production without the command's in-process authorization.
Offline `--sql` remains read-only. Future incremental migrations require a new
explicitly reviewed procedure; this new-target runner will refuse them.
Remote online migrations are also rejected when mislabeled as development.
Alembic tracks both financial/auth metadata and the separate quota metadata, so
future autogeneration does not treat the security table as an unwanted table.

### PostgreSQL 18.4 and the first Heroku target

Offline review of `0001_infrastructure` through `0005_auth_rate_limits` found no
known PostgreSQL 18.4 incompatibility: UUID values are supplied by callers,
NUMERIC(20,8), JSONB, timestamp/date columns and ordinary constraints/indexes use
supported PostgreSQL syntax. Full-chain SQL generation is tested without a
connection. This is not a live migration or restore rehearsal; historical
migrations and frozen PostgreSQL 17 proof fixtures remain unchanged.

The operator's live read-only inspection reported exactly
`public.pg_stat_statements` and `public.pg_stat_statements_info`, both views and
exact whole-object members of extension `pg_stat_statements`, version `1.12`,
with no AVERO name conflicts. These reported identities match PostgreSQL's
documented statistics views and PostgreSQL 18's upstream default extension
version. **Provider provenance and unmodified definitions remain UNVERIFIED.**
This is a narrowly approved catalog compatibility policy, not attestation of
the provider, extension code or view contents, and not migration approval.

**Initial-target policy:** the preflight and manual migration runner call the
same `app.initial_database.require_initial_database` validator. It permits:

* Zero counted relations; or
* Exactly the two named public views above, each a whole-object extension member
  (`pg_depend` class/refclass match, both subobject IDs zero, dependency `e`),
  with extension name `pg_stat_statements` and version exactly `1.12`.

If the extension is installed but both views are missing, the empty-target path
also rejects it. The extension registry must match version `1.12` for the pair.
Partial pairs, duplicate/malformed metadata, unknown or additional relations,
wrong versions/membership/types, application tables/views, materialized views,
sequences, foreign tables and mixed inventories fail closed. A namespace check
also requires `public` as the only non-system schema, including when otherwise
empty; it excludes only catalog/toast/temporary system namespaces and does not
mistake names such as `pgXtest` for system schemas. Names are checked against
current financial/auth/quota metadata, including table names, primary/unique
backing indexes, explicit indexes/sequences and Alembic's table/index names.
The five reviewed upgrades create no object with either approved view name,
read neither view, and do not alter extensions. No global extension exemption
exists; an Alembic revision or any application table blocks repeat initialization.

Never drop, relocate, recreate or reset these objects to satisfy the guard.
Extension membership and version do not detect arbitrary definition tampering by
a privileged actor. Keep schema-write access controlled and maintenance ON with
web=0 through the separately authorized migration. Any changed inventory requires
fresh investigation, not a relaxed policy. This guard is not for incremental upgrades.

Both paths execute their shared fixed catalog queries with `no_parameters=True`:
otherwise an empty DBAPI parameter mapping makes psycopg parse the literal `%`
in `NOT LIKE 'pg_%'` as parameter syntax. Regression tests exercise real
SQLAlchemy/psycopg adaptation. The relation filter and its `_` wildcard remain
unchanged; the additional explicit namespace check rejects unexpected schemas.

### Separately approved read-only relation identification

For future inventory changes, authorize only a metadata inspection from the
reviewed Heroku release with maintenance ON and web=0. Reuse the existing
preflight's production settings, engine factory, TLS/identity verification,
native read-only initialization, deadline and rollback/close/disposal helpers.
Do not call the migration runner or Alembic. No new deployment is needed if the
reviewed query is supplied to the existing read-only one-off harness via stdin.

The prepared query is
[`backend/verification/heroku_relation_identity.sql`](../backend/verification/heroku_relation_identity.sql).
It selects only schema/relation kind and names, installed extension/version,
the exact whole-object `pg_depend` extension membership and an AVERO name-conflict
flag. It never selects owners, credentials, definitions, statistics query text
or application rows. It reports provider provenance as **UNVERIFIED**: catalog
membership cannot prove who installed or later modified an extension.

Bind the conflict-check names from current reviewed metadata rather than records:

```python
import app.models
from app.db import Base
from app.rate_limits import rate_table
from sqlalchemy import PrimaryKeyConstraint, UniqueConstraint, text

names = {"alembic_version", "alembic_version_pkc"}
for table in list(Base.metadata.tables.values()) + [rate_table]:
    names.add(table.name)
    names.update(index.name for index in table.indexes if index.name)
    for constraint in table.constraints:
        if isinstance(constraint, (PrimaryKeyConstraint, UniqueConstraint)):
            names.add(constraint.name or table.name + "_pkey")
# Within the already verified read-only connection, using the reviewed query:
rows = connection.execute(text(sql), {"avero_relation_names": sorted(names)}).all()
```

Validate and JSON-encode all metadata before displaying it to the authorized
operator; never interpolate identifiers into SQL or print raw exceptions or
connection details. Bound the result/output size and fail closed on malformed,
duplicate or inconsistent membership replies. A metadata conflict flag is not
an exhaustive safety assessment. Do not read unknown view contents or print
view definitions, which could contain sensitive literals.

Next gates before the first migration: separately review/approve commit, push,
CI and deployment of the compatibility patch; preserve maintenance ON/web=0;
rerun the deployed preflight (including capacity) and verify the actual current
inventory; review full-chain offline SQL and recovery readiness; then obtain
separate explicit authorization for the exact target and guarded migration.
After migration, separately verify the revision/schema and application readiness
before starting a web dyno or opening traffic. No step is executed by this patch.
Provider provenance can be investigated with Heroku support; do not represent
catalog membership as proof. Counts or names alone never authorize migration.

References: [PostgreSQL statistics extension](https://www.postgresql.org/docs/18/pgstatstatements.html),
[extension dependencies](https://www.postgresql.org/docs/18/catalog-pg-depend.html),
[Heroku extensions](https://devcenter.heroku.com/articles/heroku-postgres-extensions-postgis-full-text-search),
[PostgreSQL 18 extension control](https://github.com/postgres/postgres/blob/REL_18_STABLE/contrib/pg_stat_statements/pg_stat_statements.control),
[SQLAlchemy no_parameters](https://docs.sqlalchemy.org/en/20/core/connections.html#sqlalchemy.engine.Connection.execution_options.params.no_parameters).

## Backups, recovery and rollback

Before admitting real users, explicitly schedule Heroku PGBackups (daily; check
current Essential retention). Take a manual capture before approved future
migrations; download a copy to operator-controlled encrypted storage, with a
documented retention/deletion policy. Use existing encrypted private storage
where available; additional storage cost is not silently added to this budget.
Do not store backups, signed download URLs or credentials in Git, CI artifacts,
browser localStorage or the ephemeral dyno filesystem. User JSON export is not
a complete database backup (it excludes authentication/receipts).
[PGBackups](https://devcenter.heroku.com/articles/heroku-postgres-backups).

Initial proposed objectives: RPO 24 hours; RTO four hours, **unverified until a
restore drill**. Restore only to a separately approved, isolated new database.
Verify schema, account ownership, exact decimal values, receipt consistency,
row counts and readiness before any cutover. Revoke restored auth sessions and
rotate the access-token signing key to avoid resurrecting previously revoked
sessions. Do not reuse or relax the Mac-only frozen backup proof scripts.
Keep database endpoints, backup credentials and decryption keys private and
separate. A rollback of application code must be schema-compatible; never run
automatic downgrade or restore in place over the current database.

## Remaining launch gates and limitations

1. Separate approval for provider resources, domain DNS, config
   secrets, migration and deployment; this phase performs none of those actions.
2. Confirm plan/credit eligibility, Python-only buildpack, PostgreSQL 18.4 migration compatibility,
   registered-domain DNS/certificates, provider CA verification and the spending cap.
3. Isolated staging: real TLS, proxy-header contract, browser login/logout and
   refresh, owner-isolated CRUD, shared quota concurrency, small-dyno memory and
   connection load, migration/restore rehearsal. Offline fakes do not prove live
   PostgreSQL SQL execution or provider integration.
4. Independent encrypted backups and a successful restore drill before real data.
5. Essential-0 has permissive owner credentials and limited role/HA controls;
   confirm available privilege restrictions. Protect Heroku/Vercel accounts with
   MFA, least-privilege collaborators and short/private log retention. Router
   logs can include query strings (including financial search terms); app access
   logging is disabled but cannot suppress provider logging. Never send tokens
   or passwords in URLs. No public demo account may contain personal records.
6. Cross-tab refresh rotation remains the existing documented limitation: use one
   active tab until separately improved. This phase adds no deployment automation
   or secrets to GitHub Actions and makes no security/availability guarantee for
   real funds or highly sensitive financial use.
