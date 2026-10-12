# Security hardening

Status: draft · Last updated: 2026-10-09 · Part of the [backend migration plan](overview.md)

Most valuable data: **user accounts, linked identities, characters and wishlists**, and **editor/admin privileges** (whoever gets them can change what every visitor sees). The checklist below follows the **OWASP Top 10 (2025 edition)**. Check the official list, since category names shifted between editions. For a structured self-review, use **OWASP ASVS Level 1** as the checklist; it's the "what to verify" companion to the Top 10.

## OWASP Top 10 → this project

| # | Risk | What it means here | Controls |
| --- | --- | --- | --- |
| A01 | Broken Access Control | User A reads or edits user B's wishlist (IDOR); a user calls `/api/admin/*`; an editor changes roles | **Deny by default**: a global guard requires every route to declare `@Public()`, `@Authenticated()` or `@Roles(...)`. Queries are always scoped by `userId` from the session, never from the request. Another user's resource → **404** (don't confirm it exists), and so is any `/api/admin/*` route for someone without the role. Only `ADMIN` changes roles; nobody changes their own. Authz matrix tests. |
| A02 | Security Misconfiguration | Swagger or stack traces in production, permissive CORS, missing headers, a staging setting leaking into production | Swagger off in production. `helmet`. No CORS needed (same-origin through the proxy), so keep it **disabled**. Security headers on Netlify via `public/_headers`: **CSP** (allowed origins in the frontend's `docs/backend-migration.md`), `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `frame-ancestors 'none'`. Stages share nothing but code ([environments](environments.md)). |
| A03 | Software Supply Chain Failures | A malicious or vulnerable npm package, a compromised GitHub Action (the `moongose` case is a mild example) | Commit lockfiles and use `npm ci`. **Dependabot** (npm + GitHub Actions). `npm audit --omit=dev --audit-level=high` in CI. Pin third-party Actions to a commit SHA. Review new dependencies before adding (`npm view`, weekly downloads, maintainers). Remove unused deps. |
| A04 | Cryptographic Failures | Leaked session IDs or tokens, plaintext secrets | HTTPS everywhere (Netlify, Render, Neon all enforce it). Session IDs from a CSPRNG, stored **hashed**. Battle.net tokens not persisted (or encrypted with a key from env). No secrets in the repo (gitleaks). |
| A05 | Injection | SQL injection, XSS through item names or user-entered names | Prisma parameterises queries. **Ban `$queryRawUnsafe` / `$executeRawUnsafe`** with an ESLint rule. React escapes output by default: ban `dangerouslySetInnerHTML` with a lint rule. Strict CSP as the second line of defence. Validate every DTO (`whitelist` + `forbidNonWhitelisted`). |
| A06 | Insecure Design | Missing limits, abuse of business flows | Rate limits (`@nestjs/throttler`), counted per real client IP ([trusted proxy](#trusted-proxy)): stricter on `/auth/*`, `/admin/imports`, wishlist writes. Size limits: request body (e.g. 100 KB; 5 MB only for import uploads), max wishlists per user, max items per wishlist. Imports can only create drafts, never publish. Import files are validated against the schema before anything is stored. Threat-model each new feature briefly in its PR ("who could abuse this?"). |
| A07 | Authentication Failures | Session fixation, account takeover via provider linking, stolen editor account | Until phase 4, only staff can log in at all ([login rollout](api.md#login-rollout)). OAuth with `state` + **PKCE**. **Regenerate the session ID on login.** Idle timeout (e.g. 14 days for users, shorter for editors/admins), absolute lifetime. Logout deletes the server-side session. Linking a second provider is only possible **while logged in**, never by matching emails. **Editors/admins must have 2FA on their login provider.** Discord reports `mfa_enabled`, so you can enforce it for elevated roles. Role changes revoke that user's sessions. |
| A08 | Software or Data Integrity Failures | Unreviewed data reaching production, tampered builds | Change sets + review + audit log. CI deploys only from protected `main`. `prisma migrate deploy` only from CI. Third-party GitHub Actions pinned to a commit SHA. |
| A09 | Logging & Alerting Failures | Not noticing an attack or a broken publish | Structured logs (`nestjs-pino`) with request IDs. Log logins, failed authorisations (403s), role changes, publishes, imports, account deletions. **Never log** tokens, cookies, session IDs or full request bodies (pino `redact`). Sentry (free) for errors, a free uptime monitor for `/api/health`, alerts to the team. |
| A10 | Mishandling of Exceptional Conditions | Errors leaking internals; partial writes; failing open | Global exception filter: generic error body + request ID in production. Transactions for multi-step writes. Guards **fail closed**: if the session store or DB is unreachable, deny. |

## Trusted proxy

The browser reaches the API only through the Netlify proxy (`/api/*`), but the Render service is also reachable directly at `*.onrender.com`.

**Why it matters:** rate limits count requests per client IP address. Behind a proxy, every request arrives from Netlify's address, so the API would treat all visitors as one. The real address comes in a header the proxy adds, but anyone calling Render directly can write any address into that header and dodge the limits. Direct calls also skip the security headers set on Netlify.

**Rule:** the API accepts a request only if it can prove it came through one of the stage's Netlify sites (public or admin), and only then reads the client IP from Netlify's header.
- **Mechanism: Netlify signed proxy redirects** (checked against Netlify's docs on 2026-10-09).
  - A proxy rule with `signed = "API_SIGNATURE_TOKEN"` makes Netlify add an `x-nf-sign` header to every proxied request: a JWS (HMAC HS256) signed with the secret held in that environment variable. The variable lives in the site's settings, never in the repo, and its scope must include **Runtime**.
  - The signed payload contains `deploy_context`, `exp` (expiry), `iss: "netlify"`, `netlify_id` (the site ID) and `site_url`. The API verifies the signature and expiry, and maps `netlify_id` to "public site" or "admin site" from its own configuration. Anything else gets a 404.
  - Signing works only for proxies to non-Netlify targets, which Render is.
- **Each site has its own signing secret**, on top of the site ID in the payload, so the API knows which site a request came through. That's how it keeps admin routes and admin sessions to the admin site ([sessions](api.md#mechanics)).
- **Catch: per-site targets.** Signed rules must be in `netlify.toml` (not `_redirects`), Netlify doesn't substitute environment variables into its redirect rules, and redirect rules can't vary by deploy context. Each of the four sites needs a different target (its stage's API). Plan: a small **local build plugin** in the frontend repo adds the `/api/*` rule in `onPreBuild` through `netlifyConfig.redirects`, reading the target from the site's `API_ORIGIN` variable and setting `signed`. Netlify documents that plugins can change redirects this way.
- **Still to confirm in the phase 1 spike:**
  - that a plugin-added rule keeps `signed`, with a test deploy against a tiny echo endpoint;
  - which header carries the client IP to the API (Netlify's docs don't say; expected `x-nf-client-connection-ip` and `X-Forwarded-For`), and that the signed request can't be given a different one;
  - the 26-second proxy timeout, against Render cold starts.
  
  Fallback if the plugin route fails: one committed `netlify.toml` per site, in separate base directories. The Render hostnames aren't secrets.
- `GET /api/health` stays reachable directly, for Render's health check.
- Public pages read the [static snapshot](api.md#public-data-delivery-static-snapshot) and don't touch the API, so this protects login, admin and user routes, which is where rate limits matter.

## Third-party scripts

Checked on the live site on 2026-10-09: Wowhead's tooltip script (`wow.zamimg.com/js/tooltips.js`) set **no cookies** and wrote nothing to `localStorage` or `sessionStorage`. It loaded no analytics or ad scripts and created no iframes. Its code has a cookie helper, but the tooltip flow doesn't call it. When a visitor hovers an item, it fetches tooltip data from `nether.wowhead.com`, so Wowhead receives the visitor's IP address and the page address (the referrer).

- **Keep the tooltips for now.** List Wowhead as a third party in the privacy policy, and set `Referrer-Policy: strict-origin-when-cross-origin` so only the site's origin is sent.
- **The admin UI is a separate site, with separate sessions.** A third-party script runs with the page's full rights: on a page where a staff member is logged in, it could call `/api/admin/*` with their session. So the admin UI lives on its own Netlify site (its own address) that loads no third-party scripts. Its session cookie is never sent from public pages, and the API accepts admin routes only with an admin-site session coming through the admin site. A staff member browsing the public pages, logged in or not, gives those pages no admin powers.
- Wowhead can change the script at any time. Re-check it before public accounts go live (phase 4), and replace it with self-made tooltips if it starts tracking.
- Fonts are self-hosted, so no requests go to Google.

## Also important

- **Public repositories:** the rules for keeping secrets, personal data and private material out of the public repos are in [overview.md](overview.md#public-repositories).

- **CSRF:** `SameSite=Lax` cookies + same-origin API. Additionally reject state-changing requests (`POST/PUT/PATCH/DELETE`) whose `Origin` header isn't your site.
- **GDPR / data protection:** see [privacy and legal](api.md#privacy-and-legal-before-public-accounts). Retention: delete sessions after expiry, purge soft-deleted users after 30 days (their personal data is deleted and the `app_user` row is anonymised, see [account deletion](data-model.md#users-phase-3)). Both run as [scheduled jobs](api.md#scheduled-jobs) inside the API.
- **Backups:** the Neon free tier has only short point-in-time restore. A weekly `pg_dump` per stage runs from a separate **private** repository (`gear-optimizer-ops`), is **encrypted** with `age` before it's stored, and is kept as a workflow artifact with 90-day retention. Artifacts of a public repository can be downloaded by any GitHub user, so backups never run in the public repos. The decryption key lives only in the team's password manager. Practise a restore once. The production job also writes a separate **game-data-only** dump (public data, no user tables), used to [refresh staging](environments.md#refreshing-staging-game-data-from-production).
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
| Manual review | **OWASP ASVS L1** checklist + the **OWASP Cheat Sheet Series** (Session Management, OAuth2, Authorization, Logging) | The login and admin parts before staff use production (phase 3); the full checklist before public accounts (phase 4); then yearly or on big changes |
| Rate limits | A short script or `autocannon` against staging: auth endpoints return 429 after the limit | Phase 3 |

**Rule of thumb:** before going live with accounts (end of phase 4), the full checklist above should pass on staging, and someone other than the author of the auth code (your partner) should review it against ASVS L1.
