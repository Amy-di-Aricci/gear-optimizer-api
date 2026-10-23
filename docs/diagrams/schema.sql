-- Entity diagram source for docs/data-model.md (draft, 2026-10-09).
-- PostgreSQL 15+ DDL meant for import into DrawSQL / dbdiagram.io / DBeaver.
-- Not a migration: Prisma owns the real schema. Postgres enums are written
-- as varchar with the allowed values in a comment, because diagram tools
-- handle CREATE TYPE poorly. CHECK constraints, partial indexes and grants
-- are collected at the end; drop that block if a diagram tool fails to parse it.
-- Keep in sync with schema.mmd; this file holds the exact constraint SQL.

-- ───────────── Game data ─────────────

CREATE TABLE expansion (
  id             serial PRIMARY KEY,
  code           varchar(16) NOT NULL UNIQUE,   -- MN, TWW
  name           varchar(128) NOT NULL,
  image_key      varchar(255),
  slim_image_key varchar(255),
  sort_order     integer NOT NULL,
  max_level      integer NOT NULL               -- character level cap
);

CREATE TABLE season (
  id           serial PRIMARY KEY,
  code         varchar(16) NOT NULL UNIQUE,     -- MNS2
  expansion_id integer NOT NULL REFERENCES expansion (id),
  short_name   varchar(64) NOT NULL,
  tier_name    varchar(128),
  image_key    varchar(255),
  starts_at    timestamptz,
  ends_at      timestamptz,
  is_current   boolean NOT NULL DEFAULT false,  -- at most one true (partial index below)
  status       varchar(16) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE | FROZEN
  freeze_at    timestamptz                       -- optional scheduled freeze, set by an editor
);

CREATE TABLE instance (
  id                  serial PRIMARY KEY,
  code                varchar(16) NOT NULL UNIQUE,   -- FLOOD, TVA
  type                varchar(16) NOT NULL,          -- DUNGEON | RAID
  name                varchar(128) NOT NULL,
  short_name          varchar(64),
  blizzard_journal_id integer UNIQUE,
  image_key           varchar(255),
  UNIQUE (id, type)                                  -- target of composite FKs
);

CREATE TABLE season_instance (
  season_id   integer NOT NULL REFERENCES season (id),
  instance_id integer NOT NULL REFERENCES instance (id),
  PRIMARY KEY (season_id, instance_id)
);

CREATE TABLE raid_boss (
  id                    serial PRIMARY KEY,
  instance_id           integer NOT NULL,
  instance_type         varchar(16) NOT NULL DEFAULT 'RAID',  -- always RAID
  code                  varchar(32) NOT NULL UNIQUE,          -- ULGRAX
  name                  varchar(128) NOT NULL,
  blizzard_encounter_id integer UNIQUE,
  sort_order            integer NOT NULL,
  FOREIGN KEY (instance_id, instance_type) REFERENCES instance (id, type)
);

-- One row per loot source: a dungeon or a raid boss, never both.
CREATE TABLE item_source (
  id           serial PRIMARY KEY,
  type         varchar(16) NOT NULL,              -- DUNGEON | RAID
  instance_id  integer UNIQUE,                    -- set for dungeons
  raid_boss_id integer UNIQUE REFERENCES raid_boss (id),  -- set for raids
  FOREIGN KEY (instance_id, type) REFERENCES instance (id, type)
);

CREATE TABLE item (
  id              integer PRIMARY KEY,               -- = Blizzard item ID
  source_id       integer NOT NULL REFERENCES item_source (id),  -- exactly one source
  name            varchar(255) NOT NULL,
  img_id          varchar(255),                      -- ImageKit key, = item ID
  slot            varchar(32) NOT NULL,              -- EItemSlot (no RANGED; TWOHAND instead)
  armor_type      varchar(16),                       -- CLOTH | LEATHER | MAIL | PLATE
  weapon_type     varchar(32),                       -- EWeaponType
  offhand_type    varchar(32),                       -- OFFHAND | SHIELD
  main_stats      text[] NOT NULL,                   -- INT | STR | AGI
  secondary_stats text[] NOT NULL,                   -- CRIT | HASTE | VERS | MASTERY
  roles           text[],                            -- trinkets only
  special_effect  text,
  imported_from   varchar(16) NOT NULL,              -- PRE_RELEASE | RETAIL | MANUAL
  source_payload  jsonb                              -- raw import record, for debugging
);

