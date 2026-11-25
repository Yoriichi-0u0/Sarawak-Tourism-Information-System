# STIS database: final verification

**Date:** 25 November 2026 (Asia/Kuching)
**Code under test:** branch `codex/database-audit`, based on `main` at `0463da1`, plus this audit's test, proposal and documentation files
**Runtime:** Node.js 25.8.1, npm 11.11.0; local PostgreSQL 18.6; production Supabase PostgreSQL 17.11
**Production modified:** **no.** Every production statement in this audit was a read-only `SELECT`.

## 1. Automated checks

Each was run once, in this order, from the repository root. Logs are in the review package (`logs/`).

| # | Command | Exit | Result | Duration |
|---:|---|---:|---|---:|
| 1 | `npm ci` | 0 | 35 packages installed, 0 vulnerabilities | 2 s |
| 2 | `npm test` (PGlite and unit tests) | 0 | **148 / 148 passed**, 0 failed, 0 skipped (145 before this audit + 3 in `server/proposed.test.ts`) | 54 s |
| 3 | `STIS_TEST_DATABASE_URL=postgres://stis_test@127.0.0.1:54329/postgres npm run test:postgres` | 0 | **89 / 89 passed** on PostgreSQL 18.6 (86 + 3) | 141 s |
| 4 | `npx tsc --noEmit --incremental false` | 0 | No type errors | 5 s |
| 5 | `npm run build` | 0 | Client built | 5 s |
| 6 | `npm run build:vercel` | 0 | Vercel output written to `.vercel/output` (git-ignored) | 8 s |

The PostgreSQL suite creates and drops a throwaway database per test (`server/testing.ts`). The local server log shows those
`CREATE DATABASE`/`DROP DATABASE` checkpoints during the run, which confirms the suite used PostgreSQL rather than falling back to PGlite.

**Failing first.** `server/proposed.test.ts` was written before the proposed migration existed. Its first run failed 3 of 3 with
`ENOENT … supabase/proposed/20261125090000_integrity_hardening.sql`. After the files were added it passed 3 of 3 on PGlite and on PostgreSQL.

## 2. Database-specific verification

| Check | Method | Result |
|---|---|---|
| Migrations build a clean database | `migrate()` on an empty PostgreSQL 18.6 database (`stis_clean`) | 5 applied, 0 errors |
| Every migration reverses cleanly | `db.test.ts`: up → down → up yields an identical catalog | pass (PGlite and PostgreSQL) |
| Live schema = migration history | Fingerprint query on clean build and production (`MIGRATION_REPORT.md` §3), at the start and again at the end of the audit | 7/7 categories identical both times |
| Live data satisfies the design | `scripts/database/invariants.sql`, 18 checks, read-only on production (`DATABASE_AUDIT.md` §5) | 0 violations; 1 active administrator |
| Append-only history | `db.test.ts` as `stis_api`: INSERT allowed, UPDATE and DELETE refused; FK `SET NULL` still works on account deletion | pass |
| Atomic publication and rollback | `services.test.ts` "a database fault rolls back publication and the saved state reopens" | pass |
| Stale updates | Draft save (`services.test.ts` l.228, 651) and itinerary revision (l.90) return 409 | pass |
| Ownership and guest access | `http.test.ts` l.188; `accounts.test.ts` l.140 (another account gets 404; wrong guest token 404; claim revokes guest link) | pass |
| Read-only sharing | `accounts.test.ts` l.201, 233 (share link never grants editing; revoke and delete end the view) | pass |
| Staff and administrator authorisation | `http.test.ts` l.165 (401 missing or malformed session, 403 tourist); `accounts.test.ts` l.166 | pass |
| Proposed hardening | `server/proposed.test.ts` (apply, reject bad rows, unchanged workflows, rollback to identical schema) | pass; **not applied to production** |
| Diagram completeness | `scripts/database/erd.py` self-check | 12 of 12 tables, 14 of 14 foreign keys drawn |

## 3. Security verification

