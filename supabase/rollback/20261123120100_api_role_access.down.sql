do $$
declare
  target text;
begin
  for target in select tablename from pg_tables where schemaname = 'stis' loop
    execute format('drop policy if exists stis_api_access on stis.%I', target);
  end loop;
  if exists (select 1 from pg_roles where rolname = 'stis_api') then
    revoke all on all tables in schema stis from stis_api;
    revoke all on all sequences in schema stis from stis_api;
    revoke usage on schema stis from stis_api;
  end if;
end $$;
