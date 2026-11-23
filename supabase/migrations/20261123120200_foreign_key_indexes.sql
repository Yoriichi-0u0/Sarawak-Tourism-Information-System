-- Covering indexes for foreign keys flagged by the Supabase performance advisor.
create index if not exists itinerary_entry_record on stis.itinerary_entry(record_id, kind);
create index if not exists record_activity_actor on stis.record_activity(actor_id);
create index if not exists record_state_draft on stis.record_state(record_id, draft);
create index if not exists record_state_published on stis.record_state(record_id, published);
create index if not exists record_version_author on stis.record_version(author_id);
