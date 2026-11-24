# STIS full system — architecture plan

Status: Phase 1 plan, written at branch point `644443f` on `codex/full-system`.
The AS03 assessment release stays on `codex/as03-system` and in `STIS-AS03-644443f-Submission.zip`. Nothing on this branch changes that release.

## 1. Goal

A working Sarawak Tourism Information System that covers all eight SRS tasks (T1–T8). On top of that it adds tourist accounts, staff management and a complete itinerary lifecycle. The target journey:

Register or sign in (or continue as a guest) → discover Sarawak → explore destinations, accommodation, transportation, dining, events and visitor information → select activities → create and organise an itinerary → save → reopen → review and modify.

## 2. Audit of the starting point (`644443f`)

| Area | State at `644443f` | Gap to the full system |
|---|---|---|
| T1 Explore Destinations | Search by name, location and interest; details dialog; compare; add to plan | No detail page, related records or activity detail |
| T2 Find Accommodation | Staff record type only; tourists see a dropdown list | No search, filters, amenities, comparison or booking handoff |
| T3 Find Transportation | Staff record type only | No origin/destination journey search, multi-leg journeys or operator referral |
| T4 Find Dining | Staff record type only | No cuisine or dietary filters, opening hours or comparison |
| T5 Find Events | Search by date and location; status; external referral; itinerary notices | Usable; needs detail pages and registration handoff copy |
| T6 Plan Itinerary | Single-day guest plan behind a capability link; conflicts, notices, reorder | No accounts, multiple days, plan list, timeline, export or sharing |
| T7 Find Visitor Information | One "Travel information" dropdown | No categories, safety or accessibility focus, authority sources, or destination-specific view |
| T8 Maintain Tourism Information | One shared staff password; drafts and versions; publish and withdraw; stale and expiry recovery | No individual staff accounts, roles, record history or audit trail |
| Persistence | SQLite file via `node:sqlite` | A file database cannot persist on serverless hosting |
| Accounts | Staff only (one shared password) | No tourist accounts or recovery |
| Hosting | Static prototype from `main` on Vercel; AS03 runs locally only | No hosted backend |

The AS02 domain design (C01–C18) is sound and stays the backbone: record classes with per-category validation, `Itinerary`/`ItineraryEntry` behaviour, coordinator and manager services, repositories, and access control. It is extended, not replaced.

## 3. Technology decision

| Concern | Choice | Why |
|---|---|---|
| Frontend | React 19 + TypeScript + Vite (kept) | Works well, team knows it, fast builds |
| Routing | Small History-API router in-house | Real URLs for detail pages and plans without a framework migration |
| API | One fetch-style handler (`Request → Response`) in TypeScript | Runs unchanged in Vite dev, Vercel Functions and tests (no HTTP needed in unit tests) |
| Hosting | **Vercel**: static client + one Node function for `/api/*` | Existing linked project; a preview for every branch push |
| Database | **Supabase Postgres** (existing project, `ap-southeast-1`, closest region to Sarawak) | Managed, backed up, persistent across serverless invocations, transactional |
| Local/test DB | **PGlite** (Postgres in WebAssembly), file-backed locally, in-memory in tests | Same SQL and same migrations, offline, no Docker; the 107 existing behaviours are re-proved against real Postgres semantics |
| DB driver (hosted) | `postgres` (postgres.js) through the Supabase transaction pooler, `prepare: false` | Small, serverless-friendly, supports transactions |
| Auth | **Own session auth** in Postgres: scrypt password hashes, opaque session tokens (SHA-256 digests stored), HttpOnly cookies, roles `tourist`/`staff`/`admin`, one-time recovery codes | Satisfies owner decision 3A without SMTP. Supabase Auth email recovery needs custom SMTP, so it is deferred (ADR-004). |
| Migrations | Plain SQL files in `supabase/migrations/` | Applied by our migrator for PGlite and by the Supabase migration tooling for the hosted project; one source of truth |
| CI | GitHub Actions: `npm ci`, tests, typecheck, build | Every push is verified on GitHub as well as locally |
| Bundling the function | esbuild (already in the tree through tsx; pinned explicitly) → Vercel Build Output API | Deterministic: one bundled `.mjs` function, no reliance on Vercel's per-file TS transpiling |

SQLite is retired on this branch only. The AS03 branch keeps it.

## 4. Logical architecture

