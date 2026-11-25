# Proposed migrations (not applied)

Files here are **not** loaded by `migrate()` and are **not** applied to production. They are tested by
`server/proposed.test.ts` on PGlite and on PostgreSQL. To adopt one after owner approval:

1. Move the `.sql` file to `supabase/migrations/` and the `.down.sql` file to `supabase/rollback/` (same file names).
2. Run `npm test` and `npm run test:postgres`.
3. Apply the SQL to Supabase and insert its version into `stis.schema_migration` in the same transaction
   (see `docs/full-system/hosting.md`), then re-run the fingerprint check in `docs/database/MIGRATION_REPORT.md`.

| File | Purpose | Status |
|---|---|---|
| `20261125090000_integrity_hardening` | Database-level guards for four rules the application already enforces (audit findings DB-02, DB-03, DB-04) | Awaiting approval. Live data checked read-only on 25 Nov 2026: 0 rows would be rejected |
