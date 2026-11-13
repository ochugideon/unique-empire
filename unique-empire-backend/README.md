# Unique Empire – Backend (FastAPI · PostgreSQL)

Implements the backend of **Software Architecture v1.1** and **SRS v1.1**: a modular-monolith FastAPI service with
synchronous SQLAlchemy 2.0, Alembic migrations, JWT + bcrypt auth, SlowAPI rate limiting, Sentry hooks, and a Docker Compose
deployment (Caddy + FastAPI + private PostgreSQL).

> **Status – please read.** The code was written and statically checked (compiles, intra-project imports resolve, the pure
> business-rule tests in `tests/test_rules.py` pass). It was **not executed against FastAPI/PostgreSQL**, because the build
> environment had no network to install dependencies. Run the full test suite first (`pytest`) and expect to fix a few
> small things before production. Details under "Verification".

## Quick start

```bash
cp .env.example .env            # set SECRET_KEY (32+ chars) and POSTGRES_PASSWORD
mkdir -p backup frontend-dist
docker compose up -d --build    # runs `alembic upgrade head` on start
docker compose exec api python -m scripts.seed --username owner --full-name "Business Owner" --with-categories
# API docs (non-production only): http://localhost/api/docs
```

Local development without Docker:

```bash
python -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
export DATABASE_URL=postgresql+psycopg2://ue:ue_password@localhost:5432/unique_empire
alembic upgrade head && python -m scripts.seed
uvicorn app.main:app --reload
pytest                          # integration tests use in-memory SQLite
```

## Layout

```
app/
  main.py            app factory, error format, security headers, health, Sentry scrubbing
  config.py          settings (env) – architecture section 14 starting values
  models.py          the 16 tables
  core/              money (exact Decimal), rules (pure business rules), security, rate limit, time
  schemas/           Pydantic request/response models (money = decimal strings)
  services/          business logic: sales, closing, expenses, sync, reports, restoration, audit
  api/deps.py        auth context, role guards, device guard
  api/v1/            routers under /api/v1
alembic/             migrations (0001 = baseline + audit-log immutability trigger)
scripts/             seed, backup.sh, restoration_admin, report_backup_failure, entrypoint
tests/               rules (pure), API workflows (SQLite)
Dockerfile · docker-compose.yml · Caddyfile
```

