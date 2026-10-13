# Environments

Status: draft · Last updated: 2026-10-12 · Part of the [backend migration plan](overview.md)

Three stages. **Only the code is shared.** Each deployed stage has its own accounts or projects on every service, its own secrets and its own data, so a mistake in one stage can't reach the other.

| | Development | Staging | Production |
| --- | --- | --- | --- |
| Purpose | Local work | Test features and integrations on real infrastructure before going live | The live site |
| API | `npm run start:dev` on your machine | Render service `gear-optimizer-api-staging` in its own Render workspace (Frankfurt, free) | Render service `gear-optimizer-api` in its own Render workspace (Frankfurt, free) |
| Database | Local PostgreSQL: `gear_optimizer_dev` (+ `gear_optimizer_test` for tests) | Neon project `gear-optimizer-staging` | Neon project `gear-optimizer` |
| Frontend | Vite dev servers (public and admin apps), proxying `/api` to `localhost:3000` | Two Netlify sites, public and admin (deploy `main`), proxying `/api` to the staging service | Two Netlify sites, public and admin (deploy `deploy`), proxying `/api` to the production service |
| Images | Production's public ImageKit URLs (read-only) | ImageKit account for staging | ImageKit account for production |
| OAuth apps | Development apps (callback on `localhost`) | Staging apps (callback on the staging site) | Production apps |
| Users | Seeded fake users | Staff accounts of the staging app plus fake test users | Real users |
| `NODE_ENV` | `development` (`test` under Vitest) | `production` | `production` |
| `APP_ENV` | `development` | `staging` | `production` |
| Config from | `.env` / `.env.test` (gitignored) | Render dashboard + GitHub environment `staging` | Render dashboard + GitHub environment `production` |
| Swagger UI | `/api/docs` | off | off |
| Deployed by | — | CI, on every push to `main` | CI, on every push to `deploy` (a release), with a required reviewer |

`NODE_ENV` says how the code runs and `APP_ENV` says where. Staging runs `NODE_ENV=production`, so it exercises exactly the production code paths; only its data and secrets differ. A deployed build must set `APP_ENV` to `staging` or `production`, or it refuses to start.

Every developer works against a **local PostgreSQL and a local API**. Nobody develops against a hosted database.

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
- Without `.env.test`, tests that need Postgres are skipped. CI always runs them, against a Postgres service container.

Seed data for development arrives with the phase 1 seed script.

## Why staging shares nothing with production

Anything two stages share is a door between them. Examples of what goes wrong:

- **One Netlify site with a staging branch deploy:** both use the same site settings, build hooks and environment variables, separated only by "deploy context" rules. One wrong setting and a staging publish rebuilds production, or production builds against the staging API.
- **One Neon project with two branches:** both use the same free compute allowance, so heavy testing on staging can use up production's month. And "reset staging from production" is one click away, which copies real user data into a less protected place.
- **One ImageKit account:** a staging editor uploading `season-mns3.webp` would overwrite the image on the live site.
- **One OAuth app:** a leaked or misconfigured secret affects both stages, and staging logins would create identities that are valid in production too.
- **One Render workspace:** the free instance hours are shared, so a staging service left awake uses production's hours.

## Staging and production

Set up once per stage. The names match `render.yaml` and the workflows.

