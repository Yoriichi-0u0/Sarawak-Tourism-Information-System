// Tests for supabase/proposed/: hardening migrations awaiting owner approval. They are not loaded by
// migrate(), so production and the checked-in migration history stay identical until one is approved.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { migrate, type Db } from "./db.ts";
import { validDate } from "./domain.ts";
import { Application } from "./services.ts";
import { freshDb } from "./testing.ts";

const proposed = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "proposed");
const name = "20261125090000_integrity_hardening";
const up = (db: Db) => db.transaction((tx) => tx.exec(readFileSync(join(proposed, `${name}.sql`), "utf8")));
const down = (db: Db) => db.transaction((tx) => tx.exec(readFileSync(join(proposed, `${name}.down.sql`), "utf8")));
const code = (expected: string) => (error: unknown) => (error as { code?: string }).code === expected;

/** Dates the earlier DB-04 proposal wrongly accepted, and other impossible or malformed dates. */
const impossibleDates = ["2026-02-31", "2026-04-31", "2025-02-29", "0000-01-01", "1900-02-29", "2100-02-29", "2026-06-31",
  "2026-09-31", "2026-11-31", "2026-02-30", "2026-13-01", "2026-00-10", "2026-12-00", "2026-12-32", "\u0662\u0660\u0662\u0666-01-01",
  "\uff12\uff10\uff12\uff16-01-01", "2026-01-01\n", "+2026-01-01", "2026-1-01", "20260101", ""];
/** Real Gregorian dates, including leap days in century years divisible by 400 and the bounds of a four-digit year. */
const calendarDates = ["2024-02-29", "2000-02-29", "2400-02-29", "2028-02-29", "0001-01-01", "9999-12-31", "2026-01-31", "2026-04-30", "2026-12-31"];

async function withRoles(db: Db) {
  await db.exec(`do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'stis_api') then create role stis_api nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'stis_outsider') then create role stis_outsider nologin; end if;
  end $$;`);
}

async function shape(db: Db) {
  const columns = await db.query(`select table_name, column_name, data_type, is_nullable, is_generated from information_schema.columns
    where table_schema = 'stis' order by table_name, column_name`);
  const constraints = await db.query(`select conrelid::regclass::text as rel, conname, pg_get_constraintdef(oid) as def from pg_constraint
    where connamespace = 'stis'::regnamespace and contype <> 'n' order by 1, 2`);
  const indexes = await db.query("select indexname, indexdef from pg_indexes where schemaname = 'stis' order by 1");
  const functions = await db.query(`select proname, pg_get_function_identity_arguments(oid) as args, proacl::text as acl from pg_proc
    where pronamespace = 'stis'::regnamespace order by 1, 2`);
  return JSON.stringify({ columns, constraints, indexes, functions });
}

test("the proposed integrity migration applies on top of the history and rolls back to an identical schema", async (t) => {
  const db = await freshDb(t);
  t.after(() => db.close());
  await migrate(db);
  const before = await shape(db);
  await up(db);
  assert.notEqual(await shape(db), before, "the migration changes the schema");
  await down(db);
  assert.equal(await shape(db), before, "the rollback restores the verified production shape");
  await up(db);
  assert.deepEqual((await db.query<{ version: string }>("select version from stis.schema_migration order by 1")).map(({ version }) => version).includes(name), false,
    "proposed migrations are never recorded in the production ledger by the test");
});

