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
revocation and account ownership remain unchanged. Check memory during the initial synthetic smoke test on
Basic; keep the existing one-worker/concurrency limits.

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

### Initial production compatibility policy

`0001_infrastructure` through `0005_auth_rate_limits` create ten application
tables plus `public.alembic_version` and their indexes/constraints. The upgrades
create no schemas, functions, extensions or event triggers, and do not alter
existing financial records. UUID, NUMERIC(20,8), JSONB, timestamp/date and index
SQL is supported by PostgreSQL 18; the full chain is generated and checked
offline. The preflight accepts PostgreSQL 18 minor updates, not unknown majors.
No live migration is claimed by these tests.

The preflight and authorized migration runner use the same
`app.initial_database.require_initial_database` policy:

* `public` must exist with USAGE and CREATE privileges. The effective explicit
  search path must be exactly `public`, matching the production engine options.
* Other non-system schemas are rejected except the exact `_heroku` namespace.
  Heroku documents it as internal infrastructure on Essential databases. It is
  permitted only if its owner resolves to a role the application is **not a
  member of or administrator of**, the application has **no CREATE** privilege
  there, and the application is not a member or administrator of any role owning
  relations, routines or types there. Membership is checked even if a grant is
  not inherited; ADMIN OPTION is checked because it can confer membership. Missing/NULL
  or malformed metadata fails closed. These checks include application-owned
  objects and objects owned by roles the application could assume.
* This trusts the documented provider boundary in the newly provisioned Heroku
  database. It does not claim to authenticate the provider's role by its name or
  audit provider routine bodies. A different owner alone is insufficient. The
  reported count of 14 is **not** an acceptance condition. Trigger-name syntax,
  routine signatures and exhaustive internal inventories are not launch gates.
* The relation filter still covers `_heroku`: no schema exemption is added to
  the relation count. Across all non-system schemas, zero counted relations OR
  exactly `public.pg_stat_statements` and `public.pg_stat_statements_info` are
  allowed. Both must be views and exact whole-object extension members of
  `pg_stat_statements`, version `1.12`. Partial pairs, extra/unknown tables,
  views, materialized views, sequences, partitioned/foreign tables, wrong
  versions/membership, and existing application/Alembic tables are rejected.
  An installed statistics extension with both views missing is also rejected.
* Actual `public` relation names (all relation kinds, including indexes and
  composite relations) and type names are checked against the reviewed migration
  footprint using bound parameters. This rejects standalone domains/composite
  types that would collide with an application table even when no tables exist.
  The generated DDL tests cover every table and named backing index/constraint.

AVERO never adds `_heroku` to its search path, reads its application data, or
alters/drops/moves its objects. Provider DDL event triggers may fire normally
when PostgreSQL processes migrations; they are part of the trusted Heroku
platform and are not disabled or rewritten. This policy is an initial-target
check, not an exhaustive database-content audit or permission to upgrade an
existing application database.

The preflight retains production configuration, CA availability, native read-only
initialization, actual connection identity, verify-full/TLS 1.2+, PostgreSQL 18
compatibility, shared target readiness and a small connection-capacity snapshot.
The shared guard includes privilege/conflict/Alembic-state rejection, so separate
duplicate checks are unnecessary. Fixed failure codes suppress database values.
The old temporary inventory/trigger parsers are not part of the release path.

Fixed raw catalog queries retain `no_parameters=True` for psycopg's literal
percent handling. Name-conflict queries use compiled SQLAlchemy `text()` with
bound arrays; identifiers are never interpolated into SQL.

