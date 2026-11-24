# Hosting: Vercel + Supabase

## Topology

- **Vercel project** `sarawak-tourism-information-system` (team `chia-0u0-s-projects`, Hobby). Every push to `codex/full-system` builds a protected preview with `npm run build:vercel` (static client + one bundled Node function for `/api/*`, region `sin1`).
- **Production** (`main`) serves the full system from 24 Nov 2026 (PR #8). `DATABASE_URL` (Sensitive) is set for **Production only**. The Supabase project below is the production database.
- **Previews** have **no** `DATABASE_URL`, so preview API calls return 503 ("hosted database not configured"). Unreviewed branches therefore cannot read or write live data. Test locally with PGlite or the local Postgres suite. For a hosted QA run, use a separate database; never point a preview at production.
- **Rollback:** the last static-prototype deployment is `sarawak-tourism-information-system-d9kmd9242.vercel.app`. Run `vercel rollback <that URL>`, or revert the PR #8 merge on `main`. The database needs no rollback for the prototype, which does not use it.
- **Supabase project** `lblnltxpoaaqxbqrkoki` (`ap-southeast-1`, Postgres 17). STIS tables live in schema `stis`, which the Supabase Data API does not expose. RLS is on everywhere, and only the `stis_api` role has a policy.

## Database role

The API connects as `stis_api` through the Supavisor transaction pooler:

```
postgres://stis_api.<project-ref>:<password>@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres
```

`stis_api` can log in. It is not a superuser, cannot bypass RLS, and has a 10-second statement timeout. It holds DML rights on `stis` tables only, and only read access to the migration ledger.

## Applying migrations

Migrations in `supabase/migrations/` are applied in filename order. For each file, run its SQL and then `insert into stis.schema_migration(version) values ('<file name without .sql>')` in the same transaction. Locally, `migrate()` does this automatically. Check the ledger with `select version from stis.schema_migration order by version;`.

Rollback SQL for each migration is in `supabase/rollback/`. CI tests up → down → up on every push. The initial-schema rollback drops all STIS data, so it needs the owner's approval.

## Rotating the `stis_api` password

1. Generate a new password locally and compute its SCRAM-SHA-256 verifier (see `scripts/` history for the snippet). Only the verifier is sent to Supabase:
   `alter role stis_api password 'SCRAM-SHA-256$4096:...';`
2. Update `DATABASE_URL` in Vercel (Preview, branch `codex/full-system`, type Sensitive) and in the local, git-ignored `.env.local`.
3. Redeploy the preview.

Rotation history: the first password passed through the Vercel connector as a plain tool argument during setup on 23 Nov 2026. It was rotated on 24 Nov 2026. `stis_api` changed its own password over the existing connection, with only the SCRAM verifier sent. The new value went to Vercel through `vercel env add … --sensitive --force` on stdin and to `.env.local` by script, without being printed. The old credential is rejected (`28P01`), and the redeployed preview reads the database with the new one.

## Provisioning

`node --env-file=.env.local --import tsx scripts/provision.ts` seeds the catalogue if it is empty and creates the first administrator from `STIS_ADMIN_EMAIL`/`STIS_ADMIN_PASSWORD`. It never overwrites an existing account.

## Platform function hardening (resolved 24 Nov 2026)

The Supabase security advisor reported `public.rls_auto_enable()`, a SECURITY DEFINER event-trigger function, as executable by `anon` and `authenticated`. It predates STIS and backs the platform's `ensure_rls` event trigger. Because it returns `event_trigger`, a direct RPC call cannot run it, but the privilege is unnecessary. `EXECUTE` was revoked from `public`, `anon` and `authenticated` (Supabase migration `harden_rls_auto_enable_execute`). The trigger still enables RLS on new public tables, and the advisor reports no findings.

## Hosted migration ledger

Applied to `lblnltxpoaaqxbqrkoki` in order, each recorded in `stis.schema_migration`: `20261123120000_initial_schema`, `20261123120100_api_role_access`, `20261123120200_foreign_key_indexes`, `20261124090000_append_only_history`, `20261124100000_itinerary_share_links`.
