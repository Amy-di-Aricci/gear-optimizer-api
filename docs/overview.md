# Backend migration plan: overview

Status: draft · Last updated: 2026-10-09

This is the entry point. Cross-repo decisions, phases and the decisions log live **only here**; the other documents hold the details for one area.

| Document | Repo | Contents |
| --- | --- | --- |
| [overview.md](overview.md) | API | Goals, architecture, OpenAPI decision, repos & team, public-repo rules, phases, decisions log |
| [data-model.md](data-model.md) | API | PostgreSQL schema: game data, publishing, users, BIS |
| [api.md](api.md) | API | Endpoints, CDN caching & cold starts, auth |
| [environments.md](environments.md) | API | Development (local Postgres), staging and production: config, databases, release flow |
| [data-import.md](data-import.md) | API | Import file format, upload flow, optional Blizzard API import |
| [security.md](security.md) | API (applies to all repos) | OWASP Top 10 mapping, hardening, security tools |
| [testing.md](testing.md) | API | API testing strategy, CI gates for all repos |
| `docs/backend-migration.md` | Frontend (`gear-optimiser`) | Data fetching & freshness, admin panel, staging, frontend tests |

## Goals

- Move game data (items, loot sources, dungeons, raids, seasons, expansions, specs) out of the frontend bundle into a database, so content can be updated **without a frontend deploy**.
- A small trusted team (≈3 people) maintains data through an admin panel, with a **draft → review → publish** flow.
- Data enters through **import files** uploaded in the admin panel (produced by a separate, private tool), an optional **Blizzard API import** for retail data, and manual edits.
- Older seasons stay browsable.
- Later: user accounts (Battle.net / Discord / Google), private per-season wishlists, and BIS lists aggregated from wishlists.
- **€0 running cost at the start**, EU-hosted, scalable later by upgrading plans rather than rewriting.
- **Public repositories** (frontend and API) that are tidy and leak nothing (see [Public repositories](#public-repositories)).

## Architecture overview

```
 Browser ──► Netlify (React SPA, existing)
               │  /api/*  ──proxy──►  Render (NestJS API, Frankfurt, free tier)
               │                          │
               │                          ├──► Neon Postgres (Frankfurt, free tier)
               │                          └──► Blizzard Game Data API (optional retail import)
               └─ item icons ──► ImageKit (existing)

 Private tool (separate private repo, run locally) ──► import JSON file ──► uploaded by an editor in the admin panel
```

| Concern | Choice | Why |
| --- | --- | --- |
| API framework | **NestJS** (TypeScript) | Same language as the frontend; structure (modules, guards, DI) suits auth + roles + admin; first-class OpenAPI. |
| Database | **PostgreSQL on Neon** (free, EU region) | Plain Postgres (no lock-in), scale-to-zero, branching useful for testing migrations. Supabase free pauses projects after a week of inactivity, which is a poor fit for a low-traffic app. |
| ORM / migrations | **Prisma** | Best DX for schema + migrations + typed queries. (Drizzle is a fine alternative if you prefer SQL-like code.) |
| API hosting | **Render** free web service (Frankfurt) | Free, deploys from GitHub, sleeps after ~15 min idle (cold start accepted). Upgrade path: paid always-on instance. |
| Frontend hosting | **Netlify** (keep) | Remove the unused GitHub Pages workflow (`.github/workflows/deploy.yml`) and the `gh-pages` branch. |
| API calls from the SPA | Netlify **proxy rewrite** `/api/* → Render` | The API looks same-origin to the browser, so you get first-party cookies (no Safari or third-party-cookie problems), no CORS, and no custom domain needed. |
| Type sharing | **OpenAPI codegen** from a committed `openapi.json` | See [OpenAPI decision](#openapi-exposure-and-access-control). |
| Data import | **Import file upload** in the admin panel; schema committed in the API repo | See [data-import.md](data-import.md). |
| Public data caching | Netlify CDN cache + purge on publish; static snapshot as fallback | See [caching](api.md#caching--cold-starts). |
| Scheduled jobs | **GitHub Actions cron** | Free. The API sleeps, so in-process cron (`@nestjs/schedule`) won't fire reliably. |

> Free-tier limits change often. Re-check Neon, Render and Netlify limits before you sign up.

## OpenAPI: exposure and access control

- **The spec isn't served at runtime.** Swagger UI at `/api/docs` is enabled **in development only** (`NODE_ENV !== 'production'`). A script (`npm run openapi:export`) boots the app without listening and writes `openapi.json`, which is **committed** to the API repo. CI checks it's up to date, and the frontend generates its client from that file.
- **The repo is public, so the spec is public anyway.** Anyone can read the controllers, and anyone can watch the network tab. That's fine: the design never relies on hiding endpoints. Not serving Swagger in production just keeps the production surface small.
- **Can a client ID or secret protect the API?** Not from a browser app. Anything shipped to the SPA (keys, secrets, the generated client) is readable in DevTools. Security comes from:
  - auth plus role guards on every non-public endpoint,
  - rate limiting,
  - validation,
  - public endpoints that only return data that's public anyway.
- **Real secrets stay server-side.** Database URL, session secret, OAuth client secrets and Blizzard API credentials live only in Render/Netlify/GitHub settings.

## Repositories & CI

| Repo | Visibility | Contents |
| --- | --- | --- |
| `gear-optimiser` | **Public** | React frontend, including the admin panel. Adds `npm run gen:api` (e.g. `@hey-api/openapi-ts` or `orval`); the generated client is committed, so builds don't depend on the backend being up. |
| `gear-optimizer-api` | **Public** | NestJS + Prisma. CI runs lint, tests (Postgres in a GitHub Actions service container), contract checks (`openapi.json`, import schema), then `prisma migrate deploy` and deploys to Render. |
| `gear-optimiser-scrapper` | **Private** | Standalone scripts for pre-release data sources. Outputs import files that validate against the API's import schema. It never talks to the API. Its own plan lives in that repo (`docs/plan.md`). |

- **Contract change workflow:** change the backend DTO → `openapi:export` → commit `openapi.json` → copy it into the frontend (manually at first, later through a bot PR) → `gen:api` → TypeScript errors point out everything that needs updating.
- **Import format changes:** change the import DTO → regenerate `schemas/import/v1.schema.json` → the private repo copies the new schema from a pinned commit or tag.

### Team & access

Three people: you (owner), your partner (code + editor), and a third person (editor now, possible future maintainer).

- **Repos stay on your personal GitHub account**, with the others as **collaborators**. A GitHub organization remains an option later if ownership needs to be shared or handed over.
- **Service accounts** (Neon, Render, Netlify, ImageKit, OAuth apps): keep a short list of who has access to what, and keep the credentials in a password manager. Make sure at least one other person could recover access in an emergency.
- **Branch protection on `main`** in both public repos: changes go through PRs, and CI must pass. Each developer uses their own Neon dev branch via a local `.env`.
- **Onboarding docs** in each repo's README: local setup, how to run migrations and seed data, how to export the spec and regenerate clients, how to deploy. For the future maintainer, the [decisions log](#decisions-log) records *why* things are the way they are; add a row for every cross-repo decision.
- App roles are independent of repo access: the third person gets `EDITOR` in the app without needing GitHub access.

## Public repositories

Both the frontend and the API repo are public. Two goals: **nothing sensitive is ever committed**, and **the codebase is tidy enough for a stranger to read**.

### No leaks

**What counts as secret here.** None of these may appear in code, history, issues, PRs or CI logs:
- the database URL,
- the session secret,
- OAuth client secrets (Battle.net, Discord, Google),
- Blizzard API credentials,
- the ImageKit private key (the public URL endpoint is fine),
- the Render deploy hook URL,
- the Netlify build hook URL and purge token,
- backup encryption keys.

Hook URLs count as secrets: anyone who has one can trigger deploys.

**Prevention:**
- `.env` is gitignored, and a `.env.example` with placeholder values is committed.
- Enable GitHub **secret scanning + push protection** (free for public repos). Push protection blocks a push that contains a recognised secret.
- **gitleaks** runs in CI on every PR, and optionally as a pre-commit hook.
- Before a repo goes public (or now, if it already is), run gitleaks over the **full history**.

**If a secret ever gets pushed, rotate it immediately.** Rewriting history doesn't help once a public repo has been fetched or cloned.

**Personal data:**
- No real user data anywhere in the repos: seeds, fixtures and tests use fake users only.
- Never commit database dumps (gitignore `*.sql`, `*.dump`, `backups/`).
- Don't paste production logs or screenshots with user data into issues or PRs.

**Commit identities:** every commit exposes its author email.
- Everyone sets `git config user.email` to their GitHub **noreply** address and enables *"Block command line pushes that expose my email"* in GitHub settings.
- The frontend history already contains personal email addresses (yours and another contributor's). If that matters to you, rewriting history (`git filter-repo --mailmap`) only helps if nobody else has cloned the repo yet. Otherwise, apply the noreply rule from now on.

**Private material stays private:**
- Scraping code, PTR-source notes and raw scraped dumps live only in the private scraper repo.
- Public docs describe only the import file format.

**CI on public repos:**
- Pull requests from forks don't receive secrets. Keep it that way: never combine `pull_request_target` with a checkout of PR code.
- Require approval before workflows run for first-time contributors (repo setting).
- Deploy jobs run only on pushes to `main`.
- Every workflow declares minimal `permissions:`.
- Third-party actions are pinned to a commit SHA.

### License

- **AGPL-3.0-only**, copyright holder **Sajgonka** (`Copyright (C) 2026 Sajgonka`). Revisit the holder line (e.g. "Sajgonka and contributors") once others contribute significantly.
- **Scope:** the license covers this project's own code and original assets (e.g. the handmade stat icons). It does **not** cover Blizzard Entertainment content (game data, item names, icons, artwork, trademarks). README files state this, together with a disclaimer that this is an unofficial community project, not affiliated with or endorsed by Blizzard.
- **Contributions** are accepted under the same license (inbound = outbound); state this in `CONTRIBUTING.md`. Contributors keep the copyright on their own code, so relicensing later needs their agreement.
- **Network clause (section 13):** users who interact with the running app must be offered its source. The app gets a footer link to the public repositories (see the frontend doc). If you ever deploy changes that aren't pushed to the public repos, that obligation is no longer met.
- **Dependencies:** AGPL is compatible with the permissive licenses used here (MIT, Apache-2.0, BSD, ISC). Avoid adding code under licenses incompatible with AGPL.

### Tidy codebase

- **Required files:**
  - `README.md`: what it is, how to run it, how to contribute, the license notice and the Blizzard disclaimer (done for both public repos).
  - `LICENSE`: **AGPL-3.0-only** in both public repos (done). See [License](#license).
  - `SECURITY.md`: how to report a vulnerability. Also enable GitHub *private vulnerability reporting*.
  - `CONTRIBUTING.md`: branching, commit style, how to run tests.
- **PR template** with a checklist: tests added or updated, docs updated, no secrets or personal data, decisions log updated if a cross-repo decision changed.
- **Prettier + ESLint enforced in CI.** No committed build output (`dist/`), no stray experiment files, no commented-out dead code.
- **Dependabot** enabled, and unused dependencies removed.
- **Branch hygiene:** delete merged branches (the frontend has a dozen old ones), including the `gh-pages` branch with old built bundles. Enable *"Automatically delete head branches"*.
- **Issues and PRs** stay in English, with no internal-only links.

## Phases

Each phase ships something usable on its own. You can stop after any of them.

### Phase 0 — Groundwork
- **Public repo hygiene:**
  - full-history gitleaks scan of both public repos,
  - secret scanning + push protection,
  - noreply commit emails for all contributors,
  - `SECURITY.md`, `CONTRIBUTING.md`, PR template (`LICENSE` and README notices done),
  - app footer with the Blizzard disclaimer and a source-code link (AGPL),
  - `.env.example`,
  - delete the `gh-pages` branch and merged branches,
  - remove the GitHub Pages workflow and fix the README.
- Scraper: `git init`, housekeeping, push to a **private** repo (see its `docs/plan.md`).
- Create Neon (Frankfurt) and Render accounts. Register OAuth apps later, in phase 3.
- Finish the `gear-optimizer-api` scaffold (NestJS app already generated): add Prisma, health endpoint, Swagger in dev, CI, deployed to Render, Netlify `/api` proxy working.
- Three stages ([environments.md](environments.md)): local Postgres for development, staging (Render + Neon branch) and production, with CI deploying `main` to staging, then to production after approval.
- Testing & security baseline in CI for both public repos: Vitest set up, lint + typecheck, `npm audit`, gitleaks, Semgrep, CodeQL, Dependabot, branch protection.
- **Done when:** `https://<site>.netlify.app/api/health` returns OK.

### Phase 1 — Read-only data API
- Prisma schema for [game data model](data-model.md#game-data). Seed script that imports today's `gear-store.json`, `manual_items.ts`, `globals/*.ts` (one-off migration). Verify counts match: ~900 items.
- Public endpoints ([API outline](api.md#api-outline)), `data_version`, CDN caching ([caching](api.md#caching--cold-starts), options A + D), including a spike to confirm Netlify caches proxied responses.
- Frontend switches to the generated client + TanStack Query + persisted cache. Remove the bundled data and content enums.
- Tests: integration tests for the public endpoints; frontend filter-logic tests with MSW; the global deny-by-default guard and the first version of the authz matrix (everything public so far, but new routes must declare a policy).
- Security headers + CSP on Netlify (`_headers`).
- **Done when:** the live site shows identical results, and adding a season or dungeon is a DB change (via seed/SQL for now) with no frontend deploy.

### Phase 2 — Import file format
- Import DTOs + generated JSON Schema (`schemas/import/v1.schema.json`), validation and the diff engine ([data-import.md](data-import.md)). For now, a CLI script in the API repo runs file → diff report against the database (no change sets yet).
- Private scraper repo: scripts rewritten around journal instance IDs, with output validated against the schema (tracked in that repo).
- Re-check the current season (imported during PTR) against retail data and fix the differences.
- **Done when:** a season's data can be produced as one import file that validates, and the diff report matches reality.

### Phase 3 — Auth, roles, admin panel
- OAuth (Discord, Google, Battle.net), sessions, `/api/me`, roles + guards, admin bootstrap, audit log.
- Change sets: an editor **uploads an import file in the admin panel**, the UI shows the diff, an editor publishes. Manual edits to items, seasons and instances go through change sets too.
- Admin: user list + role management.
- Privacy policy page.
- Netlify branch deploy for staging (the API side exists since phase 0). ZAP baseline scan after staging deploys. Playwright e2e for the upload → publish flow.
- Tests: publish transaction, frozen-season rejection, import validation errors, authz matrix covering editor/admin, session tests (regeneration on login, revocation on role change), rate-limit check.
- **Done when:** an editor can upload a new season's import file and publish it from the browser, with no code changes or deploys.

### Phase 4 — User features
- Battle.net character import (character list + active spec).
- Wishlists per season, per spec or character. Archive them at season end, with a manual admin action or a cron.
- Account deletion + data export, retention jobs, encrypted backups.
- Tests: IDOR tests (user B can't see or modify user A's wishlists or characters → 404), deletion cascade, export contents.
- **Security gate before public launch of accounts:** ASVS L1 review, ZAP API + full scan on staging, Observatory grade checked, logging/alerting confirmed.
- **Done when:** a user can log in, create a wishlist for their character, and find it again next week.

### Phase 5 — Optional extras (later, not prioritised)
- **Blizzard API import from the admin panel** ([data-import.md](data-import.md#blizzard-api-import-optional-later)): background job, same diff → change set path.
- **BIS lists & popularity:** aggregation job, threshold N (configurable), BIS pages per spec with sample sizes.

### Later / scaling triggers
| Trigger | Action |
| --- | --- |
| Cold starts still noticeable on public pages | Switch to the static snapshot ([caching](api.md#caching--cold-starts), option B) |
| Cold starts annoy logged-in users | Render paid instance (~$7/mo) |
| Neon storage/compute limits | Neon paid tier; data is tiny, so this is unlikely to happen soon |
| Need nicer URLs / own brand | Custom domain (~€10/yr): `app.` on Netlify, `api.` on Render |
| Need observability | Sentry free tier (frontend + API), Render logs |
| Ownership needs to be shared or handed over | Move repos and service accounts into a GitHub organization |

## Decisions log

| Date | Decision |
| --- | --- |
| 2026-10-08 | NestJS + Prisma on Render, Postgres on Neon (Frankfurt), frontend stays on Netlify with an `/api` proxy. |
| 2026-10-08 | Separate API repo; types shared via OpenAPI codegen from a committed `openapi.json`; Swagger isn't served in production. |
| 2026-10-08 | Cold starts accepted for the API; public game data cached on the CDN ([caching](api.md#caching--cold-starts)). |
| 2026-10-08 | Draft → review → publish for all game-data changes; roles `USER` / `EDITOR` / `ADMIN`. |
| 2026-10-08 | Login via Battle.net, Discord, Google; one account can link several. |
| 2026-10-08 | Wishlists are private, per season, flat sets of items (no per-slot limits or ranking); archived at season end. |
| 2026-10-08 | Past seasons are frozen (read-only). |
| 2026-10-08 | Frontend freshness driven by `data_version` (`/api/meta`); only public data persisted in `localStorage`. |
| 2026-10-08 | Tests: Vitest + real-Postgres integration tests + generated authorization matrix; Playwright for critical flows. |
| 2026-10-08 | Security baseline: OWASP Top 10 mapping ([security](security.md)), deny-by-default authorization, ASVS L1 review before accounts go live. |
| 2026-10-08 | BIS lists postponed; threshold of 20 distinct users per spec per season when built. |
| 2026-10-08 | Frontend and API repos are public; the scraper stays a separate **private** repo. The API only accepts import files (schema committed in the API repo) uploaded by editors; no service token. |
| 2026-10-08 | Blizzard API import from the admin panel is an optional later feature. |
| 2026-10-08 | Repos stay on the owner's personal account with collaborators; no GitHub organization for now. |
| 2026-10-08 | License: AGPL-3.0-only for both public repos, © Sajgonka; covers code and original assets, not Blizzard content. Community-project disclaimer in READMEs and in the app footer. |
| 2026-10-09 | Three stages: development (local PostgreSQL), staging and production (each its own Render service and Neon branch). Staging moved forward from phase 3 to phase 0. `APP_ENV` names the stage; staging runs `NODE_ENV=production`. |
| 2026-10-09 | Schema hardening ([data model](data-model.md)): each item has exactly one drop source (`item.source_id` → `item_source`, which is either a dungeon or a raid boss); `encounter` renamed `raid_boss` (raids only); import items carry a single `source` instead of a `sources` list. Composite foreign keys tie a character's spec to its class and a wishlist's character to the same user. Item variants stay in one table, enforced by `CHECK` constraints; enum lists stay as array columns. Slot enum adds `TWOHAND`; one-handed weapons are always `MAINHAND`, and `OFFHAND` means shields and held items only. |
| 2026-10-09 | Consistency rules ([data model](data-model.md)): exactly one current season, never frozen; codes and Blizzard IDs unique; characters keyed by Blizzard character ID and tied to the Battle.net identity they came from; a user may link several identities per provider. Change sets record who resolved them and their `base_version`; publishing an outdated draft raises git-like per-entry conflicts. Change-set entries use natural keys (`entity_key jsonb`). Deleting a wishlisted item is blocked. Users are never hard-deleted (anonymised tombstone); `user` table renamed `app_user`. `audit_log` is append-only. |
| 2026-10-09 | Character sync stores all characters with their level; the character list shows only characters at the current expansion's `max_level`. Syncing never creates wishlists; users create them (several per character allowed). A wishlist `purpose` (raid / M+ / PvP) may be added later, at a season change. |

## Open questions

- Revisit [caching](api.md#caching--cold-starts) (option A vs B) after the Phase 1 caching spike.
