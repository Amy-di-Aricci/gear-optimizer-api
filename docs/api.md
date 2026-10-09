# API

Status: draft · Last updated: 2026-10-09 · Part of the [backend migration plan](overview.md)

## API outline

Public (cacheable, no auth):
- `GET /api/meta`: current `data_version`, current season code
- `GET /api/expansions`, `GET /api/seasons`
- `GET /api/seasons/:code`: season with its instances and raid bosses
- `GET /api/seasons/:code/items`: **all items for the season in one response** (a few hundred rows, tens of KB gzipped). Keep the current client-side filtering. It's instant for the user and saves round-trips to a sleeping server.
- `GET /api/specs`
- Caching: see [caching](#caching--cold-starts).

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

Auth: `GET /api/auth/{bnet|discord|google}` → provider → `GET /api/auth/{provider}/callback`, `POST /api/auth/logout`, `GET /api/me`

User (session required): `/api/me/characters` (max-level characters only; `POST /sync` for Battle.net import, see [character sync](data-model.md#users-phase-3)), `/api/me/wishlists` CRUD, `DELETE /api/me` (account deletion), `GET /api/me/export` (GDPR export)

Editor: `/api/admin/change-sets` (list, create, diff, publish, discard), `/api/admin/items|instances|seasons…` (edits create change-set entries)

Admin: `/api/admin/users` (list, change role), `/api/admin/audit-log`

Import: `POST /api/admin/imports` (editor session): upload an import file → draft change set. Optional later: `POST /api/admin/imports/blizzard` starts a Blizzard API import job, and `GET /api/admin/imports/jobs/:id` reports progress. Neither publishes anything. See [data-import.md](data-import.md).

## Caching & cold starts

Postgres stays the source of truth, and the admin panel always reads and writes through the API. Caching only affects how **public, published game data** reaches visitors. Public data changes only when an editor publishes, so every cache can be invalidated at that moment instead of guessing expiry times.

### Options

| | How it works | Cold start for visitors? | Cost | Effort |
| --- | --- | --- | --- | --- |
| **A. Netlify CDN caches proxied API responses** | The API sends `Netlify-CDN-Cache-Control: public, durable, s-maxage=31536000, stale-while-revalidate=…` plus a `Netlify-Cache-Tag: game-data` header. On publish, the API calls Netlify's purge API for that tag, then requests the main URLs itself to warm the cache. It's already awake, having just handled the publish. | Rarely: only on a cache miss, e.g. a rarely-viewed old season that was evicted. Netlify doesn't guarantee how long entries stay. | €0 | Low: headers plus one purge call |
| **B. Static snapshot rebuilt on publish** | On publish, the API calls a **Netlify build hook**. The frontend build runs a script that fetches the public endpoints and writes `public/data/*.json` (one file per season, plus `meta.json`), then deploys them with the site. | **Never** for public pages. They're plain static files on Netlify's CDN. | €0 (a publish uses ~1–2 of the 300 free build minutes/month) | Medium: a build script, plus a slightly different fetch path for public vs admin data |
| **C. Cloudflare in front** (free plan) | Put a custom domain on Cloudflare and cache `/api/*` with cache rules. Purge on publish. | Rarely (same as A) | ~€10/yr domain | Medium: DNS, cache rules |
| **D. Browser cache** (already planned) | TanStack Query cache persisted to `localStorage`. | Hidden for **returning** visitors only | €0 | Low |

### Recommendation

1. **Phase 1: A + D.** These are mostly headers and a purge call, with no new moving parts.
   - Verify Netlify's current behaviour with a spike: that proxied responses get cached, and that `durable` and cache-tag purge work.
   - Send `Cache-Control: no-store` on everything under `/api/me`, `/api/auth` and `/api/admin`, so private data is never cached.
2. **If cache misses are still noticeable, move to B.** With sparse traffic (~50 users), CDN entries can get evicted between visits. A static snapshot avoids that entirely.
   - It costs an extra 1–2 minutes between "Publish" and "live", which is fine for data that changes once per patch.
   - It also gives you atomic deploys and one-click rollback of data releases through Netlify's deploy history.
3. **Frozen seasons** never change, so their responses or files can be marked `immutable` and cached for a year.

In every option, the response shape is the same DTO from the OpenAPI spec, so the frontend uses the same generated types whether data comes from the API or a static file.

## Auth

- **Login:** Passport strategies in NestJS: `passport-bnet` (or a generic OAuth2 strategy against `oauth.battle.net`), `passport-discord`, `passport-google-oauth20`. OAuth redirect URIs point to the **Netlify domain** (`https://<site>.netlify.app/api/auth/.../callback`), so the session cookie is first-party.
- **Session cookie:** `HttpOnly; Secure; SameSite=Lax`, sessions stored in Postgres. Battle.net access tokens are used at login or sync time to read the character list. Don't keep them long-term. If you must, encrypt them.
- **Roles:** a `@Roles('EDITOR')` decorator plus a guard. `ADMIN` includes everything an editor can do. Bootstrap the first admin with a one-off script or env var (`BOOTSTRAP_ADMIN_BNET_ID`).
- **Hardening:** see [security](security.md) for the full OWASP-based checklist and the security tests.
- **GDPR (EU users):** host the DB and API in Frankfurt. Write a short privacy policy covering what's stored (provider IDs, characters, wishlists) and why. Provide account deletion (personal data such as identities, characters and wishlists is deleted, and the user row is kept only as an anonymised tombstone, see [account deletion](data-model.md#users-phase-3); BIS stats keep only anonymised counts) and data export. With only an essential session cookie and no tracking cookies, you don't need a consent banner. If you add analytics, pick a cookieless one.
- **Blizzard API terms:** check the developer terms on caching and storing character data. Store the minimum and refresh on demand.