test("after hardening, the database itself rejects rows that only the application rejected before", async (t) => {
  const db = await freshDb(t);
  t.after(() => db.close());
  await migrate(db);
  await up(db);
  await db.exec(`insert into stis.tourism_record(id, kind) values ('h-place', 'destination'), ('h-event', 'event');
    insert into stis.record_version(record_id, version, payload) values ('h-place', 1, '{}'), ('h-event', 1, '{}');
    insert into stis.itinerary(id, guest_digest, title, start_date, end_date, provisional, revision)
      values ('00000000-0000-4000-8000-0000000000a1', 'synthetic-digest', 'Synthetic', '2026-12-01', '2026-12-02', true, 1);`);
  await db.query("insert into stis.version_destination(record_id, version, destination_id) values ('h-event', 1, 'h-place')");
  const [link] = await db.query<{ destination_kind: string }>("select destination_kind from stis.version_destination");
  assert.equal(link.destination_kind, "destination", "the derived column needs no input from the application");
  await assert.rejects(db.query("insert into stis.version_destination(record_id, version, destination_id) values ('h-place', 1, 'h-event')"),
    code("23503"), "a link to an event is not a destination link");
  await db.query("insert into stis.record_activity(record_id, action, version) values ('h-place', 'create', 1)");
  await assert.rejects(db.query("insert into stis.record_activity(record_id, action, version) values ('h-place', 'publish', 7)"),
    code("23503"), "history cannot name a version that does not exist");
  for (const [start, end] of [["2026-13-01", "2026-13-02"], ["2026-12-00", "2026-12-02"], ["2026-12-01", "2026-12-32"]])
    await assert.rejects(db.query(`insert into stis.itinerary(id, guest_digest, title, start_date, end_date, provisional, revision)
      values (gen_random_uuid(), md5(random()::text), 'Bad', $1, $2, true, 1)`, [start, end]), code("23514"), `${start}..${end}`);
  const entry = (day: string, start: string, finish: string) => db.query(`insert into stis.itinerary_entry(id, itinerary_id, record_id, kind, day, start_time, end_time, position)
    values (gen_random_uuid(), '00000000-0000-4000-8000-0000000000a1', 'h-place', 'destination', $1, $2, $3, 0)`, [day, start, finish]);
  await entry("2026-12-01", "09:00", "10:30");
  await entry("2026-12-01", "", "");
  for (const [day, start, finish] of [["2026-12-01", "9:00", "10:00"], ["2026-12-01", "24:00", "24:30"], ["2026-12-01", "09:60", "10:00"], ["2026-02-30x", "", ""]])
    await assert.rejects(entry(day, start, finish), code("23514"), `${day} ${start}-${finish}`);
  const trip = (start: string, end: string) => db.query(`insert into stis.itinerary(id, guest_digest, title, start_date, end_date, provisional, revision)
    values (gen_random_uuid(), md5(random()::text), 'Calendar', $1, $2, true, 1)`, [start, end]);
  for (const day of impossibleDates) {
    await assert.rejects(trip(day, "9999-12-31"), code("23514"), `start date ${JSON.stringify(day)}`);
    await assert.rejects(trip("0001-01-01", day), code("23514"), `end date ${JSON.stringify(day)}`);
    await assert.rejects(entry(day, "", ""), code("23514"), `stop day ${JSON.stringify(day)}`);
  }
  for (const day of calendarDates) {
    await trip(day, day);
    await entry(day, "", "");
  }
});

test("the database and the API agree on which strings are calendar dates", async (t) => {
  const db = await freshDb(t);
  t.after(() => db.close());
  await migrate(db);
  await up(db);
  const years = ["0000", "0001", "0004", "0100", "0400", "1582", "1900", "1999", "2000", "2023", "2024", "2025", "2026", "2100", "2400", "9999"];
  const two = (value: number) => String(value).padStart(2, "0");
  const candidates = [...impossibleDates, ...calendarDates,
    ...years.flatMap((year) => Array.from({ length: 14 }, (_, month) => Array.from({ length: 33 }, (_, day) => `${year}-${two(month)}-${two(day)}`)).flat())];
  const rows = await db.query<{ value: string; ok: boolean }>(`select value, stis.is_calendar_date(value) as ok
    from jsonb_array_elements_text($1::text::jsonb) with ordinality as t(value, n) order by n`, [JSON.stringify(candidates)]);
  assert.equal(rows.length, candidates.length);
  const disagreements = rows.filter(({ value, ok }) => ok !== validDate(value)).map(({ value, ok }) => `${JSON.stringify(value)} db=${ok}`);
  assert.deepEqual(disagreements, [], "every candidate gets the same answer from PostgreSQL and from validDate");
  const accepted = (year: string) => new Set(rows.filter(({ value, ok }) => ok && value.startsWith(`${year}-`)).map(({ value }) => value)).size;
  assert.deepEqual(Object.fromEntries(years.map((year) => [year, accepted(year)])), {
    "0000": 0, "0001": 365, "0004": 366, "0100": 365, "0400": 366, "1582": 365, "1900": 365, "1999": 365,
    "2000": 366, "2023": 365, "2024": 366, "2025": 365, "2026": 365, "2100": 365, "2400": 366, "9999": 365,
  }, "the proleptic Gregorian calendar, without a year zero");
});

