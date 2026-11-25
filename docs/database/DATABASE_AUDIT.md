# STIS database audit

**System:** Sarawak Tourism Information System, full-system release (`main` at `0463da1`)
**Database:** Supabase PostgreSQL 17.11, project region Singapore, schema `stis`
**Audit date:** 25 November 2026
**Method:** read-only catalog and data queries against production, a clean rebuild of the migration history on a local PostgreSQL 18.6 server, source inspection, and the automated test suites
**Production changes made by this audit:** none

> This document describes the PostgreSQL database of the full-system release. The AS03 assessment build uses Node.js and SQLite, and
> its report and diagrams are a separate artefact. Nothing here describes or replaces the AS03 design.

## 1. Summary

| Area | Result |
|---|---|
| Tables in `stis` | 12, all expected; no views, functions or triggers. The empty `public` schema is intentional |
| Live schema vs checked-in migrations | **Identical.** Columns, constraints, indexes, policies, RLS flags, grants and the migration ledger have the same fingerprint as a clean build of the five migrations (§4) |
| Data invariants on live data | **18 of 18 hold** (0 violating rows) (§5) |
| Requirement coverage | T1–T8 and every full-system extension map to tables, keys and constraints (§6) |
| Security | No exploitable defect found. RLS policies are `USING (true)` by design; isolation is enforced by the API, by grants and by schema exposure (§7) |
| Supabase advisors | Security: 0 findings. Performance: 2 INFO notices about unused indexes, both intentional (§9) |
| Findings | 0 Critical, 0 High, 1 Medium (residual design risk), 6 Low, 1 Info group (§10) |
| **Readiness** | **Ready for production use.** No blocking defect. One optional, tested hardening migration awaits owner approval |

## 2. Scope and evidence

| Evidence | Location |
|---|---|
| Migration history (authoritative) | `supabase/migrations/*.sql` (5 files) and `supabase/rollback/*.down.sql` |
| Migration runner | `server/db.ts` (`migrate()`, lines 58–80) |
| Data access | `server/repositories.ts`, `server/accounts.ts`, `server/services.ts`, `server/catalog.ts` |
| HTTP authorisation boundary | `server/http.ts` |
| Catalog snapshot of the clean build (identical to production) | `docs/database/schema-snapshot.json` |
| Fingerprint query used for drift detection | `MIGRATION_REPORT.md` §3 |
| Diagrams generated from the snapshot | `DATABASE_ERD.drawio` and its SVG/PNG exports |

Production was examined only with `SELECT` statements on catalog views (`pg_class`, `pg_constraint`, `pg_index`, `pg_policy`,
`pg_roles`, `information_schema.role_table_grants`, `pg_auth_members`, `pg_db_role_setting`), aggregate counts and invariant
queries returning counts. No row contents containing personal data were read.

## 3. Schema inventory

All tables are in schema `stis`, owned by `postgres`. RLS is enabled and not forced on every table. Each table has exactly one
policy, `stis_api_access`. The role `stis_api` is the only non-owner role with access. Totals: 12 tables, 64 columns,
48 constraints (12 PK, 14 FK, 4 UK, 18 CHECK), 26 indexes.

### 3.1 `stis.account`

RLS enabled (not forced) · policy `stis_api_access` FOR ALL TO stis_api USING (true) WITH CHECK (true) · `stis_api` grants: SELECT, INSERT, UPDATE, DELETE

| Column | Type | Null | Default / identity |
|---|---|---|---|
| `id` | uuid | no |  |
| `email` | text | no |  |
| `display_name` | text | no |  |
| `role` | text | no |  |
| `password_hash` | text | no |  |
| `status` | text | no | `'active'::text` |
| `created_at` | timestamptz | no | `now()` |
| `updated_at` | timestamptz | no | `now()` |
| `password_changed_at` | timestamptz | no | `now()` |

| Constraint | Kind | Definition |
|---|---|---|
| `account_pkey` | PK | `PRIMARY KEY (id)` |
| `account_email_key` | UK | `UNIQUE (email)` |
| `account_display_name_check` | CHECK | `CHECK (((length(display_name) >= 1) AND (length(display_name) <= 60)))` |
| `account_email_check` | CHECK | `CHECK (((email = lower(email)) AND ((length(email) >= 3) AND (length(email) <= 254))))` |
| `account_role_check` | CHECK | `CHECK ((role = ANY (ARRAY['tourist'::text, 'staff'::text, 'admin'::text])))` |
| `account_status_check` | CHECK | `CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text])))` |

Indexes: `UNIQUE INDEX account_email_key (email)`; `UNIQUE INDEX account_pkey (id)`

