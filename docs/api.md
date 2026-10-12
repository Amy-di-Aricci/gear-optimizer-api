# API

Status: draft · Last updated: 2026-10-12 · Part of the [backend migration plan](overview.md)

## API outline

Public (no auth). Visitors don't call these directly: they read the [static snapshot](#public-data-delivery-static-snapshot). The snapshot build, the admin panel and local development do.
- `GET /api/meta`: current `data_version`, current season code
- `GET /api/expansions`, `GET /api/seasons`
- `GET /api/seasons/:code`: season with its instances and raid bosses
- `GET /api/seasons/:code/items`: **all items for the season in one response** (a few hundred rows, tens of KB gzipped). The frontend keeps filtering on the client: it's instant for the user.
- `GET /api/specs`: classes and specs

### Item response shape

Items keep the shape of today's `gear-store.json`, so the frontend's filtering and display code keeps working with minimal changes:

```jsonc
{
  "itemId": 268283,
  "name": "Festerbloom Crown",
  "imgId": "inv_helm_leather_raiddruidmidnight_d_01",
  "slot": "HEAD",
  "armorType": "LEATHER",             // or weaponType / offhandType, depending on the slot
  "mainStats": ["INT"],               // weapons, trinkets and off-hands that have them
  "secondaryStats": ["CRIT", "HASTE"],
  "roles": ["DPS_RANGED"],            // trinkets only
  "specialEffect": null,
  "lootSource": { "raid": "TVA", "bossName": "ROTMIRE" }   // or a dungeon code: "FLOOD"
}
```

Fields that don't apply to the item's slot are left out, as today. `lootSource` is built from `item_source` using instance and raid boss codes. The OpenAPI spec models the item as a union per slot group, like the frontend's `TWowItem`.

