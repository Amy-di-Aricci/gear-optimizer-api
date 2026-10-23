# Data import

Status: draft · Last updated: 2026-10-09 · Part of the [backend migration plan](overview.md)

The API doesn't scrape or crawl anything. Game data enters the system in one of three ways, and every one ends as a **draft change set** that an editor reviews and publishes ([publishing model](data-model.md#editorial--publishing)):

| Way in | Who | When |
| --- | --- | --- |
| **Import file upload** (primary) | Editor, in the admin panel | Any time, e.g. pre-release data, or a re-import after launch |
| **Blizzard API import** (optional, later) | Editor, in the admin panel | After content is live on retail |
| **Manual edit** | Editor, in the admin panel | Fixes and small additions |

Import files are produced by a separate, private tool that isn't part of this repository. This repository only defines and validates the **import file format**.

## Import file format

A versioned JSON document. The schema is the contract between the external tool and the API.

- Source of truth: the import DTO classes in the API (validated with `class-validator`).
- The JSON Schema is generated from them and committed as `schemas/import/v1.schema.json`. External tools validate their output against it (e.g. with `ajv`) before an editor uploads anything.
- Breaking changes create a new version (`v2`). The API accepts the previous version for at least one season.

```jsonc
{
  "formatVersion": 1,
  "dataStage": "PRE_RELEASE",            // or "RETAIL"
  "generatedAt": "2026-10-01T12:00:00Z",
  "generator": "name@version",           // free text, shown in the admin UI
  "instances": [
    {
      "code": "TVA",
      "type": "RAID",                    // or "DUNGEON"
      "name": "The Venomous Abyss",
      "journalInstanceId": 1234,
      "raidBosses": [                    // raids only; omitted for dungeons
        { "code": "ROTMIRE", "name": "Rotmire", "journalEncounterId": 5678 }
      ]
    }
  ],
  "items": [
    {
      "id": 268283,                      // Blizzard item ID
      "name": "Festerbloom Crown",
      "imgId": "268283",                 // ImageKit key of the icon, = the item ID
      "slot": "HEAD",
      "armorType": "LEATHER",            // weaponType / offhandType / roles / mainStats as applicable
      "secondaryStats": ["CRIT", "HASTE"],
      "specialEffect": null,
      "source": { "instance": "TVA", "raidBoss": "ROTMIRE" }  // exactly one; "raidBoss" only for raids
    }
  ]
}
```

Semantics:
- **Partial imports are normal.** A file only affects the instances it contains. An item has exactly one source ([data model](data-model.md#game-data)). If it now drops somewhere else in the file, the diff proposes a source change. If it used to drop from an included instance but is missing from the file, the diff proposes **deleting the item** and highlights it, so an editor can discard that entry when the file is simply incomplete. Deleting an item that's on any wishlist is blocked: the diff shows "on N wishlists", and the change set can't be published until that entry is discarded.
- **Idempotent.** Items are keyed by Blizzard item ID and instances/raid bosses by `code`. Uploading the same file twice produces an empty diff.
- `dataStage` is stored on each item as `imported_from` (`PRE_RELEASE` \| `RETAIL` \| `MANUAL`), so editors can see which items haven't been confirmed against retail data yet. Pre-release values (stats, icons, names, sources) can change before launch, so re-import after launch and review the diff.
- Seasons and their rotations aren't part of the import file. Editors manage them in the admin panel, together with everything else the file doesn't carry (instance short names and images, raid boss order, expansions, classes and specs).

## Images

All images live on ImageKit: item icons (at `images/icons/<imgId>.jpg`, where `imgId` is the item ID) and instance, season and expansion art (e.g. `images/instance-img/<name>.webp`). The API never stores image files; rows only hold keys.

- **The import tool uploads them.** The private tool already downloads images while it collects data. It uploads any missing ones to the ImageKit account of the stage it targets (staging or production, see [environments](environments.md)) **before** the import file is uploaded. The ImageKit private key for that stage stays on the machine running the tool, never in a repository.
- **Uploads are idempotent:** the path is derived from the item ID or the code, so re-running the tool skips files that already exist.
- **The API checks, it doesn't upload.** While computing the diff, the API checks (a `HEAD` request to the public ImageKit URL) that every image the change set references exists, and the diff flags missing ones. Publishing with a missing image is allowed but warned about, since the frontend falls back to a placeholder.
- No paid ImageKit features are used.
- The optional [Blizzard API import](#blizzard-api-import-optional-later) would need to upload icons from the API itself, with the ImageKit private key as an API secret. Decide that when it's built.

## Upload flow

1. An editor uploads the file in the admin panel → `POST /api/admin/imports` (editor session, `application/json`).
2. The API validates it against the schema. On failure, nothing is stored and the response lists errors by JSON path.
3. The API computes the diff against live data and stores it as a draft change set (`origin: IMPORT`, file metadata kept for the audit log).
4. The admin UI shows the diff: new, changed (field-by-field) and removed items and sources, and missing images. The editor publishes or discards it. Publishing triggers a rebuild of the [static snapshot](api.md#public-data-delivery-static-snapshot).
5. Change sets touching a [frozen season](data-model.md#game-data) are rejected.

Limits: 5 MB per file on this endpoint (the global body limit stays small), a stricter rate limit, `EDITOR` role required.

## Blizzard API import (optional, later)

A second import path, for content that's already live on retail:

- An editor enters journal instance IDs in the admin panel → the API starts a background job (`import_job` table: status, progress, errors).
- The job calls the Blizzard Game Data API: `journal-instance/{id}` → encounters (raid bosses), `journal-encounter/{id}` → items dropped, `item/{id}` + `item-media/{id}` → details and icon. It normalises the result into the **same import format** and continues through the same diff → draft change set path.
- The Blizzard client ID and secret are backend environment secrets (Render), never in the repo.
- The free Render instance stays awake while the job runs. The job must be resumable, since a restart mid-job just re-runs it (idempotent).

## Tests

- Schema and DTO: valid and invalid fixture files (hand-written, small, public game data only) → expected validation errors.
- Diff engine: unit tests for create, update and source-removal cases, partial imports, and re-uploading the same file.
- Integration: upload → change set → publish → public endpoint shows the new data and the build hook is called (stubbed). Frozen season → rejected. Missing image → flagged in the diff (ImageKit stubbed).
- Contract: CI fails if `schemas/import/v1.schema.json` doesn't match the DTOs.
- Blizzard job (when built): recorded API responses as fixtures, no network in tests.
