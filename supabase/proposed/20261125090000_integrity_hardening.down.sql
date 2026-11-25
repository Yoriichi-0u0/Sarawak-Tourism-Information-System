-- Rollback for 20261125090000_integrity_hardening (revision 2). Removes only the objects it added. Dropping the
-- derived column is a catalog change (no rewrite) and loses no information, because it always holds 'destination'.
set local lock_timeout = '3s';
alter table stis.itinerary_entry drop constraint if exists itinerary_entry_time_format;
alter table stis.itinerary_entry drop constraint if exists itinerary_entry_calendar_day;
alter table stis.itinerary drop constraint if exists itinerary_calendar_dates;
drop function if exists stis.is_calendar_date(text);
drop index if exists stis.record_activity_version;
alter table stis.record_activity drop constraint if exists record_activity_record_version_fkey;
drop index if exists stis.version_destination_target_kind;
alter table stis.version_destination drop constraint if exists version_destination_destination_kind_fkey;
alter table stis.version_destination drop column if exists destination_kind;
