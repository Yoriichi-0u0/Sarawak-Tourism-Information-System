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

**Procedure.**

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

| | |
|---|---|
| Files | `supabase/proposed/20261125090000_integrity_hardening.sql` and `.down.sql` |
| Addresses | DB-02 (destination links must target destinations), DB-03 (history entries must name existing versions), DB-04 (calendar-valid dates, `HH:MM` times) |
| Nature | Additive. One stored generated column (`version_destination.destination_kind`, always `'destination'`), two composite foreign keys, two indexes, three CHECKs. No row is modified or removed |
| Lock strategy | Constraints are added `NOT VALID` and then `VALIDATE`d, so existing rows are checked under a weaker lock. The generated column rewrites `version_destination` (85 rows), which takes well under a second at this size |
| Live-data check | Run read-only on production, 25 Nov 2026: 0 existing rows would be rejected (audit invariants 4, 6, 14) |
| Application compatibility | No application change needed. The API never names `destination_kind`, and inserts list their columns explicitly |
| Why not loaded automatically | It lives outside `supabase/migrations/`, so `migrate()` ignores it, which keeps production and the clean build identical until approval |

**Tests** (`server/proposed.test.ts`, also listed in `npm test` and `npm run test:postgres`):

1. Applies on top of the five migrations and rolls back to a schema identical to before (catalog comparison).
2. The hardened database itself rejects: a destination link to an event and a history entry for a missing version (SQLSTATE 23503);
   trip dates in month 13, on day 00 or on day 32; and stop times `9:00`, `24:00` and `09:60` (SQLSTATE 23514). Valid times
   and blank times are still accepted.
3. The publication, history and itinerary workflows still pass unchanged on the hardened schema.

These tests were written first and failed (ENOENT, the files did not yet exist; log kept in the review package) before the files were
added. They now pass on PGlite and on PostgreSQL 18.6. In a separate manual check as `stis_api` on the hardened local database,
inserts succeed, UPDATE on history is still refused, and bad links or versions fail with 23503.

**Steps to adopt (after owner approval):**

1. Move the `.sql` file to `supabase/migrations/` and the `.down.sql` file to `supabase/rollback/`.
2. `npm test` and `npm run test:postgres` must pass.
3. Take a backup. In one transaction on production, run the SQL and
   `insert into stis.schema_migration(version) values ('20261125090000_integrity_hardening')`.
4. Re-run the §3 fingerprint. Expect constraints 48 → 53, indexes 26 → 28, columns 64 → 65, migrations 5 → 6.
   Regenerate `schema-snapshot.json` and the diagrams.
5. Run both Supabase advisors and the hosted smoke checks in `FINAL_VERIFICATION.md` §4.

**Rollback:** the `.down.sql` drops exactly the added objects. The dropped column is derived, so no information is lost.
