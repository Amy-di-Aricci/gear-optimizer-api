# gear-optimizer-api

Backend API for **Where is my loot!?**, a community tool for World of Warcraft players that shows which items their character can get from the current season's dungeons and raids.

- Frontend: [gear-optimiser](https://github.com/Amy-di-Aricci/gear-optimiser) (React + Vite, deployed on Netlify)
- Running app: https://calm-kitten-ff2f2e.netlify.app/

Where is my loot!? is a **community fan project**. It is not affiliated with or endorsed by Blizzard Entertainment (see [Disclaimer](#disclaimer)).

## Status

Early development (phase 0: groundwork). The plan is in [`docs/`](docs/overview.md), starting with [docs/overview.md](docs/overview.md).

Stack: NestJS 11, Prisma 7, PostgreSQL (Neon), hosted on Render. Tests use Vitest + Supertest.

## Running locally

Requires Node.js 24 or later and a local PostgreSQL 15+. The three stages (development, staging, production) are described in [docs/environments.md](docs/environments.md).

```bash
npm install
psql -U postgres -h localhost -f scripts/db/setup-local.sql   # once: creates gear_optimizer_dev and gear_optimizer_test
cp .env.example .env                                           # then replace CHANGE_ME with the gear_dev password
cp .env.test.example .env.test                                 # same
npm run db:generate
npm run db:migrate
npm run start:dev
```

- Health check: http://localhost:3000/api/health
- Swagger UI (development only): http://localhost:3000/api/docs

The API boots without a database; only routes that query it need `DATABASE_URL`.

### Database

The schema lives in `prisma/schema.prisma`. After changing it:

```bash
npm run db:migrate -- --name <change>   # creates and applies a migration on the dev database
```

Staging and production migrations run only from CI (`prisma migrate deploy`).

### Tests and checks

```bash
npm test                # unit tests (src/**/*.spec.ts)
npm run test:e2e        # HTTP tests against the booted app (test/**/*.e2e-spec.ts)
npm run lint
npm run typecheck
npm run format:check
```

`npm run test:e2e` migrates the local test database (`.env.test`) first. Without `.env.test`, tests that need Postgres are skipped; CI always runs them.

### API contract

`openapi.json` is generated from the controllers and committed; the frontend generates its client from it. After changing the API:

```bash
npm run openapi:export
```

CI fails if the committed file is out of date.

## Deployment

Pushes to `main` run CI, then deploy to **staging** and, after a reviewer approves, to **production**. Each stage is off until its repository variable is set. See [docs/environments.md](docs/environments.md#staging-and-production) for the setup and [`render.yaml`](render.yaml) for the Render services.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Report security issues privately as described in [SECURITY.md](SECURITY.md).

## License

Copyright (C) 2026 Sajgonka

The **source code** in this repository is free software: you can redistribute it and/or modify it under the terms of the **GNU Affero General Public License, version 3** (AGPL-3.0-only), as published by the Free Software Foundation. See [LICENSE](LICENSE) for the full text.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more details.

The license covers this project's own code only. It does **not** cover any Blizzard Entertainment content: game data, item names, icons, artwork or trademarks (see below).

## Disclaimer

Where is my loot!? is an unofficial, non-commercial community project. It is **not affiliated with, endorsed, sponsored, or approved by Blizzard Entertainment, Inc.**

World of Warcraft, Warcraft and Blizzard Entertainment are trademarks or registered trademarks of Blizzard Entertainment, Inc. in the U.S. and/or other countries. All game content served by this API, including item names, game data and icon references, is the property of Blizzard Entertainment, Inc. and is used for informational, fan-community purposes only.
