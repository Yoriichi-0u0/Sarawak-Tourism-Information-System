-- A tourist can mark an itinerary stop as booked or reserved with an outside provider (issue #10, step 2).
-- STIS stores only the provider's host (or "phone") and, for a stay, the check-out date. Check-in is the
-- stop's existing day. No price, booking reference or payment detail is stored in these columns.
--
-- Locks: ACCESS EXCLUSIVE on stis.itinerary_entry until COMMIT. Both columns have constant defaults, so adding
-- them rewrites nothing; the CHECK constraints scan the table once (a few rows in production).

alter table stis.itinerary_entry
  add column booked_with text not null default '',
  add column booked_until text not null default '';

alter table stis.itinerary_entry
  add constraint itinerary_entry_booked_with_length check (length(booked_with) <= 100),
  add constraint itinerary_entry_booked_until_format check (booked_until = '' or booked_until ~ '^\d{4}-\d{2}-\d{2}$'),
  -- A check-out date needs a provider and must fall after check-in (the stop's day).
  add constraint itinerary_entry_booking_dates check (booked_until = '' or (booked_with <> '' and booked_until > day)),
  -- Only stays have a check-out date, so an event stop can never hold a copy of an event's date.
  add constraint itinerary_entry_checkout_stays check (booked_until = '' or kind = 'accommodation'),
  -- Destinations are places to visit, not bookings.
  add constraint itinerary_entry_booking_kind check (booked_with = '' or kind <> 'destination');
