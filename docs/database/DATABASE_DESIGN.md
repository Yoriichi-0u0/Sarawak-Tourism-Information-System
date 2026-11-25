# STIS database design (full-system release, PostgreSQL)

This document explains the verified design of schema `stis` on Supabase PostgreSQL 17.11: what each table is for, how the
tables relate, and why. The structure was checked against production on 25 November 2026 (`DATABASE_AUDIT.md` §4). The
diagrams in `DATABASE_ERD.drawio` are generated from the same catalog snapshot.

## 1. Two separate database designs

| | AS03 assessment build | Full-system release (this document) |
|---|---|---|
| Purpose | Coursework submission for SWE30003 AS03 (four tasks: T1, T5, T6, T8) | Public product covering T1–T8, accounts, staff management and the full trip lifecycle |
| Engine | SQLite through Node.js | PostgreSQL 17 on Supabase (Singapore); PGlite and PostgreSQL in tests |
| Source | Branch `codex/as03-system`, verified release `644443f` | Branch `main` |
| Documentation | AS03 report and its diagrams (unchanged) | `docs/database/` |

The two must not be mixed. Nothing in this folder describes, or should be copied into, the AS03 report.

## 2. Subject areas and table purposes

| Area | Table | Purpose | One row is… |
|---|---|---|---|
| Authentication | `account` | Tourists, staff and administrators | a person who can sign in |
| | `account_session` | Signed-in sessions with idle and absolute expiry | one browser session (stored as a token digest) |
| | `recovery_code` | Single-use codes that reset a forgotten password | one recovery code (digest) |
| | `auth_throttle` | Failed-attempt counters for sign-in and recovery | one throttled e-mail or client in its current window |
| Tourism information | `tourism_record` | Stable identity and category of every catalogue item | one destination, event, stay, transport option, place to eat or visitor guide |
| Publication and history | `record_version` | Immutable content snapshots | one saved version of one record |
| | `record_state` | Which version is the draft and which (if any) is public | the current state of one record |
| | `version_destination` | Destinations a version is linked to | one link from a version to a destination |
| | `record_activity` | Append-only audit trail | one create, save, publish or withdraw action |
| Itinerary | `itinerary` | A trip, owned by an account or held by a guest | one trip |
| | `itinerary_entry` | A planned stop on a day of a trip | one stop |
| Infrastructure | `schema_migration` | Migrations applied by `migrate()` | one applied migration |

`schema_migration` is infrastructure, not business data. The diagrams draw it apart, with a dashed border.

## 3. Relationships

All 14 foreign keys, with the cardinality the constraints enforce. "Parent side" reads: how many parents each child row has.
"Child side" reads: how many child rows a parent can have.

| # | Child → parent | Columns | Parent side | Child side | ON DELETE |
|---:|---|---|---|---|---|
| 1 | `account_session` → `account` | `account_id` → `id` | exactly 1 | 0..* | CASCADE |
| 2 | `recovery_code` → `account` | `account_id` → `id` | exactly 1 | 0..* (10 issued at a time) | CASCADE |
| 3 | `itinerary` → `account` | `owner_id` → `id` | 0..1 (guest trips have none) | 0..* | CASCADE |
| 4 | `itinerary_entry` → `itinerary` | `itinerary_id` → `id` | exactly 1 | 0..* (≤ 50, API rule) | CASCADE |
| 5 | `itinerary_entry` → `tourism_record` | `(record_id, kind)` → `(id, kind)` | exactly 1 | 0..* | NO ACTION |
| 6 | `record_version` → `tourism_record` | `record_id` → `id` | exactly 1 | 1..* in practice (version 1 is written in the same transaction); 0..* as far as the constraint goes | NO ACTION |
| 7 | `record_version` → `account` | `author_id` → `id` | 0..1 (null for the content import or a deleted account) | 0..* | SET NULL |
| 8 | `record_state` → `tourism_record` | `record_id` → `id` (also the PK) | exactly 1 | 0..1 by constraint; exactly 1 in practice (audit invariant 3) | NO ACTION |
| 9 | `record_state` → `record_version` (draft) | `(record_id, draft)` → `(record_id, version)` | exactly 1 | 0..1 | NO ACTION |
| 10 | `record_state` → `record_version` (published) | `(record_id, published)` → `(record_id, version)` | 0..1 (null = not public) | 0..1 | NO ACTION |
| 11 | `version_destination` → `record_version` | `(record_id, version)` → `(record_id, version)` | exactly 1 | 0..* | NO ACTION |
| 12 | `version_destination` → `tourism_record` (destination) | `destination_id` → `id` | exactly 1 | 0..* | NO ACTION |
| 13 | `record_activity` → `tourism_record` | `record_id` → `id` | exactly 1 | 1..* in practice | NO ACTION |
| 14 | `record_activity` → `account` | `actor_id` → `id` | 0..1 | 0..* | SET NULL |