### 3.2 `stis.account_session`

RLS enabled (not forced) · policy `stis_api_access` FOR ALL TO stis_api USING (true) WITH CHECK (true) · `stis_api` grants: SELECT, INSERT, UPDATE, DELETE

| Column | Type | Null | Default / identity |
|---|---|---|---|
| `token_digest` | text | no |  |
| `account_id` | uuid | no |  |
| `created_at` | timestamptz | no |  |
| `last_seen_at` | timestamptz | no |  |
| `expires_at` | timestamptz | no |  |
| `absolute_expires_at` | timestamptz | no |  |

| Constraint | Kind | Definition |
|---|---|---|
| `account_session_pkey` | PK | `PRIMARY KEY (token_digest)` |
| `account_session_account_id_fkey` | FK | `FOREIGN KEY (account_id) REFERENCES stis.account(id) ON DELETE CASCADE` |

Indexes: `INDEX account_session_account (account_id)`; `UNIQUE INDEX account_session_pkey (token_digest)`

### 3.3 `stis.recovery_code`

RLS enabled (not forced) · policy `stis_api_access` FOR ALL TO stis_api USING (true) WITH CHECK (true) · `stis_api` grants: SELECT, INSERT, UPDATE, DELETE

| Column | Type | Null | Default / identity |
|---|---|---|---|
| `account_id` | uuid | no |  |
| `code_digest` | text | no |  |
| `used_at` | timestamptz | yes |  |

| Constraint | Kind | Definition |
|---|---|---|
| `recovery_code_pkey` | PK | `PRIMARY KEY (account_id, code_digest)` |
| `recovery_code_account_id_fkey` | FK | `FOREIGN KEY (account_id) REFERENCES stis.account(id) ON DELETE CASCADE` |

Indexes: `UNIQUE INDEX recovery_code_pkey (account_id, code_digest)`

### 3.4 `stis.auth_throttle`

RLS enabled (not forced) · policy `stis_api_access` FOR ALL TO stis_api USING (true) WITH CHECK (true) · `stis_api` grants: SELECT, INSERT, UPDATE, DELETE

| Column | Type | Null | Default / identity |
|---|---|---|---|
| `key` | text | no |  |
| `window_started_at` | timestamptz | no |  |
| `failures` | integer | no |  |

| Constraint | Kind | Definition |
|---|---|---|
| `auth_throttle_pkey` | PK | `PRIMARY KEY (key)` |
| `auth_throttle_failures_check` | CHECK | `CHECK ((failures >= 0))` |

Indexes: `UNIQUE INDEX auth_throttle_pkey (key)`

### 3.5 `stis.tourism_record`

RLS enabled (not forced) · policy `stis_api_access` FOR ALL TO stis_api USING (true) WITH CHECK (true) · `stis_api` grants: SELECT, INSERT (append-only)

| Column | Type | Null | Default / identity |
|---|---|---|---|
| `id` | text | no |  |
| `kind` | text | no |  |
| `created_at` | timestamptz | no | `now()` |

| Constraint | Kind | Definition |
|---|---|---|
| `tourism_record_pkey` | PK | `PRIMARY KEY (id)` |
| `tourism_record_id_kind_key` | UK | `UNIQUE (id, kind)` |
| `tourism_record_id_check` | CHECK | `CHECK ((id ~ '^[A-Za-z0-9_-]{1,100}$'::text))` |
| `tourism_record_kind_check` | CHECK | `CHECK ((kind = ANY (ARRAY['destination'::text, 'event'::text, 'accommodation'::text, 'transportation'::text, 'dining'::text, 'visitor'::text])))` |

Indexes: `UNIQUE INDEX tourism_record_id_kind_key (id, kind)`; `UNIQUE INDEX tourism_record_pkey (id)`

### 3.6 `stis.record_version`

RLS enabled (not forced) · policy `stis_api_access` FOR ALL TO stis_api USING (true) WITH CHECK (true) · `stis_api` grants: SELECT, INSERT (append-only)

| Column | Type | Null | Default / identity |
|---|---|---|---|
| `record_id` | text | no |  |
| `version` | integer | no |  |
| `payload` | jsonb | no |  |
| `created_at` | timestamptz | no | `now()` |
| `author_id` | uuid | yes |  |

| Constraint | Kind | Definition |
|---|---|---|
| `record_version_pkey` | PK | `PRIMARY KEY (record_id, version)` |
| `record_version_author_id_fkey` | FK | `FOREIGN KEY (author_id) REFERENCES stis.account(id) ON DELETE SET NULL` |
| `record_version_record_id_fkey` | FK | `FOREIGN KEY (record_id) REFERENCES stis.tourism_record(id)` |
| `record_version_version_check` | CHECK | `CHECK ((version >= 1))` |