Auth: `GET /api/auth/{provider}` → provider → `GET /api/auth/{provider}/callback`, `POST /api/auth/logout`, `GET /api/me`. Providers arrive in two steps, see [login rollout](#login-rollout).

User (session required, phase 4): `/api/me/characters` (max-level characters only; `POST /sync` for Battle.net import, see [character sync](data-model.md#users-phase-3)), `/api/me/wishlists` CRUD, `DELETE /api/me` (account deletion), `GET /api/me/export` (GDPR export)

Editor: `/api/admin/change-sets` (list, create, diff, publish, discard), `/api/admin/expansions|seasons|instances|raid-bosses|items|classes|specs` (edits create change-set entries), `/api/admin/snapshot` (status of the live snapshot, rebuild). **Editors can change all game data**, including freezing seasons.

Admin: everything an editor can do, plus `/api/admin/users` (list, change role) and `/api/admin/audit-log`.

Every `/api/admin/*` route returns **404** to anyone without the required role, including anonymous visitors, so it doesn't confirm the route exists. Admin routes are served only to the separate admin site, with an admin-site session ([sessions](#mechanics)).

Import: `POST /api/admin/imports` (editor session): upload an import file → draft change set. Optional later: `POST /api/admin/imports/blizzard` starts a Blizzard API import job, and `GET /api/admin/imports/jobs/:id` reports progress. Neither publishes anything. See [data-import.md](data-import.md).

## Public data delivery (static snapshot)

Goals: public pages use **no API compute and no database queries**, they survive a sudden surge of visitors, and they keep working while the API is asleep or down.

Postgres stays the source of truth, and the admin panel always reads and writes through the API. Public game data changes only when an editor publishes, so it is published as **static JSON files deployed with the frontend** and served by Netlify's CDN.

### How it works

1. An editor publishes a change set. The API applies it in one transaction, then calls the stage's **Netlify build hook** (a secret URL, stored as an API environment secret).
2. The frontend build runs a snapshot script before `vite build`. It fetches the public endpoints from the stage's API (`API_ORIGIN`, a build-time variable, never `VITE_*`) and writes:
   - `public/data/meta.json`: `dataVersion`, `generatedAt`, the current season, and the file name of every data file below;
   - `public/data/common.<hash>.json`: expansions, seasons with their instances and raid bosses, classes and specs;
   - `public/data/seasons/<code>.<hash>.json`: one file per season with all its items.

   `<hash>` is a hash of the file's contents, so a file's name changes **only when its contents change**.
3. Netlify deploys the site with these files. Visitors download them from the CDN like any other static asset.

A code deploy runs the same build, so data and code always ship together. The script calls the API directly, without a proxy signature; the public endpoints accept that ([unsigned public reads](security.md#unsigned-public-reads)).

**Retry policy.** The API may be asleep when a build starts (Render cold start). Every request the script makes has a timeout (60 s). On a timeout, or a `502`/`503`/`504`, it retries that request **once**. If the retry fails too, the build fails and the previous deploy stays live; an editor can start it again with **Rebuild** once the API is back ([keeping the live site in step](#keeping-the-live-site-in-step-with-the-database)). The same applies to code deploys: while the API is down, a code deploy fails instead of shipping without data.

### Cache headers (`public/_headers` in the frontend)

| Path | Header | Why |
| --- | --- | --- |
| `/data/meta.json` | `Cache-Control: public, max-age=0, must-revalidate` | Always checked, but answered by the CDN with `304 Not Modified` when unchanged. It's a few hundred bytes. |
| `/data/common.*.json`, `/data/seasons/*.json` | `Cache-Control: public, max-age=31536000, immutable` | A given file name never changes contents. |

**Frozen seasons need nothing special.** Their contents never change, so their file name never changes, and browsers and the CDN keep them forever. A publish only creates new files for the seasons it actually touched; every other season keeps its name and stays cached.

How the frontend uses these files (persisted cache, freshness checks): frontend repo, `docs/backend-migration.md`.

### Keeping the live site in step with the database

- `GET /api/admin/snapshot` compares the deployed `meta.json` with the database's `data_version`. The admin panel shows "live" or "rebuilding / behind by N publishes", and offers a **Rebuild** button that calls the build hook again. That covers a failed build or a build hook call that didn't arrive.
- A bad publish can be undone in two ways: publish a corrective change set (normal path), or roll back to an earlier deploy in Netlify (immediate, but the database stays ahead until the next build).

### Costs and limits

- Publish → live takes about 1–2 minutes (one Netlify build). Fine for data that changes once per patch.
- Each publish is one Netlify build. Netlify moved new accounts to credit-based plans in 2025, where builds and bandwidth both use credits. Check which plan the account is on and its current limits before phase 1.
- The API isn't on the public request path at all, so visitor traffic never wakes it or uses Render hours.

### Inside the API

The public endpoints are only called by builds and the admin panel. Responses are built from the live tables and kept in memory keyed by `data_version`, so repeated builds or admin views don't query the database again until the next publish. API responses carry `Cache-Control: no-store`; the CDN never caches the API.

### Alternatives considered

| | Why not the default |
| --- | --- |
| Netlify CDN caching proxied API responses, with purge on publish | Every cache miss wakes the API (cold start for that visitor, Render hours used). Netlify doesn't guarantee how long entries stay, so with sparse traffic misses are common. A surge of visitors across many edge locations still reaches the API. |
| Cloudflare in front of the API | Same miss behaviour, plus a custom domain and DNS setup. |
| Browser cache only | Helps returning visitors only. It remains part of the design, on top of the snapshot. |

## Auth

### Login rollout

1. **Phase 3, staff only, on the admin site.** One provider: **Discord**, which reports `mfa_enabled`, so 2FA can be enforced. Only users who already have `EDITOR` or `ADMIN` can complete a login. Anyone else sees "accounts aren't open yet", and no account or identity is stored.
   - On the admin site this restriction is permanent, in every stage.
2. **Phase 4, public accounts, on the public site.** Login opens to everyone, and Battle.net and Google are added. On staging, the public site's login also stays restricted to staff accounts. Gated by the [privacy and legal preparation](#privacy-and-legal-before-public-accounts) and the security gate in [overview](overview.md#phase-4--user-features).

### Mechanics

- **Login:** Passport strategies in NestJS: `passport-discord`, then `passport-bnet` (or a generic OAuth2 strategy against `oauth.battle.net`) and `passport-google-oauth20`. OAuth redirect URIs point to the **Netlify domain of the site the login started on** (`https://<site>.netlify.app/api/auth/.../callback`), so the session cookie is first-party. Each stage has **its own OAuth apps**, with the callback URLs of its public and admin sites.
- **Two kinds of session.** The admin site and the public site each have their own address, so each has its own session cookie; a browser logged in on one isn't logged in on the other. Each session row also records where it was created (`session.site`: `ADMIN` | `PUBLIC`), taken from the verified proxy signature ([trusted proxy](security.md#trusted-proxy)), not from anything the browser sends.
  - `/api/admin/*` accepts only `ADMIN` sessions arriving through the admin site. A staff member logged in on the public site has no admin powers there, so a script running on public pages can't act as an editor.
  - `/api/me/*` (phase 4) accepts only `PUBLIC` sessions arriving through the public site.
  - Admin sessions get a shorter idle timeout than public ones ([security](security.md)).
- **Session cookie:** `HttpOnly; Secure; SameSite=Lax`, sessions stored in Postgres. Battle.net access tokens are used at login or sync time to read the character list. Don't keep them long-term. If you must, encrypt them.
- **Roles:** a `@Roles('EDITOR')` decorator plus a guard. `ADMIN` includes everything an editor can do, plus role management. Bootstrap the first admin of each stage with a one-off script or env var (`BOOTSTRAP_ADMIN_DISCORD_ID`).
- **Scheduled work** (retention purge, later BIS refresh) runs inside the API under an internal actor, not through an HTTP route. See [scheduled jobs](#scheduled-jobs).
- **Hardening:** see [security](security.md) for the full OWASP-based checklist and the security tests, including how the API trusts only requests that came through the Netlify proxy.
- **Blizzard API terms:** check the developer terms on caching and storing character data. Store the minimum and refresh on demand.

### Privacy and legal (before public accounts)

Goal: **store as little personal data as possible**, and have the paperwork ready before strangers can sign up. This is a checklist of topics to work through, not legal advice.

- **Data minimisation.** Store only what a feature needs:
  - the provider's user ID (needed to log in);
  - a display name, only if something shows it (otherwise don't store one);
  - characters, only if the user syncs them;
  - wishlists.
  
  No email addresses (Battle.net doesn't provide one; don't request the email scope from Discord or Google), no IP addresses in the database, no analytics that identify people.
- **Privacy policy page**: who runs the site and how to contact them, what is stored and why (legal basis: providing the service the user asked for), how long it's kept, which processors handle it (Netlify, Render, Neon, ImageKit, plus Wowhead for tooltips, see [security](security.md#third-party-scripts)), and how to delete or export your data. OAuth providers require a privacy policy URL when you register an app.
- **User rights:** account deletion and data export (phase 4), with the 30-day purge described in [data model](data-model.md#users-phase-3).
- **Processors:** check the data processing terms (DPA) of each hosting provider and keep a short record of what personal data is stored where.
- **Age:** WoW players include minors. Under GDPR, the age for consenting to online services on your own is 13–16 depending on the country (16 in Poland). Decide whether the terms simply require users to meet their country's age, and keep data minimal either way.
- **Cookies:** only the essential session cookie, so no consent banner is needed. If analytics are ever added, pick a cookieless one.
- **Platform terms:** Blizzard's developer API terms (character data), Discord's and Google's developer policies.
- **GDPR hosting:** the database and API are in Frankfurt.

## Scheduled jobs

Jobs live **inside the API**, in their own module, and run as an internal actor (`audit_log.actor_id` is NULL, see [data model](data-model.md#editorial--publishing)). No HTTP route triggers them, so there is no extra credential to protect.

- **When they run:** once when the API starts, then every 24 hours while it's awake. On the free Render plan the API sleeps when idle, so a job can run late; every job is written to tolerate that and to be safe to run twice ("delete everything past its deadline", not "delete what expired today").
- **Jobs:** scheduled season freezes (an editor sets the date by hand, see [frozen seasons](data-model.md#game-data)); session cleanup and the 30-day purge of deleted accounts (phase 4); BIS refresh (phase 5).
- An external daily ping that only wakes the API (no logic, no credentials) can be added if a job ever needs to run on time. On a paid always-on instance, the same code runs on schedule.
