# Sarawak Tourism Information System (STIS)

A full-stack tourism information system for Sarawak: explore destinations, accommodation, transportation, dining, events and visitor information, then plan, save and revisit itineraries. Staff maintain the published information.

> This is the full system, live in production since 24 Nov 2026 (merged from `codex/full-system`, PR #8). The SWE30003 AS03 assessment release is preserved separately on `codex/as03-system` (commit `644443f`); its README, local SQLite runtime and submission package are unchanged there.

## Architecture in one paragraph

React + TypeScript client (Vite). One TypeScript API handler (`server/http.ts`) serves `/api/v1/*`; it runs inside the Vite dev/preview server locally and as a single Vercel Function in deployment. Data lives in Postgres: **Supabase** when hosted, **PGlite** (Postgres compiled to WebAssembly) on your machine and in tests, using the same SQL migrations in `supabase/migrations/`. Accounts use server-side sessions (HttpOnly cookie), scrypt password hashes and one-time recovery codes. See `docs/full-system/architecture.md`.

## Run it locally

Requires **Node.js 25.8.1** (npm 11). No database server or cloud account is needed: local data is stored with PGlite under `.stis-data/<profile>/`.

```sh
npm ci
export STIS_ADMIN_EMAIL=admin@example.test          # first administrator (created once)
read -rs STIS_ADMIN_PASSWORD; export STIS_ADMIN_PASSWORD   # 12–200 characters, synthetic
npm run dev        # http://127.0.0.1:5173 with hot reload
# or
npm run build && npm start   # production build on http://127.0.0.1:4173
```

The administrator account is created on first start if no account with that email exists; changing the variable later never overwrites an existing account. Choose another data set with `STIS_DATA_PROFILE=<name>`. Tourists register in the app.

## Verify

```sh
npm test               # unit, service, HTTP, migration and client tests on PGlite
npm run typecheck
npm run build:vercel   # client + bundled API in .vercel/output (Build Output API)
STIS_TEST_DATABASE_URL=postgres://user@127.0.0.1:5432/postgres npm run test:postgres   # same server tests on a real Postgres
```

GitHub Actions runs all of these on every push, including the Postgres 17 suite.

## Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `DATABASE_URL` | Vercel (server only) | Supabase Postgres connection through the transaction pooler. Never exposed to the browser. |
| `STIS_ADMIN_EMAIL`, `STIS_ADMIN_PASSWORD` | local / one-off | Bootstrap the first administrator |
| `STIS_DATA_PROFILE` | local | Name of the local PGlite data set (default `local`) |
| `STIS_ALLOWED_HOSTS` | optional | Comma-separated Host allow-list for the API |

## Documentation

- `docs/full-system/architecture.md`: architecture, data model, security model
- `docs/full-system/decisions.md`: decisions and the conflict register
- `docs/full-system/traceability.md`: SRS T1–T8 to implementation status
- `docs/full-system/extensions.md`: features beyond the SRS
- `docs/full-system/roadmap.md`: milestones
