# Extensions beyond the SRS

These are recorded for the owner to decide what stays and what belongs in the academic documentation.

| Extension | Purpose | Dependencies and risks | Status |
|---|---|---|---|
| Tourist accounts (register, login, profile, recovery codes, deletion) | Own and reopen plans across devices | Personal data under PDPA 2010: store the minimum (email, display name) | Done |
| Staff and admin accounts with roles | Individual accountability instead of one shared password | Admin bootstrap secret handling | Done |
| Guest-plan claim | Keep account-free planning (SRS assumption) while allowing ownership later | Guest link revoked on claim | Done |
| Multi-day itineraries and timeline view | Real trips span several days | Conflict detection becomes per day | Done |
| Itinerary export (.ics calendar, print) and read-only sharing | Use the plan outside the system | Share link is a capability: revocable | Partial — .ics and print done; read-only sharing not built |
| Journey planner (two-leg) | SRS 1a "more than one transport option" made concrete | Only as good as the transport records | Done |
| Record history and audit trail | Accountability for published changes | None | Done |
| Provenance labels | Honest separation of verified and illustrative data | Requires periodic review dates | Done |
| Auto, Light and Dark themes | Comfort and accessibility | None (exists since AS03 Theme batch) | Done |
| Comparison for every category except visitor guidance | Side-by-side review (SRS asks for it in T1–T4) applied consistently | None | Done |
