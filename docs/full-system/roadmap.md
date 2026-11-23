# Roadmap

Each milestone ends with tests, a build, a commit, a push (CI and Vercel preview) and a short milestone report.

| # | Milestone | Content | Exit evidence |
|---|---|---|---|
| M0 | Plan | Architecture, decisions, traceability, extensions, roadmap | This folder |
| M1 | Postgres platform | SQL migrations, Db port (PGlite/postgres.js), async repositories, fetch-style API `/api/v1`, Vite dev mount, Vercel function bundle, CI | Ported AS03 behaviour tests pass on Postgres; existing UI works against `/api/v1` |
| M2 | Accounts | Tourist registration, login, logout, profile, password change, recovery codes, account deletion; staff and admin roles; staff bootstrap; guest-plan claim; DB throttling | Auth and authorisation test suite; no secrets in logs |
| M3 | Content model and research | Richer fields for all six categories, provenance, researched and attributed Sarawak facts plus labelled illustrative records; per-category search; related records; journey planner | Catalogue and journey tests; source register |
| M4 | Design direction | 2–3 visual directions explored, evaluated for usability and accessibility, one selected; design tokens; app shell and router | Concepts, evaluation note, shell in all themes |
| M5 | Discovery | T1–T5 and T7 on one discovery pattern: filters, results, detail pages, compare, referral handoff, empty and incomplete states | Browser tests per task, desktop and mobile |
| M6 | Itinerary lifecycle | Trips dashboard, multi-day plans, timeline, conflicts, notices, add from any discovery page, notes, export (.ics, print), share | End-to-end journey test: register → plan → reopen → modify |
| M7 | Staff console | Dashboard, record list and filters, editor for six categories, history and audit, staff account administration | Staff E2E and permission tests |
| M8 | Hosted environment | Schema on Supabase, Vercel preview env, seeded catalogue, smoke and E2E against the preview | Preview URL verified; advisors clean |
| M9 | System verification | All eight tasks individually and together; security, accessibility, performance and responsive review; fixes | Verification report; remaining limitations |
