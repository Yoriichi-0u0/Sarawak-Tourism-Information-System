# STIS migration report

**Database:** Supabase PostgreSQL 17.11, project `lblnltxpoaaqxbqrkoki` (ap-southeast-1), schema `stis`
**Report date:** 25 November 2026
**Changes applied to production in this audit:** none

## 1. Applied migrations (authoritative history)

The application's migration runner `migrate()` (`server/db.ts` l.58) applies each file in `supabase/migrations/` in filename order.
It runs each file in its own transaction and records the file name in `stis.schema_migration`. That table is the authoritative
ledger. Production lists exactly the five files in the repository:

| # | Version (file name) | Added in commit | Applied to production (UTC) | What it does |
|---:|---|---|---|---|
| 1 | `20261123120000_initial_schema` | `ce2f400` (M1) | 2026-11-23 12:39 | Creates schema `stis` and the 11 business tables, keys, CHECKs, indexes; enables RLS on every table |
| 2 | `20261123120100_api_role_access` | `9a9785b` | 2026-11-23 12:40 | Grants `stis_api` USAGE and DML, read-only on `schema_migration`, sequence use; creates one `stis_api_access` policy per table. Does nothing where the role is absent (PGlite) |
| 3 | `20261123120200_foreign_key_indexes` | `9a9785b` | 2026-11-23 12:41 | Adds five covering indexes for foreign keys flagged by the performance advisor |
| 4 | `20261124090000_append_only_history` | `179402a` (M9) | 2026-11-24 09:03 | Revokes UPDATE and DELETE on the four history tables from `stis_api` |
| 5 | `20261124100000_itinerary_share_links` | `179402a` (M9) | 2026-11-24 09:12 | Adds `itinerary.share_digest` (UNIQUE) for read-only share links |

`schema_migration` itself is created by `migrate()` before the first file runs (`server/db.ts` l.59–61).

Each migration file and each rollback file has exactly one commit (`git log -- <file>`). **No applied migration has been edited
after it was applied.**

## 2. Supabase's own migration ledger

`supabase_migrations.schema_migrations` holds a different, partial record. It lists only changes made through the Supabase
`apply_migration` tool:

| Version | Name | Relation to the repository |
|---|---|---|
| `20261124090203` | `harden_rls_auto_enable_execute` | **Not a STIS migration.** It revokes EXECUTE on the platform function `public.rls_auto_enable()` from `public`, `anon` and `authenticated`, which resolved a security-advisor warning (`docs/full-system/hosting.md`). It touches nothing in `stis` |
| `20261124090317` | `stis_20261124090000_append_only_history` | Same SQL as repository migration 4 |
| `20261124091201` | `stis_20261124100000_itinerary_share_links` | Same SQL as repository migration 5 |

Migrations 1–3 were applied as SQL with ledger inserts and therefore do not appear in Supabase's ledger. That is expected:
`stis.schema_migration` is the ledger the application reads. The fingerprint in §3 shows the result is identical either way.

## 3. Drift check: production versus a clean build

**Procedure** (query file: `scripts/database/fingerprint.sql`).

1. Start an empty PostgreSQL 18.6 server, create role `stis_api` (NOLOGIN) so the role-dependent migrations take effect, and
   create database `stis_clean`.
2. Run the application's own `migrate()` against it, which applied all five files.
3. Run the query below on the clean database and, read-only, on production.
4. Compare count and MD5 per category.

```sql
with items as (
  select 'columns' as k, table_name || '.' || column_name || '|' || data_type || '|' || is_nullable || '|' || coalesce(column_default, '') || '|' || is_identity || '|' || coalesce(identity_generation, '') as v from information_schema.columns where table_schema = 'stis'
  union all select 'constraints', conrelid::regclass::text || '.' || conname || '|' || pg_get_constraintdef(oid) from pg_constraint where connamespace = 'stis'::regnamespace and contype <> 'n'
  union all select 'indexes', indexname || '|' || indexdef from pg_indexes where schemaname = 'stis'
  union all select 'policies', tablename || '.' || policyname || '|' || cmd || '|' || permissive || '|' || array_to_string(roles, ',') || '|' || coalesce(qual, '') || '|' || coalesce(with_check, '') from pg_policies where schemaname = 'stis'
  union all select 'rls', relname || '|' || relrowsecurity::text || '|' || relforcerowsecurity::text from pg_class where relnamespace = 'stis'::regnamespace and relkind = 'r'
  union all select 'triggers', tgrelid::regclass::text || '.' || tgname from pg_trigger where not tgisinternal and tgrelid in (select oid from pg_class where relnamespace = 'stis'::regnamespace)
  union all select 'stis_api_grants', c.relname || '|' || string_agg(a.privilege_type, ',' order by a.privilege_type) from pg_class c cross join lateral aclexplode(c.relacl) a join pg_roles r on r.oid = a.grantee and r.rolname = 'stis_api' where c.relnamespace = 'stis'::regnamespace and c.relkind in ('r','S') group by c.relname
  union all select 'migrations', version from stis.schema_migration
)
select k, count(*)::int as n, md5(string_agg(v, E'\n' order by v)) as hash from items group by k order by k;
```

