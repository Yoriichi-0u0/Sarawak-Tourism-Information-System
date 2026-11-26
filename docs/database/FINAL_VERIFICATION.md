# STIS database: final verification

**Date:** 25 November 2026 (Asia/Kuching). Revised the same day after independent review: §0 supersedes the proposal results in §1–§2.
**Code under test:** branch `codex/database-audit`, based on `main` at `0463da1`, plus this audit's test, proposal and documentation files
**Runtime:** Node.js 25.8.1, npm 11.11.0; local PostgreSQL 17.12 and 18.6; PGlite 0.6.0 (PostgreSQL 19.0); production Supabase PostgreSQL 17.11
**Production modified:** **no.** Every production statement in this audit, including the re-verification, was a read-only `SELECT`. No migration was applied, nothing was merged or deployed.

## 0. Re-verification after the DB-04 correction (revision 2)

The independent review accepted the production database and documentation. It found that the **proposed** DB-04 regex accepted
impossible dates (`2026-02-31`, `2026-04-31`, `2025-02-29`, `0000-01-01`), and that the migration report misdescribed the locking of
the stored generated column. Both are corrected (`DATABASE_AUDIT.md` §10.1, C-01 to C-03; `MIGRATION_REPORT.md` §5). Production was
never affected, because the proposal was never applied.

### 0.1 Failing first

The tests were written before the correction and run against revision 1 (`logs/db04-failing-first.log`):

| Test | Result before the correction |
|---|---|
| `proposed.test.ts` impossible dates rejected | **fail**: `Missing expected rejection: start date "2026-02-31"` |
| `proposed.test.ts` database and `validDate` agree | **fail** (no calendar check existed) |
| `proposed.test.ts` the API role can store dates through the guard | **fail** |
| `services.test.ts` trip dates must be Gregorian calendar dates | **fail**: `Missing expected rejection: 0000-01-01..` (the API accepted year zero) |
| The two unchanged proposal tests (apply and rollback; workflows) | pass |

### 0.2 Full suite, clean copy

The commands ran in a clean copy of the working tree (tracked and new files only, no `node_modules`) in a temporary directory, in
this order. Logs are in `logs/`.

| # | Command | Exit | Result | Duration |
|---:|---|---:|---|---:|
| 1 | `npm ci` | 0 | 35 packages installed, 0 vulnerabilities | 2 s |
| 2 | `npm test` (PGlite and unit tests) | 0 | **151 / 151 passed**, 0 failed, 0 skipped (148 before + 3 new) | 34 s |
| 3 | `STIS_TEST_DATABASE_URL=postgres://stis_test@127.0.0.1:54317/postgres npm run test:postgres` | 0 | **92 / 92 passed on PostgreSQL 17.12** (89 before + 3 new) | 27 s |
| 4 | same, port 54329 | 0 | **92 / 92 passed on PostgreSQL 18.6** | 26 s |
| 5 | `npx tsc --noEmit --incremental false` | 0 | No type errors | 1 s |
| 6 | `npm run build` | 0 | Client built | 2 s |
| 7 | `npm run build:vercel` | 0 | Vercel output written (in the temporary copy) | 1 s |

Each server log shows about 67 forced checkpoints during its run, one per throwaway test database created or dropped. That
confirms the PostgreSQL suites ran on those servers and not on the PGlite fallback.

Two earlier attempts in the repository itself are kept in `logs/aborted-run*/`. In both, `npm ci` failed with `ENOTEMPTY` because
Finder wrote `.DS_Store` files into `node_modules` while npm was deleting it. Every later step then failed for lack of dependencies,
and in the first attempt `npx tsc` stopped at a prompt to download an unrelated package; that prompt was declined. No test logic was
involved. The repository's `node_modules` was then reinstalled successfully, and the verification above was run in the clean copy
instead.

### 0.3 Migration and rollback on PostgreSQL 17

Evidence: `evidence/pg17-proposal-verification.txt`, `evidence/pg18-proposal-verification.txt`, `evidence/pg17-calendar-oracle.txt`.