test("the API role can store calendar dates through the guard; other roles cannot call it", async (t) => {
  const db = await freshDb(t);
  t.after(() => db.close());
  await withRoles(db);
  await migrate(db);
  await up(db);
  const [privileges] = await db.query<{ api: boolean; outsider: boolean }>(`select
    has_function_privilege('stis_api', 'stis.is_calendar_date(text)', 'execute') as api,
    has_function_privilege('stis_outsider', 'stis.is_calendar_date(text)', 'execute') as outsider`);
  assert.deepEqual(privileges, { api: true, outsider: false });
  const insert = (start: string, end: string) => db.transaction(async (tx) => {
    await tx.exec("set local role stis_api");
    await tx.query(`insert into stis.itinerary(id, guest_digest, title, start_date, end_date, provisional, revision)
      values (gen_random_uuid(), md5(random()::text), 'API role', $1, $2, true, 1)`, [start, end]);
  });
  await insert("2028-02-28", "2028-02-29");
  await assert.rejects(insert("2026-02-27", "2026-02-31"), code("23514"));
  await assert.rejects(insert("2025-02-28", "2025-02-29"), code("23514"));
});

test("the application's publication, history and itinerary workflows are unchanged on the hardened schema", async (t) => {
  const db = await freshDb(t);
  const app = await Application.open({ db, hashCost: { N: 1024, r: 8, p: 1 }, admin: { email: "staff@example.test", password: "synthetic-staff-credential" } });
  t.after(() => app.close());
  await up(db);
  const staff = (await app.accounts.signIn({ email: "staff@example.test", password: "synthetic-staff-credential" })).session;
  const destination = (await app.manager.listDrafts(staff)).find(({ kind, publishedVersion }) => kind === "destination" && publishedVersion !== null)!;
  const event = await app.manager.saveDraft(staff, null, "event", { title: "Synthetic hardening event", venue: "Hall", status: "scheduled",
    startsAt: "2026-12-01T10:00", summary: "Synthetic.", destinationIds: destination.id }, null);
  const published = await app.manager.publish(staff, event.id, event.version);
  assert.equal(published.publishedVersion, event.version);
  await assert.rejects(app.manager.saveDraft(staff, null, "event", { title: "Linked to an event", venue: "Hall", status: "scheduled",
    startsAt: "2026-12-01T10:00", summary: "Synthetic.", destinationIds: event.id }, null), (error: unknown) => (error as { status?: number }).status === 422,
  "the application still answers first with its own validation message");
  const history = await app.manager.history(staff, event.id);
  assert.deepEqual(history.map(({ action }) => action), ["publish", "create"]);
  const trip = await app.coordinator.createItinerary({ date: "2026-12-01", endDate: "2026-12-02", provisional: false });
  const added = await app.coordinator.updateItinerary(trip.plan.id, trip.guest!, 1, { action: "add", recordId: event.id, day: "2026-12-02", start: "09:00", end: "11:00" });
  assert.equal(added.entries.length, 1);
  await app.manager.withdraw(staff, event.id);
  assert.equal((await app.coordinator.reviewItinerary(trip.plan.id, trip.guest!)).entries[0].notice, "unavailable");
});
