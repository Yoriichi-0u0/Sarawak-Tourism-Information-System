do $$
begin
  if exists (select 1 from pg_roles where rolname = 'stis_api') then
    grant update, delete on stis.tourism_record, stis.record_version, stis.version_destination, stis.record_activity to stis_api;
  end if;
end $$;
