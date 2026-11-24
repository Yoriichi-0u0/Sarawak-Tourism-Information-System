-- Least-privilege access for the API's database role, stis_api.
-- The role and its password are created outside version control (see docs/full-system/hosting.md).
-- When the role does not exist (local PGlite, tests) this migration changes nothing.
do $$
declare
  target text;
begin
  if exists (select 1 from pg_roles where rolname = 'stis_api') then
    grant usage on schema stis to stis_api;
    grant select, insert, update, delete on all tables in schema stis to stis_api;
    revoke insert, update, delete on stis.schema_migration from stis_api;
    grant usage, select on all sequences in schema stis to stis_api;
    for target in select tablename from pg_tables where schemaname = 'stis' loop
      execute format('drop policy if exists stis_api_access on stis.%I', target);
      execute format('create policy stis_api_access on stis.%I for all to stis_api using (true) with check (true)', target);
    end loop;
  end if;
end $$;