References: [Heroku internal Essential schema](https://help.heroku.com/HYME3MD5/unexpected-statements-in-the-backup-from-a-essential-x-database-is-causing-local-pg_restore-to-fail),
[PostgreSQL role and privilege checks](https://www.postgresql.org/docs/18/functions-info.html),
[statistics views](https://www.postgresql.org/docs/18/pgstatstatements.html),
[extension dependencies](https://www.postgresql.org/docs/18/catalog-pg-depend.html),
[SQLAlchemy no_parameters](https://docs.sqlalchemy.org/en/20/core/connections.html#sqlalchemy.engine.Connection.execution_options.params.no_parameters).

### Approved release and first migration runbook

These are future operator instructions, **not executed by this implementation**.
No new permanent resource is required. Each real release/migration/DNS action
still needs explicit approval; Heroku one-off dynos consume temporary billable
usage. Keep production secrets and target identifiers private.

1. After approval, commit/push the reviewed files, require the four CI jobs to
   pass for that SHA, and manually deploy that exact release from `feat/fullstack`
   in **Heroku → avero-api → Deploy → Manual deploy**. Leave automatic deployments
   disabled. Confirm maintenance ON and **Resources → web → Basic**, scaled to
   zero. A release may start a web process; stop it before migration if necessary:

   ```sh
   heroku maintenance:on --app avero-api
   heroku ps:scale web=0 --app avero-api
   ```

2. Run the reviewed, read-only preflight from the new release. It verifies the
   ownership/privilege boundary in the actual database; offline mocks cannot
   prove those live grants. If it fails, stop on the specific failure. Do not
   switch TLS modes, change ownership, edit provider objects or relax the guard.

   ```sh
   heroku run --app avero-api --size basic --no-tty --exit-code -- python backend/verification/heroku_pg_preflight.py
   ```

3. Separately approve the exact target and complete offline migration SQL. Replace
   the host/database placeholders below with the privately reviewed target, not
   values copied from untrusted output. Keep the explicit host/database arguments
   independent of environment-only approval. This runner fixes the revision at
   `0005_auth_rate_limits` and uses one transaction/connection with advisory lock
   and timeouts; startup never runs it:

   ```sh
   heroku run --app avero-api --size basic --no-tty --exit-code -- python -m app.production_migrations --host '<approved-provider-host>' --database '<approved-new-database>' --confirm 'MIGRATE NEW AVERO PRODUCTION DATABASE'
   ```

4. On confirmed migration success, start exactly one Basic web dyno, keeping
   maintenance ON while preparing the custom domain. The production Procfile and
   one-worker limits are already configured:

   ```sh
   heroku ps:scale web=1 --app avero-api
   ```

5. Add `api.getavero.app` in **Heroku → Settings → Domains and certificates** if
   not already attached. In Name.com, use the exact Heroku-provided DNS target for
   an `api` CNAME; never invent a target or use the database hostname. Enable
   Automatic Certificate Management and wait for valid HTTPS. No wildcard origin
   or temporary default-domain authentication bypass is needed.

6. Once HTTPS is valid, turn maintenance OFF and check both endpoints. Expect
   HTTP 200 with `ok` and `ready`. Readiness verifies the migrated security schema;
   liveness alone is insufficient. If readiness fails, re-enable maintenance and
   keep users out while investigating:

   ```sh
   heroku maintenance:off --app avero-api
   curl --fail --silent --show-error https://api.getavero.app/api/v1/health
   curl --fail --silent --show-error https://api.getavero.app/api/v1/health/ready
   ```

7. In Vercel Hobby, import this repository with the root Vite project and reviewed
   `feat/fullstack` release, using existing `vercel.json` build/SPA routing. Set
   only the public production variables `VITE_API_BASE_URL=https://api.getavero.app/api/v1`
   and `VITE_APP_ORIGIN=https://getavero.app`. Attach `getavero.app`; copy the
   DNS records shown by Vercel into Name.com and verify HTTPS. Do not add secrets
   or use arbitrary preview/default domains with production authentication.

8. Use a new synthetic account for a brief browser smoke test: register/login,
   refresh/reload, owner-isolated transaction CRUD, logout/re-login, and direct SPA
   navigation. Check cookie Secure/HttpOnly/SameSite=Lax and exact credentialed
   CORS/CSRF behavior. Do not use or modify existing accounts or financial records.
   Check memory/connection usage and billing; keep one worker and one web dyno.

### Minimal first-migration recovery

For a normal failure before commit, the runner exits through `Engine.begin()`,
which rolls back transactional PostgreSQL DDL and the Alembic version changes;
it then disposes the engine. Keep maintenance ON and web=0. After reviewing the
sanitized failure, rerun only the read-only preflight. If it passes again, a retry
of the guarded migration requires renewed explicit approval of the same target.
Never drop/reset the database, touch `_heroku`, force an Alembic stamp, run a
downgrade, or disable a guard to retry.

If the process loses its connection near commit, the outcome is **unknown**.
Do not assume rollback or automatically retry. Establish `public.alembic_version`
and schema/readiness through an authorized read-only connection using the same
verified TLS/identity path. If revision `0005_auth_rate_limits` is already
committed, proceed with readiness verification rather than rerunning the initial
migration. Any inconsistent/partial state requires targeted review, not deletion.
No restore, extra database or new paid service is part of this initial launch.

## Backups, recovery and rollback

Before storing financial records worth preserving, schedule Heroku PGBackups (daily; check
current Essential retention). Take a manual capture before approved future
migrations; download a copy to operator-controlled encrypted storage, with a
documented retention/deletion policy. Use existing encrypted private storage
where available; additional storage cost is not silently added to this budget.
Do not store backups, signed download URLs or credentials in Git, CI artifacts,
browser localStorage or the ephemeral dyno filesystem. User JSON export is not
a complete database backup (it excludes authentication/receipts).
[PGBackups](https://devcenter.heroku.com/articles/heroku-postgres-backups).

Restore capability remains unverified until tested; a restore drill is recommended
before relying on the app for important data, not a new resource requirement for
this empty-target portfolio launch. Restore only to a separately approved, isolated new database.
Verify schema, account ownership, exact decimal values, receipt consistency,
row counts and readiness before any cutover. Revoke restored auth sessions and
rotate the access-token signing key to avoid resurrecting previously revoked
sessions. Do not reuse or relax the Mac-only frozen backup proof scripts.
Keep database endpoints, backup credentials and decryption keys private and
separate. A rollback of application code must be schema-compatible; never run
automatic downgrade or restore in place over the current database.

## Remaining launch gates and limitations

1. Obtain approval for the reviewed release, live preflight, explicit migration,
   existing dyno startup, Vercel deployment and domain/DNS setup. No live action is
   performed by this patch. Existing TLS/identity results are operator-reported;
   the new ownership/conflict checks still need one deployed preflight run.
2. Confirm API/frontend DNS and HTTPS, readiness and the synthetic browser smoke
   test above. Offline tests do not prove Heroku's live role grants, event-trigger
   behavior during DDL, small-dyno memory or actual API/browser integration.
3. Back up data worth keeping. Essential-0 has limited role/HA controls. Protect
   provider accounts with MFA, keep collaborators/log retention minimal, and
   monitor the existing Basic + Essential budget. No extra permanent services,
   staging database or exhaustive provider-object audit is required here.
4. Router logs can contain URL query strings; never send passwords or tokens in
   URLs. Public demo accounts must contain synthetic data only. Multiple tabs can
   still race refresh-token rotation; use one active tab. This remains a small
   portfolio deployment without a high-availability or real-funds guarantee.
