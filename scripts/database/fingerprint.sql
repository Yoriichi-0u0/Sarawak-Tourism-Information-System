-- Schema fingerprint of stis. Read-only. Compare count and MD5 per category between a clean migrate() build and production.
-- contype <> 'n' excludes the NOT NULL catalog constraints that PostgreSQL 18 records and 17 does not.
with items as (
  select 'columns' as k, table_name || '.' || column_name || '|' || data_type || '|' || is_nullable || '|' || coalesce(column_default, '') || '|' || is_identity || '|' || coalesce(identity_generation, '') as v from information_schema.columns where table_schema = 'stis'
  union all select 'constraints', conrelid::regclass::text || '.' || conname || '|' || pg_get_constraintdef(oid) from pg_constraint where connamespace = 'stis'::regnamespace and contype <> 'n'
  union all select 'indexes', indexname || '|' || indexdef from pg_indexes where schemaname = 'stis'
  union all select 'policies', tablename || '.' || policyname || '|' || cmd || '|' || permissive || '|' || array_to_string(roles, ',') || '|' || coalesce(qual, '') || '|' || coalesce(with_check, '') from pg_policies where schemaname = 'stis'
  union all select 'rls', relname || '|' || relrowsecurity::text || '|' || relforcerowsecurity::text from pg_class where relnamespace = 'stis'::regnamespace and relkind = 'r'
  union all select 'triggers', tgrelid::regclass::text || '.' || tgname from pg_trigger where not tgisinternal and tgrelid in (select oid from pg_class where relnamespace = 'stis'::regnamespace)
  union all select 'stis_api_grants', c.relname || '|' || string_agg(a.privilege_type, ',' order by a.privilege_type) from pg_class c cross join lateral aclexplode(c.relacl) a join pg_roles r on r.oid = a.grantee and r.rolname = 'stis_api' where c.relnamespace = 'stis'::regnamespace and c.relkind in ('r','S') group by c.relname
  union all select 'migrations', version from stis.schema_migration
)
select k, count(*)::int as n, md5(string_agg(v, E'\n' order by v)) as hash from items group by k order by k
;
