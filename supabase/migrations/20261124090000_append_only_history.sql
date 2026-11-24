-- Publication history is append-only for the API role: records, versions, destination links and
-- the activity log are only ever inserted. Revoking UPDATE and DELETE means a leaked API credential
-- cannot rewrite or erase who published what. Foreign-key actions (account deletion setting
-- author_id/actor_id to null) run as the table owner and are unaffected.
-- When the role does not exist (local PGlite without the role) this migration changes nothing.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'stis_api') then
    revoke update, delete on stis.tourism_record, stis.record_version, stis.version_destination, stis.record_activity from stis_api;
  end if;
end $$;
