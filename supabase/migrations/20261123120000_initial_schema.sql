-- STIS initial schema: accounts, sessions, versioned tourism catalogue, itineraries.
-- Tables live in the "stis" schema, which the Supabase Data API does not expose.
-- RLS is enabled everywhere as defence in depth; the API role is the table owner.

create schema if not exists stis;

create table stis.account (
  id uuid primary key,
  email text not null unique check (email = lower(email) and length(email) between 3 and 254),
  display_name text not null check (length(display_name) between 1 and 60),
  role text not null check (role in ('tourist', 'staff', 'admin')),
  password_hash text not null,
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  password_changed_at timestamptz not null default now()
);

create table stis.account_session (
  token_digest text primary key,
  account_id uuid not null references stis.account(id) on delete cascade,
  created_at timestamptz not null,
  last_seen_at timestamptz not null,
  expires_at timestamptz not null,
  absolute_expires_at timestamptz not null
);
create index account_session_account on stis.account_session(account_id);

create table stis.recovery_code (
  account_id uuid not null references stis.account(id) on delete cascade,
  code_digest text not null,
  used_at timestamptz,
  primary key (account_id, code_digest)
);

create table stis.auth_throttle (
  key text primary key,
  window_started_at timestamptz not null,
  failures integer not null check (failures >= 0)
);

create table stis.tourism_record (
  id text primary key check (id ~ '^[A-Za-z0-9_-]{1,100}$'),
  kind text not null check (kind in ('destination', 'event', 'accommodation', 'transportation', 'dining', 'visitor')),
  created_at timestamptz not null default now(),
  unique (id, kind)
);

create table stis.record_version (
  record_id text not null references stis.tourism_record(id),
  version integer not null check (version >= 1),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  author_id uuid references stis.account(id) on delete set null,
  primary key (record_id, version)
);

create table stis.record_state (
  record_id text primary key references stis.tourism_record(id),
  draft integer not null,
  published integer,
  updated_at timestamptz not null default now(),
  foreign key (record_id, draft) references stis.record_version(record_id, version),
  foreign key (record_id, published) references stis.record_version(record_id, version)
);

create table stis.version_destination (
  record_id text not null,
  version integer not null,
  destination_id text not null references stis.tourism_record(id),
  primary key (record_id, version, destination_id),
  foreign key (record_id, version) references stis.record_version(record_id, version)
);
create index version_destination_target on stis.version_destination(destination_id);

create table stis.record_activity (
  id bigint generated always as identity primary key,
  record_id text not null references stis.tourism_record(id),
  action text not null check (action in ('create', 'save', 'publish', 'withdraw')),
  version integer not null,
  actor_id uuid references stis.account(id) on delete set null,
  at timestamptz not null default now()
);
create index record_activity_record on stis.record_activity(record_id, id);

create table stis.itinerary (
  id uuid primary key,
  owner_id uuid references stis.account(id) on delete cascade,
  guest_digest text unique,
  title text not null check (length(title) between 1 and 120),
  start_date text not null check (start_date ~ '^\d{4}-\d{2}-\d{2}$'),
  end_date text not null check (end_date ~ '^\d{4}-\d{2}-\d{2}$' and end_date >= start_date),
  provisional boolean not null,
  revision integer not null check (revision >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (owner_id is not null or guest_digest is not null)
);
create index itinerary_owner on stis.itinerary(owner_id, updated_at desc);

create table stis.itinerary_entry (
  id uuid primary key,
  itinerary_id uuid not null references stis.itinerary(id) on delete cascade,
  record_id text not null,
  kind text not null check (kind in ('destination', 'event', 'accommodation', 'transportation', 'dining')),
  day text not null check (day ~ '^\d{4}-\d{2}-\d{2}$'),
  start_time text not null,
  end_time text not null,
  note text not null default '' check (length(note) <= 500),
  position integer not null,
  foreign key (record_id, kind) references stis.tourism_record(id, kind),
  check ((start_time = '' and end_time = '') or (start_time <> '' and end_time <> '' and start_time < end_time))
);
create index itinerary_entry_plan on stis.itinerary_entry(itinerary_id, position);

alter table stis.account enable row level security;
alter table stis.account_session enable row level security;
alter table stis.recovery_code enable row level security;
alter table stis.auth_throttle enable row level security;
alter table stis.tourism_record enable row level security;
alter table stis.record_version enable row level security;
alter table stis.record_state enable row level security;
alter table stis.version_destination enable row level security;
alter table stis.record_activity enable row level security;
alter table stis.itinerary enable row level security;
alter table stis.itinerary_entry enable row level security;
