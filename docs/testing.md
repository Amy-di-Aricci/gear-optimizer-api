# Testing strategy

Status: draft · Last updated: 2026-10-12 · Part of the [backend migration plan](overview.md)

Aim for **confidence in the risky parts** (permissions, the publish transaction, data mapping), not a coverage number. Every PR runs the fast suites, and `main` can't be merged red.

## API

| Layer | Tool | What to test |
| --- | --- | --- |
| Unit | **Vitest** (chosen over Jest; TypeScript is transpiled with `tsc` in `vitest.config.mts` so Nest gets decorator metadata) | Pure logic: change-set diffing, item ↔ DTO mapping, slot/type validation rules, BIS maths later. |
| Integration | Vitest + **real Postgres** (the local `gear_optimizer_test` database, see [environments](environments.md#development-local-postgresql); a `postgres` service container in GitHub Actions) | Prisma queries, migrations, **publish transaction** (all-or-nothing, `data_version` bump, audit row, build hook called after commit), scheduled jobs (safe to run late and twice), frozen-season rejection, change-set conflicts (a draft based on an older `data_version`), account deletion (purge + tombstone), the delete rules in [data model](data-model.md#users-phase-3), every `CHECK` / composite-key constraint (insert an invalid row, expect a rejection), and each [rule enforced by the API](data-model.md#rules-enforced-by-the-api). No DB mocks here; mocks hide exactly the bugs these tests exist for. |
| HTTP / e2e | **Supertest** against the booted Nest app + test DB | Request validation, status codes, `Cache-Control: no-store` on API responses, session cookie flags, requests without a valid proxy signature rejected, except `/api/health` and the public game-data reads with a valid build token (a wrong, old or missing token → 404; the token ignored on every other route) ([trusted proxy](security.md#trusted-proxy)), staff-only login refusing other accounts. |
| **Authorization matrix** | Supertest, generated | See [security](security.md). Every route × every actor (anonymous, user A, user B, editor, admin) × site (public, admin) → expected status. `/api/admin/*` answers 404 to anonymous users, users without the role, and staff whose session or request comes from the public site. **New routes without a declared policy fail the test.** |
| Contract | CI script | `openapi:export` and fail if `openapi.json` changed but wasn't committed. |
| Migrations | CI | `prisma migrate diff` checks that the schema and migrations agree. Apply all migrations to an empty DB on every run. |

Test data: small factories (`makeItem()`, `makeUser({ role })`) plus a fixed seed with a handful of real items, not the full ~900.

## Frontend

See `docs/backend-migration.md` in the frontend repo.

## Data import

Import file validation and the diff engine: see [data-import.md](data-import.md#tests). The scraper, in the private ops repo, has its own tests.

## CI gates (all repos)

PR → lint + typecheck + unit + integration (+ authz matrix) + contract check + security scans ([security](security.md)) → merge. `main` → deploy to staging → Playwright e2e → deploy to production (start with a manual approval step for production).

Playwright on staging logs in as a fake user: before the run, CI inserts that user and a session into the staging database (using the migration role it already has) and starts the browser with the session cookie. The app has no test-only login code, so there's nothing to misconfigure in production.
