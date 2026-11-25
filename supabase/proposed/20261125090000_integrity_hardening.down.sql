-- Rollback for 20261125090000_integrity_hardening. Removes only the objects it added; the dropped column is
-- derived (always 'destination'), so no information is lost.
alter table stis.itinerary_entry drop constraint if exists itinerary_entry_time_format;
alter table stis.itinerary_entry drop constraint if exists itinerary_entry_day_in_range;
alter table stis.itinerary drop constraint if exists itinerary_dates_in_range;
drop index if exists stis.record_activity_version;
alter table stis.record_activity drop constraint if exists record_activity_record_version_fkey;
drop index if exists stis.version_destination_target_kind;
alter table stis.version_destination drop constraint if exists version_destination_destination_kind_fkey;
alter table stis.version_destination drop column if exists destination_kind;