```
Browser (React SPA)
  ├─ routes: /, /destinations, /stay, /transport, /dining, /events, /visitor-info,
  │          /<category>/:id, /compare, /trips, /trips/:id, /account/*, /staff/*
  └─ fetch /api/v1/*  (same origin, HttpOnly session cookie, guest capability header)

API handler (server/app.ts)  ── Vercel Function (prod/preview) | Vite middleware (dev) | direct call (tests)
  ├─ http/   routing, input limits, origin check, cookies, structured failure log
  ├─ services (AS02 coordination layer)
  │    TourismCatalog (C10)          search, details, related records, journeys
  │    ItineraryCoordinator (C11)    plan lifecycle, ownership, review, notices, export
  │    TourismInformationManager (C12) drafts, validation, publication, withdrawal, history
  │    AccountService (new, extends C15) registration, sessions, recovery, profile, roles
  │    ManagementAccessControl (C15) role checks for staff/admin operations
  ├─ domain (AS02 entity layer)
  │    TourismRecord + six subclasses (C01–C07)  category validation
  │    Itinerary, ItineraryEntry (C08–C09)       entries, multi-day, conflicts, notices
  │    JourneyPlanner (new)                       direct and two-leg transport options
  └─ repositories (C13, C14, + AccountRepository) → Db port → Postgres (Supabase) | PGlite
```

## 5. Data model (Postgres)

The catalogue stays version-based. Each record has immutable versions (JSONB payload) plus a draft pointer and a published pointer. New category fields only change validation and the editor, not the schema.

- `account` (id, email unique case-insensitive, display_name, role, password_hash, status, timestamps)
- `account_session` (token_digest, account_id, created_at, expires_at, last_seen_at)
- `recovery_code` (account_id, code_digest, used_at)
- `auth_throttle` (key digest, window start, count): rate limiting that works across serverless instances, per account and per client
- `tourism_record`, `record_version` (+ created_at, author_id), `record_state`, `version_destination`
- `record_activity` (record, action, version, actor, time): audit trail and history
- `itinerary` (id, owner_id nullable, guest_digest nullable, title, start_date, end_date, provisional, revision, timestamps)
- `itinerary_entry` (id, itinerary, record, kind, day, start, end, note, position)

Guest plans keep the capability-link model from AS03. A signed-in tourist can claim a guest plan; claiming moves ownership and revokes the guest link.

Row Level Security is enabled on every public table with no anon/authenticated policies. The browser never talks to the Supabase Data API; only the server role used by the API can read or write. This closes the Data API as an access path.

## 6. Security model

- Passwords: scrypt (N=2^15, r=8, p=1), per-user salt, constant-time compare. Minimum 10 characters, maximum 200.
- Sessions: 256-bit random tokens; only SHA-256 digests stored. Cookie `stis_session`: HttpOnly, SameSite=Lax, Path=/api, Secure on HTTPS. Tourist sessions 14 days sliding; staff and admin sessions 30 minutes idle and 8 hours absolute.
- Recovery: 10 single-use codes shown once at registration (and on regeneration). Each is about 80 bits, stored as digests. Using one signs out every session.
- CSRF: SameSite cookies, Origin check on all non-GET requests, JSON content type required.
- Enumeration: login and recovery give the same error for unknown accounts and wrong secrets.
- Throttling: per-email and per-client windows in Postgres. This replaces the global in-memory throttle (D10).
- Headers: CSP, `nosniff`, `frame-ancestors 'none'`, referrer policy, `no-store` on API.
- Logs: structured failure lines (method, normalised route, status, record id). Never passwords, tokens, codes, cookies or bodies.
- Secrets: `DATABASE_URL` only on the server (Vercel encrypted/sensitive env, local `.env.local`, git-ignored). The browser receives no Supabase key because it never needs one.

## 7. Content strategy

Every record carries provenance:
- `provenance`: `verified` (checked against a cited public source on a stated date), `operator` (supplied or published by the provider), or `illustrative` (synthetic demonstration data)
- `sourceName`, `sourceUrl`, `reviewedOn`

The interface always shows provenance. Prices, schedules and availability are never shown as live facts. Where they exist they are labelled "check with the provider" with a referral link. Facts drawn from the Sarawak Tourism Board website and other public authorities are written in our own words and linked to the source. No text or images are copied.

## 8. Delivery

- Branch `codex/full-system`; small focused commits; a draft PR into `main` as the review surface; CI on every push.
- Vercel builds a protected preview for each push. **Production (`main`) is not changed without the owner's approval.**
- The Supabase schema is applied as versioned migrations. Destructive migrations need approval and a recorded rollback.
- Milestones: see `roadmap.md`. Decisions: `decisions.md`. SRS mapping: `traceability.md`. Extensions beyond the SRS: `extensions.md`.
