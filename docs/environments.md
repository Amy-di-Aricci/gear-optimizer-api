# Environments

Status: draft · Last updated: 2026-10-09 · Part of the [backend migration plan](overview.md)

Three stages. Each has its own database and its own secrets, and none shares credentials with another.

| | Development | Staging | Production |
| --- | --- | --- | --- |
| Purpose | Local work | Check a release on real infrastructure before production | The live site |
| API | `npm run start:dev` on your machine | Render `gear-optimizer-api-staging` (Frankfurt, free) | Render `gear-optimizer-api` (Frankfurt, free) |
| Database | Local PostgreSQL: `gear_optimizer_dev` (+ `gear_optimizer_test` for tests) | Neon branch `staging` | Neon branch `main` |
| Frontend | Vite dev server, proxying `/api` to `localhost:3000` | Netlify branch deploy, proxying `/api` to the staging service | Netlify production, proxying `/api` to the production service |
| `NODE_ENV` | `development` (`test` under Vitest) | `production` | `production` |
| `APP_ENV` | `development` | `staging` | `production` |
| Config from | `.env` / `.env.test` (gitignored) | Render dashboard + GitHub environment `staging` | Render dashboard + GitHub environment `production` |
| Swagger UI | `/api/docs` | off | off |
| Deployed by | — | CI, on every push to `main` | CI, after staging, with a required reviewer |

`NODE_ENV` says how the code runs and `APP_ENV` says where. Staging runs `NODE_ENV=production`, so it exercises exactly the production code paths; only its data and secrets differ. A deployed build must set `APP_ENV` to `staging` or `production`, or it refuses to start.

## Development (local PostgreSQL)

Any local PostgreSQL 15+ works.

1. Create the role and databases once, as the `postgres` superuser. The script asks for the superuser password, then for a new password for the `gear_dev` role:

   ```bash
   psql -U postgres -h localhost -f scripts/db/setup-local.sql
   ```

   On Windows, `psql` lives in the PostgreSQL `bin` folder, e.g. `"C:\Program Files\PostgreSQL\18\bin\psql.exe"`.

2. Copy `.env.example` to `.env` and `.env.test.example` to `.env.test`, replacing `CHANGE_ME` with the `gear_dev` password.
3. Apply migrations to the dev database and start the API:

   ```bash
   npm run db:generate
   npm run db:migrate
   npm run start:dev
   ```

- `npm run db:migrate` (`prisma migrate dev`) creates and applies migrations on the **dev** database. The `gear_dev` role has `CREATEDB` so Prisma can create its temporary shadow database.
- `npm run test:e2e` migrates the **test** database first, then runs the tests against it. Tests may wipe it, so the setup refuses any database whose name isn't `test` or doesn't end in `_test`.
- Without `.env.test`, tests that need Postgres are skipped. CI always runs them.

Seed data for development arrives with the phase 1 seed script.

## Staging and production

Set up once per stage. The names match `render.yaml` and the workflows.

**Neon** (one project, Frankfurt):
- Branch `main` for production and branch `staging` for staging.
- On each branch, two roles: a **migration** role that owns the schema, and an **app** role with read/write on tables but no DDL ([least privilege](security.md#also-important)).

**Render:** create both services from `render.yaml` (Blueprint). On each service, set `DATABASE_URL` to the app role's connection string for that stage. Keep auto-deploy off.

**GitHub:**
- Environments `staging` and `production`, each with secrets:
  - `MIGRATION_DATABASE_URL`: the migration role's URL for that stage;
  - `RENDER_DEPLOY_HOOK_URL`: that stage's Render deploy hook (a secret, see [public repositories](overview.md#no-leaks)).
- On `production`: a required reviewer, and deployments limited to the `main` branch.
- Repository variables `STAGING_DEPLOY_ENABLED=true` and, once production is set up, `PRODUCTION_DEPLOY_ENABLED=true`.

**Netlify (frontend repo):** a branch deploy for staging whose `/api/*` proxy points to the staging service; see the frontend's `docs/backend-migration.md`.

### Release flow

Push to `main` → CI passes → migrations + deploy to **staging** → (later: Playwright e2e against staging, ZAP baseline) → reviewer approves → migrations + deploy to **production**.

Migrations run against each stage from CI only, never from a laptop.

### Data in staging

Staging holds public game data plus **fake** users only. Never copy production user data into staging. Neon branching makes "reset staging from production" tempting; only do it before user accounts exist (phase 4), or after anonymising user tables.
