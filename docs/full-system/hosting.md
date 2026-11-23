# Hosting: Vercel + Supabase

## Topology

- **Vercel project** `sarawak-tourism-information-system` (team `chia-0u0-s-projects`, Hobby). Every push to `codex/full-system` builds a protected preview with `npm run build:vercel` (static client + one bundled Node function for `/api/*`, region `sin1`).
- **Production** (`main`) still serves the earlier static prototype. It does not receive `DATABASE_URL` and is not changed by this branch.
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

The first password passed through the Vercel connector as a plain tool argument during setup on 23 Nov 2026, so it appears in that working session's transcript. Rotate it before any real use.

## Provisioning

`node --env-file=.env.local --import tsx scripts/provision.ts` seeds the catalogue if it is empty and creates the first administrator from `STIS_ADMIN_EMAIL`/`STIS_ADMIN_PASSWORD`. It never overwrites an existing account.

## Known platform finding (not created by STIS)

The Supabase security advisor reports `public.rls_auto_enable()`, a SECURITY DEFINER function executable by `anon` and `authenticated` through `/rest/v1/rpc`. It predates STIS and appears to be platform-provided. STIS does not use it. Revoke `EXECUTE` from `anon` and `authenticated` if it is not needed.