## Endpoint map (`/api/v1`)

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/login` · `/auth/refresh` · `/auth/logout` · `GET /auth/me` · `POST /auth/change-password` |
| Staff (owner) | `GET/POST /users` · `PATCH /users/{id}` · `POST /users/{id}/reset-password` |
| Devices | owner: `GET/POST /devices`, `PATCH /devices/{id}/status` · any: `GET /devices/me`, `POST /devices/me/heartbeat` |
| Catalogue | `GET/POST /categories` · `GET/POST /products` · `PATCH /products/{id}` · `POST /products/{id}/variants` · `PATCH /variants/{id}` |
| Business days | `GET /business-days/current` · `POST /open` · `POST /{id}/close` · `POST /{id}/reopen` · `GET /{id}/summary` · `GET /{id}/closings` |
| Sales | `POST /sales` · `GET /sales` (search) · `GET/PATCH /sales/{id}` · `POST /sales/{id}/complete` · `POST /sales/{id}/void` · `DELETE /sales/{id}?confirm=true` (drafts) |
| Expenses | `POST /expenses` (all staff) · `GET /expenses` · `PATCH /expenses/{id}/assign-day` (owner/manager) |
| Sync | `POST /sync/upload` · `GET /sync/status` · `GET /sync/review` · `POST /sync/review/{key}/resolve` |
| Reports | `GET /reports/summary?period=daily\|weekly\|monthly\|custom` · `GET /dashboard` (client polls every 15 s) |
| Owner | `GET /audit-logs` · `GET /technical-events` · `POST /restoration-requests` |

Every business-record request carries the header `X-Device-Id` (the app-generated id the owner registered). Errors are
always `{"error": {"code", "message", "details"}}`.

## How the key rules are implemented

* **Money:** `NUMERIC(12,2)` columns, Python `Decimal`, decimal strings on the wire; JSON floats are rejected (422).
* **One OPEN day per branch:** partial unique index `WHERE status='OPEN'`; day rows are locked (`FOR UPDATE`) while sales complete or the day closes.
* **Sales:** drafts never count; completion requires payments that equal the total; split payments; cash change computed server-side;
  identical variants merge; price/product names are snapshotted; voiding needs a reason and password and keeps all rows.
* **References:** `UE-{DEV}-{YYMMDD}-{NNN}`; device codes are unique forever; client-supplied references are validated and the
  per-device counter advances; if omitted the server allocates one atomically.
* **Offline sync:** each record runs in its own SAVEPOINT; the outcome per idempotency key is stored in `sync_records`
  (a retry returns the earlier outcome). Sale to day rules (Arch. 4.2): open day → attach; closed day and `occurred_at` before close →
  held as `LATE_DAY_CLOSED` (owner/manager attaches via post-close adjustment); after close → held as `AFTER_CLOSE_TIME`
  (assign to the open day or reject). Nothing is ever attached silently.
* **Expenses:** three-step assignment; a match on an already-closed day is *not* attached, it waits (with `suggested_business_day_id`) for an owner/manager.
* **Closing:** versioned `daily_closings` (never overwritten); discrepancies need explanations; closing is blocked while an ACTIVE
  device is stale (no report for 12 h or pending > 0) unless the **owner** gives an exceptional-closing reason; "sales less recorded
  expenses" is never called profit. Corrections after close append an `ADJUSTMENT` version.
* **Auth:** bcrypt; 15-min access JWT; refresh token in a `Secure`/`HttpOnly`/`SameSite=Strict` cookie, stored hashed, rotated on every use, reuse revokes
  the session; 5 failures lock for 15 min; 15 min inactivity ends the session; `offline_authorization_expires_at` (7 days) is returned for the client to enforce.
* **Audit:** written in the same transaction as the action; PostgreSQL trigger makes `audit_logs` append-only.
* **Restoration:** request is stored in `audit_logs` **and** appended to `RESTORATION_LOG_PATH` (must be on storage outside the DB volume).
  After a restore the administrator runs `python -m scripts.restoration_admin performed ...` to re-insert the audit entries.
  Clients re-sending already-synced records after a restore set `resync_after_restore: true`; those records enter the review queue.

## Decisions I made where the documents were silent (please confirm)

1. **Expected cash/transfer/POS** = payments received by that method **minus expenses paid by that method**.
2. **Reopening** a day sets it back to `OPEN` (so it is refused while another day is open) and needs the user's password.
3. **Post-close adjustment** (attaching a held sale or an unassigned expense to a closed day) creates a new `ADJUSTMENT` closing version that
   carries over the previously counted amounts and records the reason; the owner/manager can then reopen and re-close if recounting is needed.
4. **Offline uploads are accepted only from the staff member who created the record** (`ACTOR_MISMATCH` otherwise), so one person cannot upload under another's name.
5. **Idle timeout** is enforced server-side too: after 15 idle minutes (including long offline periods) the user must sign in again before syncing.
6. **Attendants** only ever see their own sales/drafts; other people's ids return 404.
7. Migration `0001` creates tables from the models. For later changes use `alembic revision --autogenerate`.
8. No endpoint hard-deletes business data (products are deactivated; only drafts can be deleted, with an audit row).

## Backups

`docker-compose.yml` turns on WAL archiving into `./backup/wal`; `scripts/backup.sh` takes a daily `pg_dump -Fc` with 90-day retention and
reports failures into `technical_events`. **`./backup` must be synced to storage separate from the VPS** (rclone/bucket mount); until you do, it only protects against
database corruption, not VPS loss. Still to decide (Arch. section 14): storage provider, backup encryption, final RPO/RTO, monthly restore test in staging.

## Verification

* Done here: `compileall`, import/name check across the project, 8 pure rule tests (references, exact money, offline classification, expense assignment, reconciliation, device staleness).
* Written but **not run here**: `tests/test_api.py` (11 workflow tests: roles, payments, drafts/conflicts, void, closing, expenses, idempotent sync, review queue, lockout, restoration log).
* Not covered yet: load testing, PostgreSQL-specific behaviour (row locks, the audit trigger), CI workflow (`.github/workflows` for GitHub Actions with a production approval gate).
