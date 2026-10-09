# Security hardening

Status: draft · Last updated: 2026-10-09 · Part of the [backend migration plan](overview.md)

Most valuable data: **user accounts, linked identities, characters and wishlists**, and **editor/admin privileges** (whoever gets them can change what every visitor sees). The checklist below follows the **OWASP Top 10 (2025 edition)**. Check the official list, since category names shifted between editions. For a structured self-review, use **OWASP ASVS Level 1** as the checklist; it's the "what to verify" companion to the Top 10.

## OWASP Top 10 → this project

| # | Risk | What it means here | Controls |
| --- | --- | --- | --- |
| A01 | Broken Access Control | User A reads or edits user B's wishlist (IDOR); a user calls `/api/admin/*`; an editor changes roles | **Deny by default**: a global guard requires every route to declare `@Public()`, `@Authenticated()` or `@Roles(...)`. Queries are always scoped by `userId` from the session, never from the request. Another user's resource → **404** (don't confirm it exists). Only `ADMIN` changes roles; nobody changes their own. Authz matrix tests. |
| A02 | Security Misconfiguration | Swagger or stack traces in production, permissive CORS, missing headers | Swagger off in production. `helmet`. No CORS needed (same-origin through the proxy), so keep it **disabled**. Security headers on Netlify via `public/_headers`: **CSP**, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `frame-ancestors 'none'`. Separate secrets per environment. |
| A03 | Software Supply Chain Failures | A malicious or vulnerable npm package, a compromised GitHub Action (the `moongose` case is a mild example) | Commit lockfiles and use `npm ci`. **Dependabot** (npm + GitHub Actions). `npm audit --omit=dev --audit-level=high` in CI. Pin third-party Actions to a commit SHA. Review new dependencies before adding (`npm view`, weekly downloads, maintainers). Remove unused deps. |
| A04 | Cryptographic Failures | Leaked session IDs or tokens, plaintext secrets | HTTPS everywhere (Netlify, Render, Neon all enforce it). Session IDs from a CSPRNG, stored **hashed**. Battle.net tokens not persisted (or encrypted with a key from env). No secrets in the repo (gitleaks). |
| A05 | Injection | SQL injection, XSS through item names or user-entered names | Prisma parameterises queries. **Ban `$queryRawUnsafe` / `$executeRawUnsafe`** with an ESLint rule. React escapes output by default: ban `dangerouslySetInnerHTML` with a lint rule. Strict CSP as the second line of defence. Validate every DTO (`whitelist` + `forbidNonWhitelisted`). |
| A06 | Insecure Design | Missing limits, abuse of business flows | Rate limits (`@nestjs/throttler`): stricter on `/auth/*`, `/admin/imports`, wishlist writes. Size limits: request body (e.g. 100 KB; 5 MB only for import uploads), max wishlists per user, max items per wishlist. Imports can only create drafts, never publish. Import files are validated against the schema before anything is stored. Threat-model each new feature briefly in its PR ("who could abuse this?"). |
| A07 | Authentication Failures | Session fixation, account takeover via provider linking, stolen editor account | OAuth with `state` + **PKCE**. **Regenerate the session ID on login.** Idle timeout (e.g. 14 days for users, shorter for editors/admins), absolute lifetime. Logout deletes the server-side session. Linking a second provider is only possible **while logged in**, never by matching emails. **Editors/admins must have 2FA on their login provider.** Discord reports `mfa_enabled`, so you can enforce it for elevated roles. Role changes revoke that user's sessions. |
| A08 | Software or Data Integrity Failures | Unreviewed data reaching production, tampered builds | Change sets + review + audit log. CI deploys only from protected `main`. `prisma migrate deploy` only from CI. Third-party GitHub Actions pinned to a commit SHA. |
| A09 | Logging & Alerting Failures | Not noticing an attack or a broken publish | Structured logs (`nestjs-pino`) with request IDs. Log logins, failed authorisations (403s), role changes, publishes, imports, account deletions. **Never log** tokens, cookies, session IDs or full request bodies (pino `redact`). Sentry (free) for errors, a free uptime monitor for `/api/health`, alerts to the team. |
| A10 | Mishandling of Exceptional Conditions | Errors leaking internals; partial writes; failing open | Global exception filter: generic error body + request ID in production. Transactions for multi-step writes. Guards **fail closed**: if the session store or DB is unreachable, deny. |

## Also important

- **Public repositories:** the rules for keeping secrets, personal data and private material out of the public repos are in [overview.md](overview.md#public-repositories).

- **CSRF:** `SameSite=Lax` cookies + same-origin API. Additionally reject state-changing requests (`POST/PUT/PATCH/DELETE`) whose `Origin` header isn't your site.
- **GDPR / data protection:** data minimisation ([user data model](data-model.md#users-phase-3)), account deletion and export (phase 4). Define retention: delete sessions after expiry, purge soft-deleted users after 30 days (their personal data is deleted and the `app_user` row is anonymised, see [account deletion](data-model.md#users-phase-3)). Keep a short record of what personal data is stored where. Neon, Render and Netlify act as processors, so check each one's DPA.
- **Backups:** the Neon free tier has only short point-in-time restore. Add a weekly GitHub Actions `pg_dump` that's **encrypted** (e.g. with `age`) before it's stored, because it contains user data. Practise a restore once.
- **Least privilege:** the production DB user used by the app can't create or drop tables (migrations use a separate role from CI), and it can't change or bypass constraints, since only the table owner can. On `audit_log` it only has `INSERT` and `SELECT`, so entries can't be edited or deleted; the log's `payload` never holds personal data. GitHub Actions workflows declare minimal `permissions:`. Only the owner(s) have Render/Neon/Netlify admin access.

## Security tests & tools you can run (all free)

| What | Tool | When |
| --- | --- | --- |
| Authorization matrix + IDOR tests | Own tests ([testing](testing.md)) | Every PR. **The most valuable item on this list for protecting user data.** |
| Dependency vulnerabilities | `npm audit`, **Dependabot** alerts | Every PR + continuously |
| Secrets in code / history | **gitleaks** (CI + optional pre-commit hook), GitHub **secret scanning + push protection** (free for public repos) | Every PR / every push. Run gitleaks once over the full history of all repos now. |
| Static analysis (SAST) | **Semgrep** Community Edition (`p/typescript`, `p/nodejs`, `p/owasp-top-ten` rulesets); **CodeQL** (free for public repos; enable default setup) | Every PR |
| Lint-level security | `eslint-plugin-security`, plus custom bans (raw SQL, `dangerouslySetInnerHTML`) | Every PR |
| Dynamic scan (DAST) | **OWASP ZAP**: the *baseline* scan (passive) against staging on every deploy, the *API* scan fed with the committed `openapi.json`, and occasionally the *full* scan (active, staging only, **never production**) | After staging deploys / monthly |
| Headers & TLS | **Mozilla HTTP Observatory**, securityheaders.com | After header changes |
| CSP check | Google **CSP Evaluator** | After CSP changes |
| Manual review | **OWASP ASVS L1** checklist + the **OWASP Cheat Sheet Series** (Session Management, OAuth2, Authorization, Logging) | Once before phase 3 goes live, then yearly or on big changes |
| Rate limits | A short script or `autocannon` against staging: auth endpoints return 429 after the limit | Phase 3 |

**Rule of thumb:** before going live with accounts (end of phase 4), the full checklist above should pass on staging, and someone other than the author of the auth code (your partner) should review it against ASVS L1.