**Neon:** one project per stage, in Frankfurt. In each project, two roles: a **migration** role that owns the schema, and an **app** role with read/write on tables but no DDL ([least privilege](security.md#also-important)).

**Render:** one workspace per stage, each with one service. On each service, set `DATABASE_URL` to the app role's connection string, plus that stage's other secrets as they arrive (Netlify build hook URL, proxy signing secret, `SNAPSHOT_TOKEN_HASH`, session secret, OAuth secrets). Keep auto-deploy off. Suspend the staging service while nobody is testing, so it uses no hours.
- `render.yaml` still defines both services in one Blueprint. Split it into one Blueprint per stage when the workspaces are separated.

**Netlify (frontend repo):** two sites per stage, public and admin, so four in total. Each has its own `API_ORIGIN` and proxy signing secret; the public site also has the build hook that rebuilds the snapshot and the `SNAPSHOT_TOKEN` its build uses to read the API ([snapshot build token](security.md#snapshot-build-token)). Details: the frontend's `docs/backend-migration.md`.

**ImageKit:** one account per stage. The import tool uploads images to the stage it targets ([data import](data-import.md#images)).

**OAuth apps** (phase 3+): one set per stage, each with only that stage's callback URLs (admin site, and the public site from phase 4).

**GitHub:**
- Environments `staging` and `production`, each with secrets:
  - `MIGRATION_DATABASE_URL`: the migration role's URL for that stage;
  - `RENDER_DEPLOY_HOOK_URL`: that stage's Render deploy hook (a secret, see [public repositories](overview.md#no-leaks)).
- On `production`: a required reviewer, and deployments limited to the `deploy` branch.
- Repository variables `STAGING_DEPLOY_ENABLED=true` and, once production is set up, `PRODUCTION_DEPLOY_ENABLED=true`.

### Release flow

Two long-lived branches in both repos: **`main`** is where task work lands and what staging runs; **`deploy`** is what production runs.

1. Task PRs go into `main`. Merging one runs CI → migrations + deploy to **staging** (later: Playwright e2e against staging, ZAP baseline). Netlify's staging sites build `main`.
2. When staging looks right, open a PR from `main` into `deploy`. Its diff is the release notes. Merge it with a **merge commit**, never squash, so the two branches don't diverge.
3. The push to `deploy` runs CI → reviewer approves → migrations + deploy to **production**. Netlify's production sites build `deploy`.
4. The push to `deploy` also tags the released commit `vYYYY.MM.DD` (`.2`, `.3` for later releases that day) and creates a GitHub Release with notes generated from the merged PRs (`.github/workflows/release.yml`, in both repos). Versions name releases; they aren't semver. Release the API before the frontend: the frontend's CI compares its `openapi.json` with the API's on the same branch.
4. When a frontend change needs a new endpoint, release the API first.

Only PRs from `main` go into `deploy` (by convention; GitHub can't enforce the source branch). **Hotfix:** normally fix on `main` and release again. Only if `main` holds work that can't ship yet, branch from `deploy`, PR into `deploy`, then merge `deploy` back into `main`.

Dependabot targets `main` like any task PR, so updates reach production with the next release.

Migrations run against each stage from CI only, never from a laptop.

### Data and accounts in staging

- Staging holds public game data, its **own staff accounts** and **fake** test users. Never copy production user data into staging.
- Staff log in to staging with a real provider, through the staging OAuth apps. Staging's login stays **staff-only** permanently, on both sites: only accounts that already have `EDITOR` or `ADMIN` on staging can complete a login. The first staging admin is bootstrapped the same way as in production.
- Playwright logs in as a fake user whose session CI inserts directly into the staging database ([testing](testing.md)).
- Staging pages send `X-Robots-Tag: noindex` so search engines don't list them. There's no further access gate ([decision](overview.md#decisions-log)).

### Refreshing staging game data from production

Copy **game data only**, never a whole production database. A full copy would bring along:
- real users, identities, characters and wishlists;
- sessions (hashed, but still production logins);
- audit history and change sets pointing at production staff.

Copying all of that would move personal data into a less protected place, and would also wipe staging's own staff accounts.

How (a manual workflow in the private ops repo, run on demand):
1. Take the latest **game-data dump** that the weekly production backup job writes next to the full backup ([backups](security.md#also-important)). It holds only `expansion`, `season`, `season_instance`, `instance`, `raid_boss`, `item_source`, `item`, `character_class` and `spec`: public data, no personal data. So it doesn't need the offline backup key, and the refresh needs no production credentials. Load it with `pg_restore --data-only`.
2. In one transaction on staging: discard open drafts, empty those tables, load the data, bump `data_version`. Users, sessions, change-set history and the audit log stay as they were. Wishlists of fake users that point at items that no longer exist are deleted first, since `ON DELETE RESTRICT` would otherwise block the reload.
3. Copy images: anything referenced but missing in staging's ImageKit is copied over from production's (or re-uploaded by the import tool targeting staging). Otherwise staging shows broken images.
4. Trigger the staging snapshot rebuild.

Things to watch:
- **Schema versions.** Staging is often a migration or two ahead of production. Load into staging's current schema: a migration that adds a required column needs a default anyway, because it has to work on production's data too. A refresh is a cheap rehearsal of exactly that.
- **Drafts in progress** on staging are discarded by a refresh; finish them first if they matter.
- The refresh is an `audit_log` entry on staging, so it's clear when data changed underneath a test.