`contype <> 'n'` excludes the NOT NULL catalog constraints that PostgreSQL 18 records and PostgreSQL 17 does not.
`scripts/database/fingerprint.sql` also has a `functions` category, added with proposal revision 2. A category with no rows
produces no output line, so today's production and clean-build results are unchanged by it.
Nullability is compared in the `columns` category.

**Result.**

| Category | Count | MD5 (clean build) | Production |
|---|---:|---|---|
| columns | 64 | `26e81ef730da8f8fdbcb2aea726450ea` | identical |
| constraints | 48 | `7543ae88c1963d152a6bf2da323e8cab` | identical |
| indexes | 26 | `de7101ffa06a48c86cc7d33fc54e15d3` | identical |
| migrations | 5 | `a683a51441338cd7653a03adbb5ffd6d` | identical |
| policies | 12 | `9e43b24b325ef654df0f4b587f85d306` | identical |
| rls | 12 | `1f24ba5959eb0ff9e189b9ea114f07f4` | identical |
| stis_api_grants | 13 | `17def1bd73bb037236d5129ba8d19836` | identical |
| triggers | 0 | — | 0 on both |

**Repeated on PostgreSQL 17.12** (production's major version) during the DB-04 correction: a clean `migrate()` build gave the
same seven hashes (`evidence/fingerprint-clean-pg17.txt`).

**Conclusion: the live schema is exactly the checked-in migration history. There is no drift.** The catalog export of the clean
build is `docs/database/schema-snapshot.json`, and the diagrams are generated from it.

## 4. Rollback approach for the applied migrations

Each migration has a reverse script in `supabase/rollback/<version>.down.sql`. The test `db.test.ts` ("every migration has a
rollback, and up → down → up leaves an identical schema") runs in CI (`.github/workflows/ci.yml`) on PGlite and on a PostgreSQL 17 service.

| Migration | Rollback effect | Data impact |
|---|---|---|
| 5 share links | Drops `share_digest` | Existing share links stop working; no trip content lost |
| 4 append-only | Re-grants UPDATE and DELETE on history tables | None, but weakens security; not recommended |
| 3 FK indexes | Drops five indexes | None |
| 2 API role access | Drops policies and revokes grants | **Takes the application offline** |
| 1 initial schema | Drops schema `stis` | **Destroys all STIS data.** Owner approval and a verified backup required |

Before any rollback on production, take a Supabase backup or a `pg_dump --schema=stis`, and delete the version from
`stis.schema_migration` in the same transaction as the down script (`server/db.ts` l.78 does this locally).

## 5. Proposed migration (tested, not applied)

### 5.1 Summary

| | |
|---|---|
| Files | `supabase/proposed/20261125090000_integrity_hardening.sql` and `.down.sql` (revision 2) |
| Addresses | DB-02 (destination links must target destinations), DB-03 (history entries must name existing versions), DB-04 (Gregorian calendar dates; `HH:MM` times) |
| Objects added | One stored generated column (`version_destination.destination_kind`, always `'destination'`), two composite foreign keys, two indexes, one function (`stis.is_calendar_date(text)`), three CHECKs. No existing row is modified or removed |
| Live-data check | Run read-only on production, 25 Nov 2026, with the revision 2 rules: 0 existing rows would be rejected (audit invariants 4, 6, 14) |
| Application compatibility | The API never names `destination_kind`, and its inserts list their columns explicitly. One application change accompanies revision 2: `validDate` (`server/domain.ts`) now also rejects year `0000`, so the API answers 400 where the database would otherwise reject a request with an error. That change is safe to ship with or without the migration |
| Why it is not loaded automatically | It lives outside `supabase/migrations/`, so `migrate()` ignores it, and production stays identical to the clean build until approval |

### 5.2 Revision history

| Revision | Date | Change |
|---|---|---|
| 1 | 25 Nov 2026 | First proposal. **Defective:** the DB-04 regex `^\d{4}-(0[1-9]\|1[0-2])-(0[1-9]\|[12]\d\|3[01])$` checks month and day ranges independently. It accepts `2026-02-31`, `2026-04-31`, `2025-02-29` and `0000-01-01`. An independent review found this and confirmed it with a read-only query on production. Its lock description was also wrong (see §5.4) |
| 2 | 25 Nov 2026 | DB-04 uses `stis.is_calendar_date(text)`, a real Gregorian check: month-specific day limits, the 4/100/400 leap-year rule, years 0001–9999, ASCII digits only. Lock behaviour measured and documented. `lock_timeout` added. DB-02 and DB-03 unchanged apart from dropping the `NOT VALID`/`VALIDATE` split, which had no effect inside one transaction |

### 5.3 The DB-04 calendar rule

`stis.is_calendar_date(value text)` returns true only for a `YYYY-MM-DD` string that names a real day in the proleptic Gregorian
calendar from 0001-01-01 to 9999-12-31. The storage type stays `text`, so the API contract and existing rows are unchanged.

* **Leap years:** February has 29 days when the year is divisible by 400, or divisible by 4 but not by 100. 2000 and 2400 are leap
  years; 1900 and 2100 are not.
* **Day limits:** April, June, September and November have 30 days.
* **No year zero.** The Gregorian calendar has none. PostgreSQL's `date` type rejects `0000-01-01`, and `validDate` now does too.
* **ASCII digits only.** The pattern uses `[0-9]`, not `\d`. Other Unicode digits (for example Arabic-Indic `٢٠٢٦`) return false
  instead of raising a cast error.
* **It never raises.** Any string the pattern does not match is simply not a date, so a bad row fails the CHECK with SQLSTATE 23514.
* **Function properties:** `IMMUTABLE STRICT PARALLEL SAFE` (pure text arithmetic), `SET search_path = ''` (no search-path
  hijacking; satisfies the Supabase advisor's mutable-search-path lint). EXECUTE is revoked from PUBLIC and granted to `stis_api`.
  PostgreSQL checks EXECUTE on functions called by a CHECK as the inserting role, so the grant is required, and a test covers it.

It is used by `itinerary_calendar_dates` (both trip dates) and `itinerary_entry_calendar_day`. `itinerary_entry_time_format`
keeps the `HH:MM` check, now with `[0-9]` instead of `\d`.

**Independent check against PostgreSQL's date parser** (PostgreSQL 17.12, `evidence/pg17-calendar-oracle.txt`): every string
`YYYY-MM-DD` for years 0000–9999, months 00–13 and days 00–32 (4,620,000 candidates) was evaluated by `stis.is_calendar_date` and by
`pg_input_is_valid(v, 'date')`.

| Candidates | Accepted by `is_calendar_date` | Accepted by PostgreSQL's parser | Disagreements | Leap days accepted |
|---:|---:|---:|---:|---:|
| 4,620,000 | 3,652,059 | 3,652,059 | **0** | 2,424 |

3,652,059 is the exact number of days from 0001-01-01 to 9999-12-31, and 2,424 is the exact number of Gregorian leap years in 1–9999.
The test suite also checks that the database and the API's `validDate` agree on about 6,500 candidates, including malformed and
non-ASCII strings.

### 5.4 Locking and table rewrite (corrected)

Revision 1 claimed that adding constraints `NOT VALID` and then validating them checks existing rows "under a weaker lock". That is
wrong for this migration. `migrate()` runs each file as **one transaction**, and PostgreSQL holds every lock until COMMIT, so
splitting a constraint into ADD and VALIDATE inside the same transaction does not shorten or weaken any lock. Revision 1 also
understated the generated column: `ADD COLUMN … GENERATED ALWAYS AS … STORED` **rewrites the whole table** under an
`ACCESS EXCLUSIVE` lock.

Measured on PostgreSQL 17.12 and repeated on 18.6 with identical results (`evidence/pg17-proposal-verification.txt`). The locks
held by the migration transaction immediately before COMMIT were read from `pg_locks` on a second connection:

| Table | Strongest lock held until COMMIT | Cause | Other sessions meanwhile |
|---|---|---|---|
| `version_destination` | ACCESS EXCLUSIVE | ADD COLUMN … STORED (table rewritten: new `relfilenode`) | Reads **wait** (catalogue "related" lookups, withdrawal checks) |
| `itinerary` | ACCESS EXCLUSIVE | ADD CHECK | Reads and writes **wait** (every trip page) |
| `itinerary_entry` | ACCESS EXCLUSIVE | ADD CHECK | Reads and writes **wait** |
| `record_activity` | SHARE ROW EXCLUSIVE | ADD FOREIGN KEY | Reads proceed; inserts wait |
| `record_version` | SHARE ROW EXCLUSIVE | referenced by the new FK | Reads proceed; **inserts wait** (staff saves) |
| `tourism_record` | SHARE ROW EXCLUSIVE | referenced by the new FK | Reads proceed; inserts wait |

Only `version_destination` is rewritten; the other tables keep their files. The rollback drops the column as a catalog-only change
(no rewrite).

**Duration** (time from BEGIN to COMMIT, so also the time other sessions wait):

| Database | Apply | Rollback |
|---|---:|---:|
| Application seed (14 records, 6 links, 1 trip), PostgreSQL 17.12 | 4 ms | 2 ms |
| Same, PostgreSQL 18.6 | 6 ms | 2 ms |
| Synthetic: 100,000 links, 100,001 history rows, 10,000 trips and stops, PostgreSQL 17.12 | 1,219 ms | 2 ms |
| Same, PostgreSQL 18.6 | 1,099 ms | 2 ms |

Production (85 links, 257 history rows, 1 trip on 25 Nov 2026) is between the first two rows and the scaled row, so the expected
blocking window is a few milliseconds. The risk is not the migration's own duration but **lock queueing**. If a long transaction
already holds a lock on one of these tables, the migration waits for it, and every later request on that table queues behind the
migration's pending ACCESS EXCLUSIVE request. Revision 2 therefore starts with `set local lock_timeout = '3s'`. If it cannot get a
lock within 3 seconds it fails and rolls back cleanly, and it can simply be retried.

If the tables grow large enough for a rewrite to matter, there are two lighter options:
* replace the generated column with a plain column `default 'destination'` plus `CHECK (destination_kind = 'destination')`, which
  PostgreSQL adds without a rewrite;
* split the constraints into separate `NOT VALID` and `VALIDATE` transactions, which is where that technique actually reduces locking.

Neither is needed at current sizes.

### 5.5 Tests

Tests in `server/proposed.test.ts`, run by `npm test` (PGlite) and `npm run test:postgres`:

1. The migration applies on top of the five migrations and rolls back to an identical catalog. The comparison now includes
   functions and their privileges.
2. The hardened database rejects, with SQLSTATE 23503, a destination link to an event and a history entry for a missing version.
   With SQLSTATE 23514 it rejects:
   * the impossible dates `2026-02-31`, `2026-04-31`, `2025-02-29`, `0000-01-01`, `1900-02-29`, `2100-02-29`, the 31st of every
     30-day month, month 00 or 13, day 00 or 32;
   * non-ASCII digits, a trailing newline, `+2026-01-01`, `2026-1-01`, `20260101` and the empty string;
   * these as a trip start, a trip end and a stop day;
   * the bad times `9:00`, `24:00` and `09:60`.

   It accepts `2024-02-29`, `2000-02-29`, `2400-02-29`, `2028-02-29`, `0001-01-01` and `9999-12-31`, plus valid and blank times.
3. The database and the API's `validDate` give the same answer for 6,500+ candidates (16 years including 0000, 0001, 1900, 2000,
   2100, 2400 and 9999; months 00–13; days 00–32). The yearly counts match the Gregorian calendar.
4. As `stis_api`, a leap-day trip is stored and impossible dates are rejected through the CHECK. `stis_api` can execute the
   function, and a role without the grant cannot.
5. The publication, history and itinerary workflows still pass unchanged on the hardened schema.

`server/services.test.ts` adds an API test. Trips starting in year 0000, or ending on 2026-02-31, 2025-02-29 or 2100-02-29,
are refused with the API's 400 input error. Trips on 2028-02-29, 2000-02-29 and 0001-01-01 are created.

**Failing first.** Before revision 2, the new tests failed. Three of the five proposal tests failed; the first failure was
`Missing expected rejection: start date "2026-02-31"`. The API test failed with `Missing expected rejection: 0000-01-01`
(`logs/db04-failing-first.log`). After the correction, all pass on PGlite (PostgreSQL 19.0 in WebAssembly), PostgreSQL 17.12
and PostgreSQL 18.6.

### 5.6 Steps to adopt (after owner approval)

1. Move the `.sql` file to `supabase/migrations/` and the `.down.sql` file to `supabase/rollback/`. Ship the `validDate` change
   (already on this branch) first or together.
2. `npm test` and `npm run test:postgres` must pass.
3. Take a backup. Choose a quiet period. In one transaction on production, run the SQL (it sets its own `lock_timeout`) and
   `insert into stis.schema_migration(version) values ('20261125090000_integrity_hardening')`. If it fails with 55P03 (lock
   timeout), nothing was changed; retry later.
4. Re-run `scripts/database/fingerprint.sql`. Expect columns 64 → 65, constraints 48 → 53, indexes 26 → 28, a new
   `functions` category with 1 row, and migrations 5 → 6. The other categories are unchanged. The verification run produced
   these exact hashes for the first four (`evidence/pg17-proposal-verification.txt`).
5. Run `scripts/database/invariants.sql`, both Supabase advisors, and the hosted smoke checks in `FINAL_VERIFICATION.md` §4.
   Regenerate `schema-snapshot.json` and the diagrams.

**Rollback:** the `.down.sql` drops exactly the added objects, including the function, and sets the same `lock_timeout`. The
dropped column is derived, so no information is lost. Verified twice per server: apply → rollback → apply → rollback, with the
fingerprint identical to the starting state after each rollback.