Indexes: `INDEX record_version_author (author_id)`; `UNIQUE INDEX record_version_pkey (record_id, version)`

### 3.7 `stis.record_state`

RLS enabled (not forced) · policy `stis_api_access` FOR ALL TO stis_api USING (true) WITH CHECK (true) · `stis_api` grants: SELECT, INSERT, UPDATE, DELETE

| Column | Type | Null | Default / identity |
|---|---|---|---|
| `record_id` | text | no |  |
| `draft` | integer | no |  |
| `published` | integer | yes |  |
| `updated_at` | timestamptz | no | `now()` |

| Constraint | Kind | Definition |
|---|---|---|
| `record_state_pkey` | PK | `PRIMARY KEY (record_id)` |
| `record_state_record_id_draft_fkey` | FK | `FOREIGN KEY (record_id, draft) REFERENCES stis.record_version(record_id, version)` |
| `record_state_record_id_fkey` | FK | `FOREIGN KEY (record_id) REFERENCES stis.tourism_record(id)` |
| `record_state_record_id_published_fkey` | FK | `FOREIGN KEY (record_id, published) REFERENCES stis.record_version(record_id, version)` |

Indexes: `INDEX record_state_draft (record_id, draft)`; `UNIQUE INDEX record_state_pkey (record_id)`; `INDEX record_state_published (record_id, published)`

### 3.8 `stis.version_destination`

RLS enabled (not forced) · policy `stis_api_access` FOR ALL TO stis_api USING (true) WITH CHECK (true) · `stis_api` grants: SELECT, INSERT (append-only)

| Column | Type | Null | Default / identity |
|---|---|---|---|
| `record_id` | text | no |  |
| `version` | integer | no |  |
| `destination_id` | text | no |  |

| Constraint | Kind | Definition |
|---|---|---|
| `version_destination_pkey` | PK | `PRIMARY KEY (record_id, version, destination_id)` |
| `version_destination_destination_id_fkey` | FK | `FOREIGN KEY (destination_id) REFERENCES stis.tourism_record(id)` |
| `version_destination_record_id_version_fkey` | FK | `FOREIGN KEY (record_id, version) REFERENCES stis.record_version(record_id, version)` |

Indexes: `UNIQUE INDEX version_destination_pkey (record_id, version, destination_id)`; `INDEX version_destination_target (destination_id)`

### 3.9 `stis.record_activity`

RLS enabled (not forced) · policy `stis_api_access` FOR ALL TO stis_api USING (true) WITH CHECK (true) · `stis_api` grants: SELECT, INSERT (append-only)

| Column | Type | Null | Default / identity |
|---|---|---|---|
| `id` | bigint | no | `identity ALWAYS` |
| `record_id` | text | no |  |
| `action` | text | no |  |
| `version` | integer | no |  |
| `actor_id` | uuid | yes |  |
| `at` | timestamptz | no | `now()` |

| Constraint | Kind | Definition |
|---|---|---|
| `record_activity_pkey` | PK | `PRIMARY KEY (id)` |
| `record_activity_actor_id_fkey` | FK | `FOREIGN KEY (actor_id) REFERENCES stis.account(id) ON DELETE SET NULL` |
| `record_activity_record_id_fkey` | FK | `FOREIGN KEY (record_id) REFERENCES stis.tourism_record(id)` |
| `record_activity_action_check` | CHECK | `CHECK ((action = ANY (ARRAY['create'::text, 'save'::text, 'publish'::text, 'withdraw'::text])))` |

Indexes: `INDEX record_activity_actor (actor_id)`; `UNIQUE INDEX record_activity_pkey (id)`; `INDEX record_activity_record (record_id, id)`

### 3.10 `stis.itinerary`

RLS enabled (not forced) · policy `stis_api_access` FOR ALL TO stis_api USING (true) WITH CHECK (true) · `stis_api` grants: SELECT, INSERT, UPDATE, DELETE

| Column | Type | Null | Default / identity |
|---|---|---|---|
| `id` | uuid | no |  |
| `owner_id` | uuid | yes |  |
| `guest_digest` | text | yes |  |
| `title` | text | no |  |
| `start_date` | text | no |  |
| `end_date` | text | no |  |
| `provisional` | boolean | no |  |
| `revision` | integer | no |  |
| `created_at` | timestamptz | no | `now()` |
| `updated_at` | timestamptz | no | `now()` |
| `share_digest` | text | yes |  |