CREATE TABLE character_class (
  id                serial PRIMARY KEY,
  name              varchar(64) NOT NULL UNIQUE,
  blizzard_class_id integer NOT NULL UNIQUE            -- Blizzard playable class ID, for character sync
);

CREATE TABLE spec (
  id            serial PRIMARY KEY,
  blizzard_spec_id integer NOT NULL UNIQUE,         -- Blizzard playable specialization ID
  class_id      integer NOT NULL REFERENCES character_class (id),
  name          varchar(64) NOT NULL,
  role          varchar(16) NOT NULL,              -- enum
  main_stat     varchar(16) NOT NULL,              -- INT | STR | AGI
  weapon_types  text[] NOT NULL,                   -- enum[]
  offhand_types text[] NOT NULL,                   -- enum[]
  UNIQUE (class_id, name),
  UNIQUE (id, class_id)                            -- target of composite FK
);

-- ───────────── Users (phase 3+) ─────────────

-- Never hard-deleted: account deletion anonymises the row (tombstone).
CREATE TABLE app_user (
  id           serial PRIMARY KEY,
  display_name varchar(64) NOT NULL,
  role         varchar(16) NOT NULL DEFAULT 'USER',  -- USER | EDITOR | ADMIN
  created_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);

CREATE TABLE user_identity (
  id               serial PRIMARY KEY,
  user_id          integer NOT NULL REFERENCES app_user (id),
  provider         varchar(16) NOT NULL,             -- BNET | DISCORD | GOOGLE
  provider_user_id varchar(255) NOT NULL,
  UNIQUE (provider, provider_user_id),               -- an identity belongs to one user
  UNIQUE (id, user_id, provider)                     -- target of composite FK
);

CREATE TABLE session (
  id         varchar(64) PRIMARY KEY,                -- hash of the session token
  user_id    integer NOT NULL REFERENCES app_user (id),
  site       varchar(8) NOT NULL,                    -- ADMIN | PUBLIC: site the session was created on
  expires_at timestamptz NOT NULL
);

CREATE TABLE character (
  id                serial PRIMARY KEY,
  user_id           integer NOT NULL REFERENCES app_user (id),
  identity_id       integer NOT NULL,
  identity_provider varchar(16) NOT NULL DEFAULT 'BNET',       -- always BNET
  region            varchar(8) NOT NULL,
  bnet_character_id bigint NOT NULL,
  realm_slug        varchar(64) NOT NULL,
  name              varchar(64) NOT NULL,
  level             integer NOT NULL,                           -- list shows max level only
  class_id          integer NOT NULL REFERENCES character_class (id),
  active_spec_id    integer,
  last_synced_at    timestamptz,
  UNIQUE (region, bnet_character_id),                           -- Blizzard's ID, not the name
  UNIQUE (id, user_id),                                         -- target of composite FK
  FOREIGN KEY (identity_id, user_id, identity_provider)
    REFERENCES user_identity (id, user_id, provider) ON DELETE CASCADE,
  FOREIGN KEY (active_spec_id, class_id) REFERENCES spec (id, class_id)  -- spec belongs to class
);

CREATE TABLE wishlist (
  id           serial PRIMARY KEY,
  user_id      integer NOT NULL REFERENCES app_user (id),      -- always has an owner
  season_id    integer NOT NULL REFERENCES season (id),
  spec_id      integer NOT NULL REFERENCES spec (id),
  character_id integer,                                         -- optional
  name         varchar(128) NOT NULL,
  archived_at  timestamptz,
  FOREIGN KEY (character_id, user_id) REFERENCES character (id, user_id)
    ON DELETE SET NULL (character_id)                           -- same owner; keep wishlist
);

CREATE TABLE wishlist_item (
  wishlist_id integer NOT NULL REFERENCES wishlist (id) ON DELETE CASCADE,
  item_id     integer NOT NULL REFERENCES item (id) ON DELETE RESTRICT,
  added_at    timestamptz NOT NULL DEFAULT now(),
  obtained_at timestamptz,
  PRIMARY KEY (wishlist_id, item_id)
);

-- ───────────── Editorial / publishing ─────────────

