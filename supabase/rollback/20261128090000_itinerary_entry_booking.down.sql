-- Removes booking marks from itinerary stops. The stops themselves, their days, times and notes are kept;
-- only the "booked with" provider and check-out dates are lost. Dropping the columns drops their constraints.
alter table stis.itinerary_entry
  drop column if exists booked_until,
  drop column if exists booked_with;