| Constraint | Kind | Definition |
|---|---|---|
| `itinerary_pkey` | PK | `PRIMARY KEY (id)` |
| `itinerary_owner_id_fkey` | FK | `FOREIGN KEY (owner_id) REFERENCES stis.account(id) ON DELETE CASCADE` |
| `itinerary_guest_digest_key` | UK | `UNIQUE (guest_digest)` |
| `itinerary_share_digest_key` | UK | `UNIQUE (share_digest)` |
| `itinerary_check` | CHECK | `CHECK (((end_date ~ '^\d{4}-\d{2}-\d{2}$'::text) AND (end_date >= start_date)))` |
| `itinerary_check1` | CHECK | `CHECK (((owner_id IS NOT NULL) OR (guest_digest IS NOT NULL)))` |
| `itinerary_revision_check` | CHECK | `CHECK ((revision >= 1))` |
| `itinerary_start_date_check` | CHECK | `CHECK ((start_date ~ '^\d{4}-\d{2}-\d{2}$'::text))` |
| `itinerary_title_check` | CHECK | `CHECK (((length(title) >= 1) AND (length(title) <= 120)))` |

Indexes: `UNIQUE INDEX itinerary_guest_digest_key (guest_digest)`; `INDEX itinerary_owner (owner_id, updated_at DESC)`; `UNIQUE INDEX itinerary_pkey (id)`; `UNIQUE INDEX itinerary_share_digest_key (share_digest)`

### 3.11 `stis.itinerary_entry`

RLS enabled (not forced) · policy `stis_api_access` FOR ALL TO stis_api USING (true) WITH CHECK (true) · `stis_api` grants: SELECT, INSERT, UPDATE, DELETE

| Column | Type | Null | Default / identity |
|---|---|---|---|
| `id` | uuid | no |  |
| `itinerary_id` | uuid | no |  |
| `record_id` | text | no |  |
| `kind` | text | no |  |
| `day` | text | no |  |
| `start_time` | text | no |  |
| `end_time` | text | no |  |
| `note` | text | no | `''::text` |
| `position` | integer | no |  |

| Constraint | Kind | Definition |
|---|---|---|
| `itinerary_entry_pkey` | PK | `PRIMARY KEY (id)` |
| `itinerary_entry_itinerary_id_fkey` | FK | `FOREIGN KEY (itinerary_id) REFERENCES stis.itinerary(id) ON DELETE CASCADE` |
| `itinerary_entry_record_id_kind_fkey` | FK | `FOREIGN KEY (record_id, kind) REFERENCES stis.tourism_record(id, kind)` |
| `itinerary_entry_check` | CHECK | `CHECK ((((start_time = ''::text) AND (end_time = ''::text)) OR ((start_time <> ''::text) AND (end_time <> ''::text) AND (start_time < end_time))))` |
| `itinerary_entry_day_check` | CHECK | `CHECK ((day ~ '^\d{4}-\d{2}-\d{2}$'::text))` |
| `itinerary_entry_kind_check` | CHECK | `CHECK ((kind = ANY (ARRAY['destination'::text, 'event'::text, 'accommodation'::text, 'transportation'::text, 'dining'::text])))` |
| `itinerary_entry_note_check` | CHECK | `CHECK ((length(note) <= 500))` |

Indexes: `UNIQUE INDEX itinerary_entry_pkey (id)`; `INDEX itinerary_entry_plan (itinerary_id, "position")`; `INDEX itinerary_entry_record (record_id, kind)`

### 3.12 `stis.schema_migration`

RLS enabled (not forced) · policy `stis_api_access` FOR ALL TO stis_api USING (true) WITH CHECK (true) · `stis_api` grants: SELECT

| Column | Type | Null | Default / identity |
|---|---|---|---|
| `version` | text | no |  |
| `applied_at` | timestamptz | no | `now()` |

| Constraint | Kind | Definition |
|---|---|---|
| `schema_migration_pkey` | PK | `PRIMARY KEY (version)` |

Indexes: `UNIQUE INDEX schema_migration_pkey (version)`

### 3.13 Production row counts (25 Nov 2026)

| Table | Rows | Note |
|---|---:|---|
| `account` | 8 | 1 active administrator; the remainder are disabled synthetic QA accounts; 0 tourist accounts |
| `account_session` | 0 | |
| `recovery_code` | 0 | |
| `auth_throttle` | 1 | |
| `tourism_record` | 55 | |
| `record_version` | 127 | 112 have `author_id` null (written by the content import, which has no account) |
| `record_state` | 55 | 49 published |
| `version_destination` | 85 | |
| `record_activity` | 257 | |
| `itinerary` | 1 | |
| `itinerary_entry` | 1 | |
| `schema_migration` | 5 | |

