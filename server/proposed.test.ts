// Tests for supabase/proposed/: hardening migrations awaiting owner approval. They are not loaded by
// migrate(), so production and the checked-in migration history stay identical until one is approved.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { migrate, type Db } from "./db.ts";
import { Application } from "./services.ts";
import { freshDb } from "./testing.ts";

const proposed = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "proposed");
const name = "20261125090000_integrity_hardening";
const up = (db: Db) => db.transaction((tx) => tx.exec(readFileSync(join(proposed, `${name}.sql`), "utf8")));
const down = (db: Db) => db.transaction((tx) => tx.exec(readFileSync(join(proposed, `${name}.down.sql`), "utf8")));
const code = (expected: string) => (error: unknown) => (error as { code?: string }).code === expected;

async function shape(db: Db) {
  const columns = await db.query(`select table_name, column_name, data_type, is_nullable, is_generated from information_schema.columns
    where table_schema = 'stis' order by table_name, column_name`);
  const constraints = await db.query(`select conrelid::regclass::text as rel, conname, pg_get_constraintdef(oid) as def from pg_constraint
    where connamespace = 'stis'::regnamespace and contype <> 'n' order by 1, 2`);
  const indexes = await db.query("select indexname, indexdef from pg_indexes where schemaname = 'stis' order by 1");
  return JSON.stringify({ columns, constraints, indexes });
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
