# M8–M9 verification report (24 Nov 2026)

Branch `codex/full-system`, draft PR #8. `main`, Vercel production and the AS03 release (`644443f`, `codex/as03-system`) are unchanged.

## 1. Security work done first

| Item | Result |
|---|---|
| Possibly exposed database credential | Rotated: `stis_api` changed its own password and only the SCRAM verifier was sent. The new value reached Vercel through `vercel env add --sensitive --force` (stdin) and `.env.local` through a script; it was never printed. The old credential is rejected (`28P01`). The deployment built before the rotation now fails closed with a generic 500, and redeployed previews work. |
| Supabase security advisor | `public.rls_auto_enable()` (the platform's event-trigger function): `EXECUTE` revoked from `public`, `anon` and `authenticated`. The trigger still enables RLS (probe table checked, then dropped). Advisor: **0 findings**. |
| RLS and roles | `anon` and `authenticated` have no usage on schema `stis` and no table privileges. All 12 tables have RLS with only a `stis_api` policy. `stis_api` is not a superuser, has no BYPASSRLS and a 10 s statement timeout. |
| Audit integrity | Publication history (`tourism_record`, `record_version`, `version_destination`, `record_activity`) is now append-only for `stis_api` (ADR-009). |
| Session management | **Defect fixed:** the staff cookie expired 30 minutes after sign-in even while the user was active. The cookie now lasts the full session lifetime and the server enforces idle expiry (ADR-008). |
| Authentication review | Accounts: scrypt (N=32768) hashes; session tokens of 256 bits stored as digests and rotated at sign-in; per-email and per-client throttling; a dummy hash for unknown emails (timing); 80-bit single-use recovery codes stored as digests; sessions revoked on password change and recovery; admins cannot lock themselves out; the last administrator cannot be deleted. Requests: CSRF is blocked by an Origin check, `SameSite=Lax` and JSON-only bodies (415). Capability tokens travel in headers, not URLs. Registration reveals whether an email is already registered, a deliberate usability trade-off. |

## 2. Hosted end-to-end (M8)

Target: preview `sarawak-tourism-information-system-pkchvu5yt.vercel.app` (Vercel `sin1`, Supabase `ap-southeast-1`), reached through a temporary Vercel share link. The run used a synthetic admin (`qa-admin-…@example.test`, created directly in the database) and synthetic tourists. The real administrator account was not used.

| Suite | Result |
|---|---|
| Journey, 27 steps, Chromium 1366 px | **27/27**, no console errors, no overflow |
| Journey, Chromium 390 px | First run (`pkchvu5yt`): **failed at step 2**, a real defect (the hero photo credit covered the Search button on phones, D-6). After the fix (`11c7639`, preview `q8a042f5y`): **27/27** |
| Filters (including the mobile collapsible filters) | **13/13** on `q8a042f5y` (11/11 on `pkchvu5yt` before the mobile checks were added) |
| Keyboard and layout | **13/13** on `q8a042f5y`, on 2 runs. The first hosted run exposed two harness gaps: no share-link cookie, and a menu check that read the menu state before it updated. Both were fixed in the suite; neither was an application defect |
| Cleanup (after each hosted session) | Synthetic tourists and their trips deleted; the synthetic admin and staff account disabled (kept so the append-only audit trail stays readable); curated content re-synced. Result: 0 tourist accounts, 0 trips, and the owner's administrator as the only active staff account. |

## 3. Requirement acceptance matrix

Evidence key: **U** = unit or integration tests (`npm test` 144, `test:postgres` 86); **J#** = browser journey step (`scripts/qa/journey.mjs`); **F** = filter suite; **K** = keyboard suite; **H** = passed on the hosted preview.

| Requirement | Verified behaviour | Evidence | Status |
|---|---|---|---|
| T1 Explore Destinations | Name, location and interest search; detail pages with source and a real photo; compare; add to trip; no-match and unavailable states | U, J2, J5, F, H | Accepted |
| T2 Find Accommodation | Type, price, accessibility and amenity filters; no-match with Clear; compare; provider handoff that discloses the external site | U, J15, F, H | Accepted |
| T3 Find Transportation | Journey planner (direct and two-leg); operators; schedule status; provenance | U (catalog), J16, H | Accepted |
| T4 Find Dining | Cuisine and dietary filters; hours or an explicit "Not provided" | U, F, H | Accepted |
| T5 Find Events | Date range; scheduled, postponed, cancelled and past states shown in text; published changes reach saved trips | U, J3, J20–21, F, H | Accepted |
| T6 Plan Itinerary | Guest and account trips of up to 14 days; add from any category; edit, notes, reorder; conflicts naming both stops; date notices; rename, dates, delete; .ics; print; reopen after sign-in | U, J4–J13, H | Accepted |
| T7 Find Visitor Information | Categories, destination scope, emergency guidance, authority links | U, J17, F, H | Accepted |
| T8 Maintain Tourism Information | Six categories; drafts isolated from tourists; validation at publication; publish; withdraw with referential check; history; stale-draft and session-expiry recovery | U, J18–J24, H | Accepted |
| Tourist accounts | Register with 10 recovery codes; sign in and out; recover; profile; password change; delete | U, J11–J13, H | Accepted |
| Staff management | Admin creates staff, changes roles, disables accounts; tourists get 403 | U, J25–J26, H | Accepted |
| Itinerary lifecycle across tasks | Event → trip → staff cancels → trip shows it; withdrawal keeps the stop but marks it unavailable; claim a guest trip into an account | J4–J13, J20–J23, H | Accepted |
| View-only sharing (extension) | Create, replace and revoke a link; the viewer cannot edit; the token is never logged | U (3 tests), J14, H | Accepted |
| Media provenance (extension) | 22 Commons photos and 2 labelled illustrations; exact and representative captions; credits page; AVIF/WebP | U (`media.test.ts`), browser media scan | Accepted |
| 7.1 Security | See section 1 | U, J26, advisor | Accepted |
| 7.2 Reliability | Failed publication rolls back; provider outages cannot break STIS (links only) | U | Accepted |
| 7.3 Usability and accessibility | axe WCAG 2.1 A/AA and best practice: 36/36 screen and theme scans clean (after one heading-order fix); keyboard 13/13 | axe, K | Accepted |
| 7.4 Efficiency (3 s) | Hosted LCP 96–696 ms on desktop and 208–564 ms on throttled mobile; TTFB about 40–57 ms; API 84–170 ms | `perf.mjs`, H | Accepted |
| 7.5 Maintainability | Failure log with no secrets; schema-driven categories; CI; repeatable browser suites | U, CI | Accepted |
| 7.6 Portability | Chromium and WebKit at 1366 and 390 px; light, dark and auto themes | J in both engines | Accepted (emulated only) |

## 4. Cross-browser and responsive

| Engine | 1366 px | 390 px |
|---|---|---|
| Chromium (Chrome for Testing 1248) | 27/27 | 27/27 |
| WebKit (Playwright build 2370) | 27/27 | 27/27 |
| Hosted Chromium (Vercel + Supabase) | 27/27 | 27/27 after fixing D-6 |

Microsoft Edge uses the same Chromium engine and was used for manual review. Safari.app and physical phones were not tested.

## 5. Defects found in M8–M9 and fixed (before → after)

| # | Defect | Before | After | Test |
|---|---|---|---|---|
| D-1 | Staff cookie `Max-Age=1800` was never refreshed | Active staff signed out after 30 min | Cookie lasts the full session (8 h); the server enforces the 30-min idle limit | http test (seen failing first) |
| D-2 | API role could rewrite publication history | UPDATE/DELETE granted | Append-only | db test (seen failing first) |
| D-3 | Platform function executable by API roles | Advisor: 2 warnings | 0 findings | Advisor, probe |
| D-4 | Generated images presented as real places (for example a non-existent museum building) | 11 AI images, some reused across different places | Real Commons photos; exact or representative captions | `media.test.ts` (seen failing first) |
| D-5 | Card image frames stretched by 4:3 photos | Uneven card heights | All 179 px (desktop) | Media height probe |
| D-6 | Hero photo credit covered the search button at 390 px (hosted run) | Search button not clickable; journey failed at step 2 | 22 px gap at 320–1366 px | `keyboard.mjs` check, journey 27/27 |
| D-7 | Heading order skipped from h1 to h3 on listing pages | 4 pages × 2 themes flagged | 0 violations | axe |
| D-8 | Mobile listing pages started with about 15 filter controls | First result about 1,240 px down | Collapsible filters; first result at 379 px; Search closes the panel and shows the active count | `filters.mjs` (2 checks) |
| D-9 | Read-only sharing listed in the extension register but not built | — | Built (ADR-007) | 3 tests and J14 |

## 6. Remaining limitations

1. **Sarawak Tourism Board photos:** not used, because downloads need a member login. The owner can register and download chosen photos, and they can then be added with the credit and non-commercial conditions recorded.
2. **Event content:** one real upcoming event has been added: Borneo Jazz Festival 2026 (4–5 Dec, Miri), reported by The Star. No 2027 dates for the Rainforest World Music Festival or Borneo Jazz had been announced on 24 Nov 2026. The other upcoming events are labelled demonstrations.
3. **Images:** the four fictional stays share one AI illustration, and 9 records show category icons (for example Lepau Restaurant and most visitor guidance).
4. **Production prerequisites (not done):**
   - a separate production database or Supabase project, since preview and production must not share data;
   - production environment variables and an admin bootstrap;
   - a privacy and data notice page (PDPA): what is stored and for how long. **Done:** `/privacy`, linked from the footer and the registration page.
5. **Accounts:** there is no admin-initiated staff password reset and no email recovery (recovery codes only, ADR-004).
6. **Interest filter:** free text, not a controlled list.
7. **Testing scope:** no physical-device, Safari.app or screen-reader (VoiceOver or NVDA) test. Accessibility evidence comes from automated axe and keyboard checks.
8. **Audit trail:** the hosted history includes the synthetic QA actor's test edits, by design of the append-only history.
9. **Licensing:** Vercel Hobby and the Commons CC BY-SA and STB conditions suit a non-commercial project. Commercial use would need a plan change and a licence review.

## 7. Release recommendation

**Preview: release candidate, ready for owner acceptance.** All eight SRS tasks, accounts, staff management and the full itinerary lifecycle pass in two browser engines, locally and on the hosted preview, with no open functional defects.

**Production merge: not yet.** Keep PR #8 in draft until (a) the owner has reviewed the preview, (b) the production database and environment are decided and set up, (c) a privacy and data notice exists, and (d) real upcoming event content has been added.

## 8. Release decision (24 Nov 2026)

The owner approved production release. Before merging:
- **Privacy notice:** added at `/privacy`.
- **Real upcoming event:** added.
- **Production database:** configured (ADR-011).
- **Previews:** disconnected from live data.

Production verification results are in section 9.
