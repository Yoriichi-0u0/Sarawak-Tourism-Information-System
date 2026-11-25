-- STIS live-data invariants. Read-only: every row is a count of violating rows (check 13 reports the active-admin count).
select * from (values
 (1, 'draft is the highest version', (select count(*) from stis.record_state s where s.draft <> (select max(v.version) from stis.record_version v where v.record_id = s.record_id))),
 (2, 'published <= draft', (select count(*) from stis.record_state where published > draft)),
 (3, 'every record has a state row', (select count(*) from stis.tourism_record r where not exists (select 1 from stis.record_state s where s.record_id = r.id))),
 (4, 'destination links target destinations', (select count(*) from stis.version_destination d join stis.tourism_record r on r.id = d.destination_id where r.kind <> 'destination')),
 (5, 'published versions link only to published destinations', (select count(*) from stis.version_destination d join stis.record_state s on s.record_id = d.record_id and s.published = d.version left join stis.record_state t on t.record_id = d.destination_id where t.published is null)),
 (6, 'activity names an existing version', (select count(*) from stis.record_activity a where not exists (select 1 from stis.record_version v where v.record_id = a.record_id and v.version = a.version))),
 (7, 'every version has a create or save activity', (select count(*) from stis.record_version v where not exists (select 1 from stis.record_activity a where a.record_id = v.record_id and a.version = v.version and a.action in ('create', 'save')))),
 (8, 'no trip has both owner and guest', (select count(*) from stis.itinerary where owner_id is not null and guest_digest is not null)),
 (9, 'stops lie within trip dates', (select count(*) from stis.itinerary_entry e join stis.itinerary i on i.id = e.itinerary_id where e.day < i.start_date or e.day > i.end_date)),
 (10, 'no duplicate stop positions', (select count(*) from (select itinerary_id, position from stis.itinerary_entry group by 1, 2 having count(*) > 1) x)),
 (11, 'payloads are JSON objects', (select count(*) from stis.record_version where jsonb_typeof(payload) <> 'object')),
 (12, 'password hashes are scrypt', (select count(*) from stis.account where password_hash not like 'scrypt$%')),
 (13, 'active administrators (must be >= 1)', (select count(*) from stis.account where role = 'admin' and status = 'active')),
 (14, 'trip dates are Gregorian calendar dates and stop times are HH:MM (proposed DB-04, revision 2)', (select count(*) from (
       select start_date as d from stis.itinerary union all select end_date from stis.itinerary union all select day from stis.itinerary_entry) dates
       where not case
         when d !~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' then false
         when substr(d, 1, 4) = '0000' then false
         else substr(d, 9, 2)::integer <= case substr(d, 6, 2)
           when '02' then case when substr(d, 1, 4)::integer % 400 = 0 then 29 when substr(d, 1, 4)::integer % 100 = 0 then 28
                               when substr(d, 1, 4)::integer % 4 = 0 then 29 else 28 end
           when '04' then 30 when '06' then 30 when '09' then 30 when '11' then 30 else 31 end end)
     + (select count(*) from stis.itinerary_entry where not ((start_time = '' and end_time = '')
         or (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')))),
 (15, 'trips <= 14 days and <= 50 stops', (select count(*) from stis.itinerary i where case when pg_input_is_valid(i.start_date, 'date') and pg_input_is_valid(i.end_date, 'date') then i.end_date::date - i.start_date::date + 1 > 14 else false end or (select count(*) from stis.itinerary_entry e where e.itinerary_id = i.id) > 50)),
 (16, 'payload destinationIds = version_destination rows', (with p as (select v.record_id, v.version, t.target from stis.record_version v cross join lateral unnest(string_to_array(coalesce(v.payload->>'destinationIds', ''), ',')) t(target) where t.target <> ''),
       l as (select record_id, version, destination_id as target from stis.version_destination)
       select (select count(*) from (select * from p except select * from l) a) + (select count(*) from (select * from l except select * from p) b))),
 (17, 'every published version has a publish activity', (select count(*) from stis.record_state s where s.published is not null and not exists (select 1 from stis.record_activity a where a.record_id = s.record_id and a.version = s.published and a.action = 'publish'))),
 (18, 'each record''s first activity is create', (select count(*) from stis.tourism_record r where (select a.action from stis.record_activity a where a.record_id = r.id order by a.id limit 1) is distinct from 'create'))
) as checks(n, invariant, value) order by n;
