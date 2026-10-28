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
database/user, TLS chain, an empty dedicated PostgreSQL 17 database, and review
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
revision through the same transaction/connection. Existing/nonempty targets are
refused. Normal online `alembic upgrade`, including caller-provided connections,
is blocked in production without the command's in-process authorization.
Offline `--sql` remains read-only. Future incremental migrations require a new
explicitly reviewed procedure; this new-target runner will refuse them.
Remote online migrations are also rejected when mislabeled as development.
Alembic tracks both financial/auth metadata and the separate quota metadata, so
future autogeneration does not treat the security table as an unwanted table.

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
2. Confirm plan/credit eligibility, Python-only buildpack, PostgreSQL 17 support,
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