Delete behaviour follows ownership. Deleting an account removes what belongs only to that person (sessions, recovery codes, owned
trips and their stops). Authorship of shared content is kept, with the name removed (`SET NULL`). Tourism records are never deleted:
the API role has no DELETE privilege on them, and withdrawal clears `record_state.published` instead. So `NO ACTION` on the
tourism side is never triggered in normal operation. A saved trip keeps a withdrawn stop and shows it as unavailable
(`services.ts` l.189).

## 4. Normalisation decisions

The relational tables are in third normal form. Three deliberate departures are each controlled by a constraint or a transaction.

1. **Versioned JSONB payload.** The six categories have different fields (an event has a start and status, a stay has amenities, a
   transport option has a route). Each saved version stores its fields as one JSONB object in `record_version.payload`. Validation
   of those fields belongs to the category classes in `server/domain.ts`, which keeps the AS02 design's per-category
   responsibilities. The cost is that field rules are not database constraints; the database guarantees only that the payload exists.
   Every payload is a JSON object (audit invariant 11).
2. **Identity, content and state are separated.** `tourism_record` (who/what, never changes), `record_version` (immutable content) and
   `record_state` (two pointers) mean:
   * a draft can be edited without touching the public version (draft/published isolation);
   * publishing is one conditional UPDATE of one row, so it is atomic and can be rolled back;
   * history is never overwritten, which makes INSERT-only grants possible.
3. **Controlled redundancy, kept consistent:**
   * `version_destination` repeats the payload's `destinationIds`. The payload is the exact snapshot staff saved. The table makes the
     links enforceable (FK) and indexable, for "related records" and the withdrawal check. Both are written from one normalised list
     in the same transaction (`repositories.ts` l.69–77). On production the two agree for all 85 links (audit invariant 16).
   * `itinerary_entry.kind` repeats `tourism_record.kind`. The composite FK `(record_id, kind)` → `(id, kind)` makes divergence
     impossible, and lets a CHECK forbid adding visitor guidance to a trip. `kind` cannot change after creation, because the API
     role cannot UPDATE `tourism_record` and the service rejects a category change (422).

Further decisions:

* **Trip stops reference the record, not a version.** A postponed or cancelled event therefore shows its current published state in every
  saved trip (T5 "change after adding"); the planned day and times stay as the tourist chose them.
* **Calendar dates are `text` (`YYYY-MM-DD`)** and times are `HH:MM` text. They are local Kuching calendar values with no time zone,
  and the API contract exchanges them in that form. The database currently checks only the shape (`YYYY-MM-DD`), which is finding
  DB-04; the proposed revision 2 adds a Gregorian calendar check without changing the type.
* **Secrets are stored only as digests.** Session, guest, share and recovery tokens are stored as SHA-256 digests; passwords as scrypt hashes. A
  database read never yields a usable credential.
* **`auth_throttle` has no foreign key.** It counts attempts for e-mail addresses that may not be registered, and for client addresses.
* **No soft-delete flags.** Withdrawal is a state pointer; account removal is a real delete with the cascades above.

## 5. Constraints

48 constraints: 12 primary keys, 14 foreign keys, 4 unique constraints and 18 CHECKs. The complete list, with definitions, is in
`DATABASE_AUDIT.md` §3. The rules they carry:

| Rule | Constraint(s) |
|---|---|
| E-mail is unique, stored in lower case, 3–254 characters | `account_email_key`, `account_email_check` |
| Roles are `tourist`, `staff`, `admin`; status is `active` or `disabled` | `account_role_check`, `account_status_check` |
| Record IDs are URL-safe (1–100 of `[A-Za-z0-9_-]`); six categories | `tourism_record_id_check`, `tourism_record_kind_check` |
| A record's kind can be referenced together with its ID | `tourism_record_id_kind_key` UNIQUE `(id, kind)` |
| Versions start at 1 and never repeat | `record_version_version_check`, PK `(record_id, version)` |
| Draft and published pointers name real versions of the same record | composite FKs 9 and 10 |
| Audit actions are `create`, `save`, `publish`, `withdraw` | `record_activity_action_check` |
| A trip belongs to an account or a guest | `itinerary_check1` |
| Trip dates are `YYYY-MM-DD` and the end is not before the start | `itinerary_start_date_check`, `itinerary_check` |
| Titles 1–120 characters; revision ≥ 1; guest and share digests unique | `itinerary_title_check`, `itinerary_revision_check`, two UNIQUEs |
| A stop has both times or neither, with start before end; note ≤ 500 characters; visitor guidance cannot be a stop | `itinerary_entry_check`, `itinerary_entry_note_check`, `itinerary_entry_kind_check` |

Rules that need several rows or other tables are enforced by the API in a transaction: a stop's day within its trip; trip length ≤ 14
days; ≤ 50 stops; destination links point at destinations; links point at published destinations when publishing; at least one active
administrator. All held on production (audit §5).

## 6. Indexes

26 indexes. 16 support primary keys and unique constraints. The other 10 serve foreign keys and read paths:

| Index | Columns | Serves |
|---|---|---|
| `account_session_account` | `account_id` | FK 1; ending all sessions of an account |
| `record_version_author` | `author_id` | FK 7 (`SET NULL` on account deletion) |
| `record_state_draft` | `(record_id, draft)` | FK 9 |
| `record_state_published` | `(record_id, published)` | FK 10; published-catalogue joins |
| `version_destination_target` | `destination_id` | FK 12; "related" lookup; withdrawal check |
| `record_activity_actor` | `actor_id` | FK 14 |
| `record_activity_record` | `(record_id, id)` | FK 13; history in order |
| `itinerary_owner` | `(owner_id, updated_at desc)` | FK 3; "My trips" list, newest first |
| `itinerary_entry_plan` | `(itinerary_id, position)` | FK 4; stops in order |
| `itinerary_entry_record` | `(record_id, kind)` | FK 5 |

FK 2 (`recovery_code.account_id`), FK 6 (`record_version.record_id`) and FK 11 (`version_destination (record_id, version)`) are
covered by the leading columns of their tables' primary keys.

## 7. Transactions and concurrency

* **Optimistic concurrency for editors.** Staff drafts carry the version they started from; trips carry `revision`. A stale write
  gets HTTP 409 and the interface offers recovery.
* **Short pessimistic locks where two writers meet.** Saving locks the record's state row (`FOR UPDATE`). Publishing reads each linked
  destination `FOR SHARE`, and withdrawing a destination takes `FOR UPDATE`, so a destination cannot be withdrawn while a record that
  links to it is being published.
* **Single-statement guards.** `UPDATE … WHERE draft = $1` (publish), `… AND revision = $n` (trip update) and
  `… AND guest_digest = $3 AND owner_id IS NULL` (claim) succeed for exactly one writer.

Details and test references: `DATABASE_AUDIT.md` §8.

## 8. Security model

```
Browser ──HTTPS──▶ /api/v1 (Vercel function) ──one role: stis_api──▶ schema stis
                    authenticates the caller;           grants + RLS role gate
                    decides what they may see
Supabase Data API (anon, authenticated) ──✕ no USAGE on stis
postgres (owner) ── migrations and inspection only
```

* **Authorisation is the API's job.** Every itinerary query includes the owner-or-guest `accessClause`; staff routes pass
  `ManagementAccessControl`; administrator routes require the `admin` role.
* **RLS is a role gate.** Each table has `stis_api_access FOR ALL TO stis_api USING (true) WITH CHECK (true)`. Another role that
  was granted table privileges by mistake would still see no rows. Per-user row isolation is not attempted in the database
  (finding DB-01).
* **Least privilege for the API role.** It can only SELECT and INSERT publication history; it can only read `schema_migration`; it has no
  CREATE privilege, does not own the tables, and cannot bypass RLS.
* **Not exposed through the Data API.** `stis` is not in the exposed schemas, and `anon` and `authenticated` have no USAGE on it.

### Checklist for any future table in `stis`

There are no default privileges, so a new table is invisible to the application until its migration does all of the following:

1. Create the table in `stis` and `enable row level security`.
2. Inside the existing `if exists (select 1 from pg_roles where rolname = 'stis_api')` guard, grant only the privileges needed and create
   policy `stis_api_access … to stis_api`.
3. Index every foreign key.
4. Add the matching `supabase/rollback/<version>.down.sql`. `db.test.ts` checks up → down → up.
5. Refresh `schema-snapshot.json` and regenerate the diagrams (`python3 -I scripts/database/erd.py`, then
   `scripts/database/render-erd.mjs`). Re-run the fingerprint comparison in `MIGRATION_REPORT.md` §3.

## 9. Diagrams

`DATABASE_ERD.drawio` (editable, four pages) with SVG and PNG exports:

| Page | File stem | Content |
|---|---|---|
| 1 | `DATABASE_ERD-1-conceptual` | Conceptual model: entities and named relationships, without columns |
| 2 | `DATABASE_ERD-2-physical-accounts-itineraries` | Physical design: authentication and itinerary tables, all columns, keys and nullability |
| 3 | `DATABASE_ERD-3-physical-tourism-publication` | Physical design: tourism records, versions, state, links, activity and `schema_migration` |
| 4 | `DATABASE_ERD-4-access-security` | Roles, grants and the request path |

The physical pages are generated from `schema-snapshot.json`. The generator fails unless all 12 tables and all 14 foreign keys
are drawn. PNGs are rendered at 2× for print (A4 landscape or A3).

## 10. Proposed, not applied

`supabase/proposed/20261125090000_integrity_hardening.sql` (revision 2) moves three application rules into the database (DB-02, DB-03, DB-04).
DB-04 adds one immutable helper function, `stis.is_calendar_date(text)`, executable only by `stis_api`. It would be the first function
in `stis`, so the future-table checklist in §8 applies to it as well: explicit EXECUTE grants, and `SET search_path`.
It is additive, validated against the live data (0 rows rejected), and tested on PGlite, PostgreSQL 17.12 and 18.6. It awaits owner approval;
see `MIGRATION_REPORT.md` §5.
