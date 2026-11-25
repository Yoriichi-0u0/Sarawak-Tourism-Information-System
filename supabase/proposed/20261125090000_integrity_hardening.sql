-- PROPOSED, not applied. Database-level guards for rules the application already enforces, so that a defect
-- in a future code path (or a manual edit) cannot store data the application would never produce.
-- No existing row is changed or removed. Revision 2 (25 Nov 2026): DB-04 checks real Gregorian calendar dates.
-- Revision 1 used a month/day regex that accepted impossible dates such as 2026-02-31, 2025-02-29 and 0000-01-01.
--
-- Locking. migrate() runs this whole file in one transaction, so every lock below is held until COMMIT:
--   ACCESS EXCLUSIVE on version_destination (the stored generated column rewrites the table), itinerary and
--   itinerary_entry (ADD CHECK); SHARE ROW EXCLUSIVE on record_activity, tourism_record and record_version (ADD FOREIGN KEY).
-- While it runs, catalogue pages that join version_destination and every trip read or write wait. At production size
-- (25 Nov 2026: 85 links, 257 history rows, 1 trip) that takes milliseconds. lock_timeout makes the migration fail
-- fast, rather than queue behind a long transaction and block all traffic queued behind it. See MIGRATION_REPORT.md §5.
set local lock_timeout = '3s';

-- DB-02: a version's destination link must point at a destination record, not an event or a stay.
-- The derived column always holds 'destination'; the application never writes it.
alter table stis.version_destination
  add column destination_kind text not null generated always as ('destination') stored;
alter table stis.version_destination
  add constraint version_destination_destination_kind_fkey
  foreign key (destination_id, destination_kind) references stis.tourism_record(id, kind);
create index version_destination_target_kind on stis.version_destination(destination_id, destination_kind);

-- DB-03: every history entry names a version that exists.
alter table stis.record_activity
  add constraint record_activity_record_version_fkey
  foreign key (record_id, version) references stis.record_version(record_id, version);
create index record_activity_version on stis.record_activity(record_id, version);

-- DB-04: trip dates are real dates in the proleptic Gregorian calendar, years 0001 to 9999 (there is no year zero),
-- written YYYY-MM-DD with ASCII digits. This is the same rule as validDate() in server/domain.ts; the test
-- server/proposed.test.ts checks that both give the same answer for several thousand candidate strings.
-- The storage type stays text, so the API contract and existing rows are unchanged. The function never raises:
-- any string the pattern does not match is simply not a date.
create function stis.is_calendar_date(value text) returns boolean
  language sql immutable strict parallel safe
  set search_path = ''
  return case
    when value !~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' then false
    when substr(value, 1, 4) = '0000' then false
    else substr(value, 9, 2)::integer <= case substr(value, 6, 2)
      when '02' then case
        when substr(value, 1, 4)::integer % 400 = 0 then 29
        when substr(value, 1, 4)::integer % 100 = 0 then 28
        when substr(value, 1, 4)::integer % 4 = 0 then 29
        else 28 end
      when '04' then 30 when '06' then 30 when '09' then 30 when '11' then 30
      else 31 end
  end;
comment on function stis.is_calendar_date(text) is
  'True when the text is a YYYY-MM-DD date in the proleptic Gregorian calendar, years 0001-9999. Used by DB-04 CHECK constraints.';
revoke execute on function stis.is_calendar_date(text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'stis_api') then
    grant execute on function stis.is_calendar_date(text) to stis_api;
  end if;
end $$;

alter table stis.itinerary
  add constraint itinerary_calendar_dates check (stis.is_calendar_date(start_date) and stis.is_calendar_date(end_date));
alter table stis.itinerary_entry
  add constraint itinerary_entry_calendar_day check (stis.is_calendar_date(day));
-- Planned times are HH:MM on a 24-hour clock, or both blank.
alter table stis.itinerary_entry
  add constraint itinerary_entry_time_format check (
    (start_time = '' and end_time = '')
    or (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'));
