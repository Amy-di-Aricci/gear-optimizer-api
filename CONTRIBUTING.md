# Contributing

Thanks for helping. Read [docs/overview.md](docs/overview.md) first: it covers the architecture, the phases and the rules for this public repository.

## License of contributions

By contributing you agree that your contribution is licensed under the project's license, **AGPL-3.0-only** (inbound = outbound). You keep the copyright on your own code.

## Workflow

1. Branch from `main` (`feature/…`, `fix/…`, `docs/…`).
2. Keep commits focused, with an imperative subject line ("Add health endpoint").
3. Open a pull request and fill in the template. CI must pass before merging; `main` is protected.
4. Use your GitHub **noreply** email for commits (`git config user.email <id>+<user>@users.noreply.github.com`).

## Before you push

```bash
npm run format
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run openapi:export   # if you changed the API; commit openapi.json
```

## Rules that are easy to miss

- **Never commit secrets** (database URLs, session secrets, OAuth secrets, deploy/build hook URLs), `.env` files, database dumps or real user data. Fixtures and seeds use public game data and fake users only. If a secret is pushed, rotate it immediately; rewriting history doesn't help.
- **Every route declares an access policy** (`@Public()`, and later `@Authenticated()` or `@Roles(...)`). The global guard denies routes without one, and the authorization matrix test (`test/authorization-matrix.e2e-spec.ts`) fails until the route is listed there.
- **No `$queryRawUnsafe` / `$executeRawUnsafe`.** ESLint bans them.
- Scraping code and pre-release data sources don't belong here; this repo only defines the import file format.
- Issues and PRs in English.

See [docs/security.md](docs/security.md) and [docs/testing.md](docs/testing.md) for the full checklists.