## 4. Live schema versus migration history

The five migrations were applied to an empty local PostgreSQL 18.6 database by the application's own `migrate()` function. The same
fingerprint query was then run there and on production. Every category matches. PostgreSQL 18 also records NOT NULL as catalog
constraints (`contype = 'n'`), so those rows are excluded on the local side.

| Category | Count | MD5 (first 8) | Production = clean build |
|---|---:|---|---|
| columns | 64 | `26e81ef7` | yes |
| constraints | 48 | `7543ae88` | yes |
| indexes | 26 | `de7101ff` | yes |
| migration ledger | 5 | `a683a514` | yes |
| policies | 12 | `9e43b24b` | yes |
| RLS flags | 12 | `1f24ba59` | yes |
| `stis_api` grants | 13 | `17def1bd` | yes |

There is **no schema drift**. One migration exists in the Supabase ledger outside the repository,
`harden_rls_auto_enable_execute`. It changes the platform function `public.rls_auto_enable`, not the `stis` schema (see
`MIGRATION_REPORT.md` §2).

## 5. Data-integrity checks on live data

Each check is a query that counts violating rows. All returned 0.

| # | Invariant | Violations |
|---:|---|---:|
| 1 | `record_state.draft` is the highest version of its record | 0 |
| 2 | `record_state.published` ≤ `record_state.draft` | 0 |
| 3 | Every `tourism_record` has a `record_state` row | 0 |
| 4 | Every `version_destination.destination_id` is a record of kind `destination` | 0 |
| 5 | No published version links to a destination that is not published | 0 |
| 6 | Every `record_activity (record_id, version)` exists in `record_version` | 0 |
| 7 | Every version has a `create` or `save` activity | 0 |
| 8 | No itinerary has both `owner_id` and `guest_digest` set | 0 |
| 9 | Every `itinerary_entry.day` lies within its itinerary's dates | 0 |
| 10 | No duplicate `position` within an itinerary | 0 |
| 11 | Every `record_version.payload` is a JSON object | 0 |
| 12 | Every `password_hash` uses the `scrypt$` format | 0 |
| 13 | At least one active administrator exists | 1 active (pass) |
| 14 | Existing data satisfies the proposed DB-04 date and time patterns | 0 |
| 15 | No itinerary is longer than 14 days or has more than 50 entries (application limits) | 0 |
| 16 | Destination IDs in each version's payload equal its `version_destination` rows | 0 of 85 links differ in either direction |
| 17 | No destination link targets a non-destination record (repeat of 4 by join) | 0 |
| 18 | No itinerary entry falls outside its trip (repeat of 9 by join) | 0 |

## 6. Requirement-to-table traceability

### 6.1 SRS tasks T1–T8

| Task | Tables (and columns) | Keys and constraints that support it | Application path |
|---|---|---|---|
| **T1 Explore Destinations** | `tourism_record` (kind `destination`), `record_version.payload`, `record_state.published`; `version_destination` for "related" records | `tourism_record_kind_check`; published pointer FK `(record_id, published)` → `record_version` | `GET /catalog/destination`, `/catalog/destination/:id/related` (`publishedLinkedTo`, `repositories.ts` l.40) |
| **T2 Find Accommodation** | `tourism_record` (kind `accommodation`), `record_version`, `record_state`, `version_destination` (one destination) | One destination is a domain rule (`domain.ts` l.162); link FK to `tourism_record` | `GET /catalog/accommodation` |
| **T3 Find Transportation** | `tourism_record` (kind `transportation`), `record_version`, `record_state`, `version_destination` | Same pattern; journeys are derived at read time | `GET /catalog/transportation`, `GET /journeys` |
| **T4 Find Dining** | `tourism_record` (kind `dining`), `record_version`, `record_state`, `version_destination` | Same pattern | `GET /catalog/dining` |
| **T5 Find Events** | `tourism_record` (kind `event`), `record_version` (status, start, end in payload), `record_state`, `version_destination` (hosting destination); `itinerary_entry (record_id, kind)` | Composite FK `itinerary_entry (record_id, kind)` → `tourism_record (id, kind)` guarantees a trip entry that says "event" is an event. Entries reference the record, not a version, so a postponement or cancellation reaches saved trips at the next read | `GET /catalog/event`; `services.ts` `assessEventDate` |
| **T6 Plan Itinerary** | `itinerary`, `itinerary_entry`, `account` (owner) | `itinerary_check1` (owner or guest); date checks; `itinerary_entry_check` (both times or neither, start < end); `revision` for optimistic locking; ON DELETE CASCADE from itinerary to entries | `/itineraries`, `/itineraries/:id` (`repositories.ts` l.151–230) |
| **T7 Find Visitor Information** | `tourism_record` (kind `visitor`), `record_version`, `record_state`, `version_destination` (none when `area = sarawak`) | `itinerary_entry_kind_check` excludes `visitor`, so guidance cannot be added to a trip | `GET /catalog/visitor` |
| **T8 Maintain Tourism Information** | `tourism_record`, `record_version`, `record_state`, `version_destination`, `record_activity`, `account` (role) | Immutable versions (PK `(record_id, version)`, INSERT-only grant); draft and published pointers; conditional publish; append-only activity | `/staff/records…` (`services.ts`, `repositories.ts` l.52–140) |

