# gear-optimizer-api

NestJS backend for the gear optimiser (frontend: `gear-optimiser` repo, React + Vite on Netlify). **This repository is public.**

## Plan & docs

The backend migration plan lives in `docs/`. Read `docs/overview.md` first: it holds goals, architecture, phases, the public-repo rules and the decisions log, and indexes the rest.

- `docs/data-model.md`: PostgreSQL schema
- `docs/api.md`: endpoints, CDN caching, auth
- `docs/environments.md`: development (local Postgres), staging, production
- `docs/data-import.md`: import file format, upload flow, optional Blizzard API import
- `docs/security.md`: OWASP-based hardening; applies to every change
- `docs/testing.md`: testing strategy and CI gates

Cross-repo decisions are recorded only in the decisions log in `docs/overview.md`. When a decision changes, update the log and the affected doc together.

## Rules that are easy to miss

- Public repo: never commit secrets, hook URLs, `.env` files, database dumps or real user data. Fixtures and seeds use public game data and fake users only.
- Scraping code and notes about pre-release data sources belong in the private scraper repo, not here. This repo only defines and validates the import file format.
- Every route must declare an access policy (`@Public()`, `@Authenticated()` or `@Roles(...)`); the global guard denies by default and the authorization-matrix test fails otherwise.
- User-owned data is always scoped by the session's user ID; another user's resource returns 404.
- Game data changes only through change sets (draft → publish), never by writing live tables directly.
- No `$queryRawUnsafe` / `$executeRawUnsafe`. No Swagger UI in production; `openapi.json` and `schemas/import/*.schema.json` are generated and committed, and CI checks they're current.
