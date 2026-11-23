# SRS traceability register

Status values: **Planned**, **Partial**, **Done** (implemented and verified in a browser). The AS03 baseline is noted where it already exists.

| SRS item | Implementation (planned location) | Status |
|---|---|---|
| T1 Explore Destinations: interest categories, name search, review, compare, keep for planning; no match; incomplete information | Discovery pattern `/destinations`, detail page, compare tray, add to trip | Partial (AS03 baseline) |
| T2 Find Accommodation: location and type filters, special needs (accessibility, amenities), review, compare, choose, booking handoff; no match; incomplete | `/stay` with filters, detail, compare, external provider handoff with disclosure | Planned |
| T3 Find Transportation: origin and destination, operators, route and schedule, compare, choose, book; multi-leg; no direct option; schedule unavailable | `/transport` journey planner (direct and two-leg), operator referral, provenance on schedules | Planned |
| T4 Find Dining: location and cuisine filters, dietary needs, hours, compare, choose; no match; incomplete | `/dining` with dietary filters, detail, compare | Planned |
| T5 Find Events: date and location, latest status, choose, add to plan; no match; cancelled or postponed; registration link; change after adding | `/events`, detail, status, referral, itinerary notices | Partial (AS03 baseline) |
| T6 Plan Itinerary: create, travel date, provisional date, add items, arrange, review, update, conflicts, change during trip, delete | Trips dashboard and plan editor, multi-day, timeline, conflicts, notices | Partial (AS03 baseline) |
| T7 Find Visitor Information: categories, accessibility, safety, authority source link, unavailable information | `/visitor-info` by category and destination, authority links, explicit "unavailable" state | Planned |
| T8 Maintain Tourism Information: six categories, find, review, maintain, check, publish, create, edit, remove, missing information | Staff console with roles, editor, validation, history | Partial (AS03 baseline) |
| 7.1 Security: only authorised staff manage; tourists blocked | Role-based access in `ManagementAccessControl`; tests | Partial |
| 7.2 Reliability: failed update keeps published data; provider outage tolerated; status shown after update | Transactional publication; external links only; notices | Partial |
| 7.3 Usability: primary navigation shows categories; clear empty and error messages; missing fields identified | App shell navigation; shared states | Partial |
| 7.4 Efficiency: 3-second targets | Indexed queries; measured in M9 | Planned |
| 7.5 Maintainability: failure log; category independence; repeatable tests | Structured log; per-category classes; CI | Partial |
| 7.6 Portability | Responsive web; desktop, tablet and phone verified | Partial |
| 8.1 / 8.2 Product and design-level requirements | Consistent discovery pattern; external-provider disclosure; no internal transactions | Planned |