### 6.2 Full-system extensions

| Extension | Tables | Supporting design |
|---|---|---|
| Tourist accounts (register, sign in, sign out, profile, delete) | `account`, `account_session` | Unique lower-case e-mail; scrypt hash; session stored as SHA-256 digest with idle and absolute expiry; CASCADE removes sessions with the account |
| Account recovery | `recovery_code` | 10 codes of 80 bits each, stored as digests; PK `(account_id, code_digest)`; `used_at` marks single use |
| Brute-force protection | `auth_throttle` | Digest-keyed counters per e-mail and per client, with fixed windows (`accounts.ts` l.19–25) |
| Staff and administrator management | `account` (`role`, `status`) | Role and status CHECKs; last-active-administrator guard in the application |
| Multi-day itineraries | `itinerary.start_date`, `end_date`, `provisional`; `itinerary_entry.day`, `position` | Date-format CHECKs and `end_date >= start_date`; trip length (≤ 14 days) and entry count (≤ 50) checked by the API |
| Guest itineraries | `itinerary.guest_digest` | UNIQUE digest of a 256-bit token; CHECK requires owner or guest |
| Claiming a guest trip into an account | `itinerary.owner_id`, `guest_digest` | Single conditional UPDATE: `where guest_digest = $3 and owner_id is null` (`repositories.ts` l.224) |
| Read-only trip sharing | `itinerary.share_digest` | UNIQUE digest; the share lookup returns a view only. Edit paths use `accessClause`, which never consults `share_digest` |
| Calendar export (.ics) | none (derived) | Generated from the itinerary at request time (`server/calendar.ts`) |
| Versioned publication and rollback-safe publishing | `record_version`, `record_state` | Composite FKs from both pointers; conditional UPDATE inside a transaction |
| Audit history | `record_activity` | Identity PK, action CHECK, INSERT-only grant; actor kept as nullable FK (`SET NULL`) |
| Media library and credits | none | Held in code (`src/shared/media.ts`) and verified by `server/media.test.ts`; deliberately not in the database |
| Migration tracking | `schema_migration` | Infrastructure only; the API role can read it but not write it |

No table lacks a requirement, and no requirement needs a missing table.

## 7. Security review

### 7.1 Who can reach the data

| Principal | Access to `stis` | Verified by |
|---|---|---|
| Browser (any visitor) | None directly. All access goes through `/api/v1` on Vercel | Source: the client calls only `/api/v1`; there is no Supabase client library in `package.json` |
| Supabase Data API (`anon`, `authenticated`) | **None**: no USAGE on schema `stis`, and `stis` is not among the exposed schemas | `has_schema_privilege` = false; `authenticator` role configuration |
| `service_role` | None: has BYPASSRLS but no USAGE or table grants on `stis` | Catalog |
| `stis_api` (the application) | USAGE on `stis`; table grants as listed in §3; one `USING (true)` policy per table | Catalog |
| `postgres` (owner) | Full; used only for migrations and dashboard inspection | Catalog |

`stis_api` properties: LOGIN, not superuser, no BYPASSRLS, no CREATEROLE or CREATEDB, `rolinherit = false`, not a member of any
role, `statement_timeout = 10s`, no connection limit. Outside `stis` it can read or write no table. It can execute no SECURITY
DEFINER function, has CREATE on no schema, and has TEMP only through the default PUBLIC grant.

### 7.2 Is `USING (true)` justified?

**Yes, for this architecture, provided its meaning is stated precisely.** STIS has one database role for every request. The API
authenticates the caller (session cookie, guest token or share token) and then issues parameterised SQL as `stis_api`. PostgreSQL never
learns who the end user is, so a row-level policy has nothing to compare a row with. In this design RLS acts as a **role gate**: any
role other than `stis_api` and the owner sees no rows, even if it were later granted table privileges by mistake. It does **not**
isolate one tourist's rows from another's. That isolation is implemented in, and verified for, the API:

