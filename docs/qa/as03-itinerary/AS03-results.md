# Guest itinerary acceptance results

27 November 2026 (Malaysia). Supplied AS03 branch ZIP, archive commit `0fb409645a341efbe9709f0717e9c5cb8cfd10d8`. Requested baseline `066b639306c3ecfaac82516ab8fdbaad39e27c60` remains unverified.

Windows, Node.js 24.21.0, npm 11.19.0. Package HTTP middleware invoked with synthetic request/response streams over process IPC (loopback socket access returned EACCES), running in a dedicated Node process with a fresh SQLite profile and synthetic records. The client build was absent and npm registry lookup failed (ENOTFOUND). Browser behavior was untested. The bundled AS03 service suite separately passed 10/10 with native TypeScript transformation.

| Scenario | Actual result | Verdict |
|---|---|---|
| Create guest plan | 201, empty plan | Pass |
| Add and review both entries | 200, Bako: Kuching / sample event: Waterfront stage | Pass |
| Overlap | 09:00–10:00 and 09:30–11:00 saved, one conflict | Pass |
| Invalid time | 25:00–26:00 → 400, Enter a start time and an end time that follows it, or leave both blank. Saved plan unchanged. | Pass |
| Reversed time | 11:00–10:00 → 400, Enter a start time and an end time that follows it, or leave both blank. Saved plan unchanged. | Pass |
| Adjacent intervals | 200, shared 10:00 boundary, zero conflicts | Pass |
| Stale removal | 409, This itinerary changed. Reopen it before saving. Both entries retained. | Pass |
| Invalid guest credential | 404, This itinerary access link is invalid or the itinerary was removed. | Pass |
| Reorder | 200, event moved ahead of destination | Pass |
| Change date | 200, 28 November saved as confirmed | Pass |
| Reopen after process restart | 200, same credential recovered identical date, order, revisions and intervals | Pass |
| Staff cancelled | Guest review: cancelled, planned 10:00–11:00 | Pass |
| Staff postponed | Guest review: postponed, planned 10:00–11:00 | Pass |
| Staff withdrawal | Guest review: unavailable, planned 10:00–11:00 | Pass |
| Remove event | 200, only Bako remains | Pass |
| Delete and reopen | 200 removed, then 404 using original guest credential | Pass |

No functional defects observed in these checks. Contribution hours were not recorded. The accompanying asciicast captures the redacted assertion output.