| Check | Evidence | Result |
|---|---|---|
| `stis_api` role attributes | `pg_roles` on production | LOGIN; not superuser; no BYPASSRLS, CREATEROLE, CREATEDB or REPLICATION; `rolinherit` false; no role memberships; `statement_timeout=10s` |
| Data API exposure | `has_schema_privilege` on production | `anon`, `authenticated`, `service_role`: no USAGE on `stis` |
| Grants | `aclexplode` on production | Exactly as designed: INSERT-only on history, SELECT-only on `schema_migration` |
| RLS | `pg_class`, `pg_policies` | Enabled on 12/12 tables; one `stis_api` policy each; meaning documented as a role gate (DB-01) |
| Supabase security advisor | `get_advisors security`, 25 Nov 2026 09:09 UTC | **0 findings** |
| Supabase performance advisor | `get_advisors performance` | 2 INFO "unused index" notices, both intentional FK indexes (keep) |
| Secrets in this change set | Pattern scan of the branch diff and the review package for connection strings with passwords, API keys, JWTs, share cookies and personal e-mail addresses | None found. The only credential-like strings are the synthetic `staff@example.test` test account in `server/proposed.test.ts`, following the existing tests |

## 4. Hosted application checks (production, read-only)

Run at 17:09 +08 against `https://sarawak-tourism-information-system.vercel.app/api/v1`. No probe writes data: unauthenticated
writes are refused before any SQL runs, and the cross-origin login is refused by the Origin check before the throttle is touched.

| Request | Expected | Actual |
|---|---|---|
| `GET /catalog/destination` | 200 | 200 (1.21 s, first request, cold function) |
| `GET /auth/session` (anonymous) | 200 | 200 (0.20 s) |
| `GET /staff/records`, no session | 401 | 401 |
| `GET /staff/records`, forged 43-character session cookie | 401 | 401 |
| `GET /admin/staff`, no session | 401 | 401 |
| `GET /itineraries`, no session | 401 | 401 |
| `GET /shared-itinerary`, bogus share token | 404 | 404 |
| `GET /itineraries/<random id>`, bogus guest token | 404 | 404 |
| `POST /staff/records`, no session | 401 | 401 |
| `POST /auth/login` from a foreign Origin | 403 | 403 |

The live application remained operational throughout. No deployment was made.

## 5. Not tested

* Restoring a Supabase backup, and point-in-time recovery.
* Load and contention beyond the targeted concurrency tests.
* The proposed migration on a Supabase branch or on production (tested on PGlite and PostgreSQL 18.6 only).
* Authenticated hosted flows with real accounts. Hosted end-to-end runs with synthetic accounts were completed in M9 (`docs/full-system/verification.md`) and were not repeated here, to avoid writing to production.

## 6. Remaining limitations and risks

| Item | Severity | Mitigation |
|---|---|---|
| DB-01: RLS does not isolate rows; a leaked `stis_api` credential exposes account e-mails and hashes and allows itinerary changes | Medium (residual) | Credential only in Vercel (Production) and git-ignored `.env.local`; rotated 24 Nov 2026; history is INSERT-only; the Data API cannot reach `stis` |
| DB-02, DB-03, DB-04: three rules enforced only by the application | Low | Proposed, tested migration awaiting approval; live data already complies |
| DB-05: expired sessions and throttle rows accumulate slowly | Low | Periodic cleanup recommended |
| DB-06: deleting a staff account makes their history entries read "content import" | Low | Disable instead of delete, or relabel (application change) |
| DB-07: scrypt cost below the current OWASP minimum | Low | Raise N to 2^17 with rehash on sign-in (application change) |

## 7. Release recommendation

**The production database is ready and correct for the current release.** It matches the checked-in migration history exactly. It
supports every SRS task (T1–T8) and every full-system extension. It satisfies all data invariants on live data, and it passes the
complete automated suite on PGlite and PostgreSQL. No Critical or High issue was found, and no production change is required.

Recommended next steps, in order, each needing owner approval:

1. Apply `20261125090000_integrity_hardening` (DB-02 to DB-04) using the steps in `MIGRATION_REPORT.md` §5.
2. Application changes for DB-06 (staff self-deletion) and DB-07 (scrypt cost).
3. A scheduled cleanup for DB-05.