| Rule | Where it is enforced | Test evidence |
|---|---|---|
| A trip is read or changed only by its owner's session or the holder of its guest token | `accessClause` in every itinerary query (`repositories.ts` l.152, 165, 179, 196, 210); a miss returns 404 so trips cannot be enumerated | `http.test.ts` l.188 "guest itineraries require the matching guest credential"; `accounts.test.ts` l.140 ("another account cannot open it") |
| A share token gives a read-only view | Lookup by `share_digest` only in `loadShared` (`repositories.ts` l.170–173); no write path accepts it | `accounts.test.ts` l.201 "view-only link that never grants editing", l.233 |
| Claiming requires the guest token and an unowned trip | Conditional UPDATE (l.224–225) clears `guest_digest`, so the guest token no longer opens or claims the trip | `accounts.test.ts` l.140–154 (wrong token 404, no session 401, old guest link 404 after claim) |
| Only staff and administrators manage records | `ManagementAccessControl.check` (`services.ts` l.14–23): 401 without a session, 403 for tourists | `http.test.ts` l.165; browser journey step 25 |
| Only administrators manage staff | `requireRole(session, ["admin"])` (`accounts.ts`) | `accounts.test.ts` l.166 |
| Tokens and codes are never stored in clear text | SHA-256 digests (`digest()`); scrypt for passwords | Invariant 12; source |

**Residual risk (DB-01).** If the `stis_api` password leaked, the holder could read every account's e-mail address and scrypt
hash, and could read, change or delete itineraries, sessions and recovery codes. They **could not** alter or delete publication history
(`tourism_record`, `record_version`, `version_destination`, `record_activity` are INSERT-only), change the schema, or reach other
schemas. The credential is held only in Vercel's sensitive environment variables and `.env.local`; it was rotated on 24 Nov 2026
after a possible exposure during setup (`docs/full-system/hosting.md`). Per-user RLS would need
the API to set a verified identity on every transaction (for example `set_config('stis.account_id', …, true)`) and policies
written against it. That is a redesign with its own failure modes (connection pooling, forgotten `set_config`), so it is
not recommended now.

### 7.3 Credentials and tokens

| Secret | Generation | Stored as | Lifetime |
|---|---|---|---|
| Password | user-chosen; 10–200 characters, not equal to the e-mail address | `scrypt$N$r$p$salt$key`, N = 32768, r = 8, p = 1, 16-byte salt | until changed; `password_changed_at` recorded |
| Session | 32 random bytes | SHA-256 digest (`account_session.token_digest`) | tourist: 14 days idle, 30 days absolute; staff and admin: 30 minutes idle, 8 hours absolute |
| Recovery code | 16 random bytes → 16 characters in a 32-symbol alphabet (80 bits) | SHA-256 digest; single use | until used or regenerated |
| Guest and share tokens | 32 random bytes | SHA-256 digest (`guest_digest`, `share_digest`) | until claimed, revoked or the trip is deleted |
| Throttle keys | e-mail or client address | SHA-256 digest (`auth_throttle.key`) | fixed 15- or 60-minute windows |

## 8. Transactions and concurrency

| Operation | Mechanism | Verified behaviour |
|---|---|---|
| Save draft | `SELECT … FOR UPDATE OF s` on `record_state`; version must equal the client's expected version; new version inserted; PK `(record_id, version)` rejects a racing duplicate (23505 → 409) | `services.test.ts` l.228, l.651 |
| Publish | Transaction: each linked destination read `FOR SHARE` and must be published; then `UPDATE record_state SET published = $1 WHERE record_id = $2 AND draft = $1`; zero rows → 409 and rollback | `services.test.ts` l.161 "a database fault rolls back publication" |
| Withdraw | `FOR UPDATE` on the record's state; refused while any published record links to it. Serialises against publish, which holds `FOR SHARE` on the same row | `services.test.ts` l.194, l.581 |
| Update itinerary | `UPDATE … WHERE id = $1 AND <access> AND revision = $8`; entries replaced in the same transaction | `services.test.ts` l.90–110 (stale revision → 409) |
| Claim guest trip | One conditional UPDATE on `guest_digest = $3 AND owner_id IS NULL`; once claimed, the digest is null, so any later claim with the same token affects 0 rows (404) | `accounts.test.ts` l.140–154 |
| Account deletion | FKs: sessions, recovery codes and owned trips CASCADE; `author_id` and `actor_id` SET NULL. These actions run as the table owner, so they work even though `stis_api` cannot UPDATE history tables | `db.test.ts` (append-only test) |

## 9. Performance