CREATE TABLE change_set (
  id           serial PRIMARY KEY,
  title        varchar(255) NOT NULL,
  origin       varchar(16) NOT NULL,                 -- IMPORT | MANUAL
  status       varchar(16) NOT NULL DEFAULT 'DRAFT', -- DRAFT | PUBLISHED | DISCARDED
  base_version bigint NOT NULL,                      -- data_version the draft is based on
  created_by   integer NOT NULL REFERENCES app_user (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  resolved_by  integer REFERENCES app_user (id),     -- who published or discarded
  resolved_at  timestamptz
);

CREATE TABLE change_set_entry (
  id            serial PRIMARY KEY,
  change_set_id integer NOT NULL REFERENCES change_set (id) ON DELETE CASCADE,
  entity        varchar(32) NOT NULL,                -- item, item_source, season, season_instance, ...
  entity_key    jsonb NOT NULL,                      -- natural key: {"code":"MNS2"}, {"season":"MNS2","instance":"FLOOD"}
  op            varchar(8) NOT NULL,                 -- CREATE | UPDATE | DELETE
  before        jsonb,
  after         jsonb,
  UNIQUE (change_set_id, entity, entity_key)         -- one entry per row
);

CREATE TABLE data_version (
  id      integer PRIMARY KEY DEFAULT 1,             -- single row, inserted by the migration
  version bigint NOT NULL DEFAULT 0
);

-- Append-only: the app role gets INSERT and SELECT only (see grants below).
CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  actor_id   integer REFERENCES app_user (id),      -- NULL = scheduled job
  action     varchar(64) NOT NULL,
  target     varchar(255),
  payload    jsonb,                                  -- no personal data
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ───────────── CHECK constraints & partial indexes ─────────────
-- Written with IS NULL / num_nonnulls so they never evaluate to NULL
-- (a NULL result would let the row through).

CREATE UNIQUE INDEX season_one_current ON season (is_current) WHERE is_current;

ALTER TABLE season ADD CONSTRAINT season_current_not_frozen
  CHECK (NOT (is_current AND status = 'FROZEN'));

ALTER TABLE season ADD CONSTRAINT season_ends_after_start
  CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at);

ALTER TABLE raid_boss ADD CONSTRAINT raid_boss_in_raid
  CHECK (instance_type = 'RAID');

ALTER TABLE item_source ADD CONSTRAINT item_source_dungeon_or_raid_boss CHECK (
  CASE type
    WHEN 'DUNGEON' THEN instance_id IS NOT NULL AND raid_boss_id IS NULL
    WHEN 'RAID'    THEN raid_boss_id IS NOT NULL AND instance_id IS NULL
    ELSE false
  END
);

ALTER TABLE item ADD CONSTRAINT item_type_columns_match_slot CHECK (
  CASE
    WHEN slot IN ('HEAD','SHOULDER','CHEST','WRIST','HANDS','WAIST','LEGS','FEET')
      THEN armor_type IS NOT NULL AND weapon_type IS NULL AND offhand_type IS NULL
    WHEN slot IN ('MAINHAND','TWOHAND')
      THEN weapon_type IS NOT NULL AND armor_type IS NULL AND offhand_type IS NULL
    WHEN slot = 'OFFHAND'
      THEN offhand_type IS NOT NULL AND armor_type IS NULL AND weapon_type IS NULL
    ELSE num_nonnulls(armor_type, weapon_type, offhand_type) = 0  -- NECK, FINGER, BACK, TRINKET
  END
);

ALTER TABLE item ADD CONSTRAINT item_weapon_type_matches_slot CHECK (
  weapon_type IS NULL
  OR (slot = 'MAINHAND' AND weapon_type IN ('DAGGER','FIST','AXE1H','MACE1H','SWORD1H','WARGLAIVE','WAND'))
  OR (slot = 'TWOHAND'  AND weapon_type IN ('POLEARM','STAFF','AXE2H','MACE2H','SWORD2H','BOW','CROSSBOW','GUN'))
);

ALTER TABLE item ADD CONSTRAINT item_roles_only_on_trinkets
  CHECK ((slot = 'TRINKET') = (roles IS NOT NULL));

ALTER TABLE character ADD CONSTRAINT character_from_bnet
  CHECK (identity_provider = 'BNET');

ALTER TABLE change_set ADD CONSTRAINT change_set_resolved_when_not_draft CHECK (
  (status = 'DRAFT') = (resolved_at IS NULL)
  AND (resolved_at IS NULL) = (resolved_by IS NULL)
);

ALTER TABLE data_version ADD CONSTRAINT data_version_single_row
  CHECK (id = 1);

-- ───────────── Grants (app role; the migration role owns the tables) ─────────────
-- REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM app_role;
-- GRANT INSERT, SELECT ON audit_log TO app_role;
