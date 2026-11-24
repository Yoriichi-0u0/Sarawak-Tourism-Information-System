# Decision log

## ADR-001 — Separate branch for the full system
Develop on `codex/full-system` from `644443f`. `codex/as03-system`, the `644443f` submission ZIP and all review archives stay untouched, so the 27 November AS03 submission remains independently reproducible.

## ADR-002 — Postgres (Supabase) replaces SQLite on this branch
A SQLite file cannot persist on Vercel's serverless runtime, and a full system needs a hosted backend. The existing Supabase project (Singapore) supplies managed Postgres. PGlite runs the same migrations locally and in tests, so development stays offline and reproducible. Rollback: the AS03 branch keeps the SQLite implementation, and the hosted schema starts from an empty project.

## ADR-003 — One fetch-style API handler deployed as a single Vercel Function
The same `handle(Request) → Response` runs in tests, in the Vite dev server and on Vercel. The function is bundled with esbuild into the Build Output API, so deployment does not depend on per-file TypeScript transpiling.

## ADR-004 — Own session auth with recovery codes, not Supabase Auth (for now)
The owner chose recovery codes (3A). Supabase Auth's email confirmation and recovery depend on SMTP. Its default sender only reaches project members, so a custom SMTP provider and domain would be needed. Own auth also keeps tourists, staff and roles in one testable model. Supabase Auth (email, OAuth) remains a later option; the account table is designed so an external identity column can be added.

## ADR-005 — The browser never uses the Supabase Data API
All reads and writes go through our API, which enforces the AS02 domain rules. RLS is enabled on every table with no client policies, so the public anon key grants nothing.

## ADR-006 — Provenance on every record
Records state whether they are verified public facts, operator-supplied or illustrative. Prices, schedules and availability are never presented as live.

## ADR-007 — View-only trip sharing as a revocable capability link
An editor (account owner or guest-link holder) can create one view-only link per trip. The token travels in the URL fragment and an `Authorization: Share …` header, so it never reaches request logs. Only its SHA-256 digest is stored (`stis.itinerary.share_digest`). Replacing the link revokes the old one, and stopping sharing clears it. The link cannot edit, delete, claim or mint further links, and viewers do not see sharing settings. Sharing does not change the plan revision.

## ADR-008 — The server alone enforces session idle expiry
The cookie's `Max-Age` equals the session's absolute lifetime (staff and admin 8 h, tourists 30 days). The database row enforces the sliding idle limit (30 min, 14 days) on every request. Before this change the cookie expired 30 minutes after a staff sign-in even during active work (defect found in M9).

## ADR-009 — Append-only publication history; hardened platform function
`stis_api` may only INSERT into `tourism_record`, `record_version`, `version_destination` and `record_activity`, so a leaked API credential cannot rewrite who published what. Foreign-key `on delete set null` actions still run as the table owner. Separately, `EXECUTE` on the platform's `public.rls_auto_enable()` event-trigger function was revoked from `anon` and `authenticated`. The trigger still enables RLS on new public tables (probe verified), and the Supabase security advisor now reports no findings.

## ADR-011 — Production topology
The existing Supabase project, cleaned after QA (curated content and the owner's administrator only), becomes the production database. A second free project was not available through the tools in use, and a paid branch was not justified. Only Production receives `DATABASE_URL`, so preview deployments of unreviewed code cannot touch live data. The owner approved production release on 24 Nov 2026.

## Conflict register: GPT brief vs owner instructions vs this plan

The owner asked for conflicts to be listed rather than silently resolved. The owner's direct instructions take precedence over the brief.

| # | GPT brief says | Owner says | Resolution |
|---|---|---|---|
| 1 | Codex owns engineering; Claude owns design | 7A: Claude may do architecture, design and implementation; Codex may review on isolated branches | Claude implements on `codex/full-system`; Codex should use its own branch or worktree |
| 2 | Do not push, merge or deploy without authorisation | "You can push to GitHub"; "fully utilise GitHub, Vercel, Supabase" | Push the branch, open a draft PR, use CI and Vercel previews. **Not done without approval:** merging to `main` or promoting Vercel production |
| 3 | Escalate production deployments and paid infrastructure | Same | Supabase project and Vercel Hobby are already free. No paid resource is created. Schema changes on the empty Supabase project are non-destructive migrations |
| 4 | Evaluate password recovery (implies email) | 3A: recovery codes initially | Recovery codes; email recovery recorded as a future extension (ADR-004) |
| 5 | Neo-brutalist design is a starting point | 6B: explore 2–3 directions and pick the strongest | Design milestone M4 explores and evaluates directions before the UI rebuild |
| 6 | Use the STB website for research but do not copy content or assets | "Utilise sarawaktourism.com well" | Use it for information architecture and facts, written in our own words and attributed with links. No copied text, photos or logos |
| 7 | Earlier AS03 rule: do not modify Vercel or Supabase | New instruction to use both | The AS03 rule applied to the assessment branch; it is superseded for this branch only |
| 8 | Begin with Node.js and SQLite | 2A says start there but adopt Postgres/Supabase if justified | Adopted Postgres (ADR-002) |
| 9 | Brief section 11: do not rewrite the report during development | Same | The report is untouched; `traceability.md` and `extensions.md` feed a later reconciliation |
