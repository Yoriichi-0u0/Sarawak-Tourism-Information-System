-- PROPOSED, not applied. Database-level guards for rules the application already enforces, so that a defect
-- in a future code path (or a manual edit) cannot store data the application would never produce.
-- Every statement is additive: no row is changed or removed. Constraints are added NOT VALID and then
-- validated, so existing rows are checked without holding a long exclusive lock. On 25 Nov 2026 the live
-- data was checked read-only against every predicate below and no row would be rejected.

-- DB-02: a version's destination link must point at a destination record, not an event or a stay.
-- The derived column always holds 'destination'; the application never writes it.
alter table stis.version_destination
  add column destination_kind text not null generated always as ('destination') stored;
alter table stis.version_destination
  add constraint version_destination_destination_kind_fkey
  foreign key (destination_id, destination_kind) references stis.tourism_record(id, kind) not valid;
alter table stis.version_destination validate constraint version_destination_destination_kind_fkey;
create index version_destination_target_kind on stis.version_destination(destination_id, destination_kind);

-- DB-03: every history entry names a version that exists.
alter table stis.record_activity
  add constraint record_activity_record_version_fkey
  foreign key (record_id, version) references stis.record_version(record_id, version) not valid;
alter table stis.record_activity validate constraint record_activity_record_version_fkey;
create index record_activity_version on stis.record_activity(record_id, version);

-- DB-04: calendar dates use real month and day ranges, and planned times are HH:MM on a 24-hour clock.
alter table stis.itinerary
  add constraint itinerary_dates_in_range check (
    start_date ~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$'
    and end_date ~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$') not valid;
alter table stis.itinerary validate constraint itinerary_dates_in_range;
alter table stis.itinerary_entry
  add constraint itinerary_entry_day_in_range check (day ~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$') not valid;
alter table stis.itinerary_entry validate constraint itinerary_entry_day_in_range;
alter table stis.itinerary_entry
  add constraint itinerary_entry_time_format check (
    (start_time = '' and end_time = '')
    or (start_time ~ '^([01]\d|2[0-3]):[0-5]\d$' and end_time ~ '^([01]\d|2[0-3]):[0-5]\d$')) not valid;
alter table stis.itinerary_entry validate constraint itinerary_entry_time_format;