* **Every foreign key has a covering index.** `itinerary_entry_record`, `record_activity_actor`, `record_state_draft`, `record_state_published` and
  `record_version_author` were added by migration `20261123120200` for this reason.
* The performance advisor reports two INFO notices, **unused index** on `itinerary_entry_record` and `record_state_draft`. Both
  cover composite foreign keys, so they are needed when a referenced row is deleted or its key checked. They are unused only because
  production traffic is small. **Keep them.**
* Hot paths are indexed: catalogue reads join `record_state` → `record_version` by primary key; trip lists use
  `itinerary_owner (owner_id, updated_at desc)`; entries use `itinerary_entry_plan (itinerary_id, position)`; history uses
  `record_activity_record (record_id, id)`.
* Measured hosted API latency (M9, `docs/full-system/verification.md`) was 84–170 ms, within the SRS 3-second target.
* Table sizes are small (< 300 rows each), so no partitioning or extra index is warranted.

## 10. Findings

Severity applies to the current production system. "Recommended" changes are not implemented in production.

| ID | Severity | Finding | Evidence | Recommendation | Status |
|---|---|---|---|---|---|
| DB-01 | **Medium** (residual design risk, not a defect) | RLS policies are `USING (true)`. They gate by role, not by row. Per-user isolation depends entirely on the API | §7.2; `20261123120100_api_role_access.sql` | Keep the design and document it (done). Keep the `stis_api` credential only in Vercel; rotate it on suspicion of exposure. Consider per-request identity policies only if direct database access is ever introduced | Documented |
| DB-02 | Low | `version_destination.destination_id` references `tourism_record(id)` but not its kind. The database would accept a link to an event | Constraint list §3.8; the application checks the kind on save (`repositories.ts` l.73–76) and publish (l.93–96); invariant 4 = 0 | Proposed migration adds a generated `destination_kind` column and a composite FK to `(id, kind)` | Tested; awaiting approval |
| DB-03 | Low | `record_activity.version` has no FK to `record_version`, so an entry could name a version that does not exist | §3.9; invariant 6 = 0 | Proposed migration adds FK `(record_id, version)` → `record_version` | Tested; awaiting approval |
| DB-04 | Low | Dates and times are `text`. The CHECK regex `^\d{4}-\d{2}-\d{2}$` accepts `2026-13-00`, and `start_time`/`end_time` have no format check | §3.10–3.11; the API validates with `validDate` and `readInterval` (`domain.ts` l.21, 67); invariant 14 = 0 | Proposed CHECKs restrict months, days and `HH:MM`. Changing the column types to `date`/`time` would also change the API's data contract, so it is not proposed | Tested; awaiting approval |
| DB-05 | Low | Expired `account_session` rows are purged only when that account next signs in (`accounts.ts` l.318). `auth_throttle` rows are never purged | Source; current volume 0 and 1 rows | Add a periodic cleanup (for example Supabase Cron calling a DELETE of expired rows, run by the owner) | Recommended |
| DB-06 | Low (audit attribution) | Staff and administrators can delete their own accounts (`deleteAccount`, `accounts.ts` l.239, guards only the last administrator). `author_id` and `actor_id` then become null, and the staff history shows "content import" (`Staff.tsx` l.275), which is also the label for the genuine import | Source; FK `SET NULL` | Either disable self-deletion for staff (disable instead, which `status` already supports) or label null actors "former staff member" when not from the import | Recommended (application change) |
| DB-07 | Low | scrypt N = 2^15 is below the OWASP Password Storage Cheat Sheet minimum (N = 2^17, r = 8, p = 1) | `accounts.ts` l.11 | Raise N to 2^17 and rehash on next sign-in; the stored hash records its parameters, so old hashes stay valid | Recommended (application change) |
| DB-08 | Info | (a) Two "unused index" notices (§9). (b) `stis_api` has no connection limit. (c) `stis_api` has TEMP through PUBLIC. (d) There are no default privileges, so each new table needs explicit grants and a policy in its migration. (e) The comment in `20261123120000_initial_schema.sql` says "the API role is the table owner", but the owner is `postgres` | Catalog; source | (a) keep; (b) optionally set a limit matching the pooler; (c) harmless; (d) follow the checklist in `DATABASE_DESIGN.md` §8; (e) recorded here; applied migrations are not edited | Documented |

No Critical or High finding was identified.

## 11. Not verified

* Supabase backup and point-in-time-recovery configuration was not exercised (no restore was performed against production).
* Behaviour under heavy concurrent load was not load-tested. Concurrency correctness rests on the locking design and the targeted tests in §8.
* The proposed migration was tested on PGlite and PostgreSQL 18.6, not on a Supabase branch (a branch incurs cost and was not needed for an additive change).