| Check | PostgreSQL 17.12 | PostgreSQL 18.6 |
|---|---|---|
| Clean `migrate()` build = production fingerprint | 7/7 identical (`evidence/fingerprint-clean-pg17.txt`) | 7/7 (excluding PG 18's NOT NULL rows, as before) |
| Apply on the application's seeded database | committed in 4 ms | 6 ms |
| Locks held until COMMIT | ACCESS EXCLUSIVE: `itinerary`, `itinerary_entry`, `version_destination`. SHARE ROW EXCLUSIVE: `record_activity`, `record_version`, `tourism_record` | same |
| While the migration transaction is open | Reads of trips and of `version_destination` wait; staff inserts into `record_version` wait; reads of `tourism_record` and `record_version` proceed | same |
| Tables rewritten | `version_destination` only (new `relfilenode`) | same |
| Fingerprint after apply | columns 65, constraints 53, indexes 28, functions 1 | identical hashes |
| As `stis_api`: `2026-02-31`, `2026-04-31`, `2025-02-29`, `0000-01-01` | rejected, 23514 | same |
| As `stis_api`: `2028-02-29`, `2000-02-29` | accepted | same |
| Function | IMMUTABLE, `search_path=""`, EXECUTE for `stis_api` only, not PUBLIC | same |
| Rollback | 2 ms; fingerprint identical to before | same |
| Apply → rollback → apply → rollback | identical fingerprints each time | same |
| 100,000 links, 100,001 history rows, 10,000 trips | apply 1,219 ms, rollback 2 ms | 1,099 ms, 2 ms |
| `is_calendar_date` vs PostgreSQL's own date parser, all 4,620,000 strings for years 0000–9999, months 00–13, days 00–32 | **0 disagreements**; 3,652,059 dates accepted (every day from 0001-01-01 to 9999-12-31); 2,424 leap days | — |

### 0.4 Production, read-only

| Check | Result |
|---|---|
| `scripts/database/invariants.sql` (check 14 now uses the Gregorian rule; check 15 is cast-safe) | 18/18 hold. **The corrected DB-04 would reject 0 existing rows** |
| Saved `reviewedOn` values in year 0000 (affected by the `validDate` change) | 0 |
| Fingerprint with the updated query (adds a `functions` category) | Identical to the start of the audit; no function rows. **Production unchanged** |
| Supabase advisors, 14:38 UTC | Security 0; performance 2 INFO "unused index" notices (unchanged; keep) |

The planted-data check of the revised invariant script, on a scratch PostgreSQL 17 database, counted exactly the three impossible
dates and did not abort.

### 0.5 What changed

| File | Change |
|---|---|
| `supabase/proposed/20261125090000_integrity_hardening.sql`, `.down.sql` | Revision 2: `stis.is_calendar_date(text)`; CHECKs `itinerary_calendar_dates`, `itinerary_entry_calendar_day`; `[0-9]` instead of `\d`; `lock_timeout`; no `NOT VALID` split; rollback drops the function. DB-02 and DB-03 objects unchanged |
| `server/domain.ts` | `validDate` rejects year `0000` (one condition and a doc comment), so the API and the proposed database rule agree |
| `server/proposed.test.ts` | Impossible and valid dates; non-ASCII digits; database/API agreement; API-role execution; rollback compares functions too |
| `server/services.test.ts` | API test for Gregorian trip dates |
| `scripts/database/invariants.sql`, `fingerprint.sql` | Gregorian check 14; cast-safe check 15; `functions` category |
| `docs/database/*.md`, `supabase/proposed/README.md` | Corrections register, findings, migration report §5, this section |

## 1. Automated checks (original audit run, before the correction)

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
* The proposed migration on a Supabase branch or on production. Revision 2 was tested on PGlite, PostgreSQL 17.12 (production runs 17.11) and 18.6, on local servers.
* Authenticated hosted flows with real accounts. Hosted end-to-end runs with synthetic accounts were completed in M9 (`docs/full-system/verification.md`) and were not repeated here, to avoid writing to production.

## 6. Remaining limitations and risks

| Item | Severity | Mitigation |
|---|---|---|
| DB-01: RLS does not isolate rows; a leaked `stis_api` credential exposes account e-mails and hashes and allows itinerary changes | Medium (residual) | Credential only in Vercel (Production) and git-ignored `.env.local`; rotated 24 Nov 2026; history is INSERT-only; the Data API cannot reach `stis` |
| DB-02, DB-03, DB-04: three rules enforced only by the application | Low | Proposed migration revision 2, verified on PostgreSQL 17, awaiting approval; live data already complies. When applied it briefly blocks trip pages and staff saves (milliseconds now; about 1 s per 100,000 links) and fails fast after 3 s if it cannot get its locks |
| DB-05: expired sessions and throttle rows accumulate slowly | Low | Separate improvement task: periodic cleanup |
| DB-06: deleting a staff account makes their history entries read "content import" | Low | Separate improvement task: disable instead of delete, or relabel |
| DB-07: scrypt cost below the current OWASP minimum | Low | Separate improvement task. Needs a benchmark on the Vercel function first, backward-compatible verification of existing hashes, and rehash on sign-in |

## 7. Release recommendation

**The production database is ready and correct for the current release.** It matches the checked-in migration history exactly. It
supports every SRS task (T1–T8) and every full-system extension. It satisfies all data invariants on live data, and it passes the
complete automated suite on PGlite and PostgreSQL. No Critical or High issue was found, and no production change is required.

Recommended next steps, in order, each needing owner approval:

1. Ship the `validDate` change (year 0000), which is independent of the migration and safe on its own.
2. When approved, apply `20261125090000_integrity_hardening` **revision 2** (DB-02 to DB-04) in a quiet period, following `MIGRATION_REPORT.md` §5.6. Revision 1 must not be applied.
3. Separate improvement tasks, each planned and verified on its own: DB-05 (scheduled cleanup), DB-06 (staff self-deletion), DB-07 (scrypt cost: benchmark, backward-compatible verification, rehash on sign-in).
