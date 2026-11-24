import assert from "node:assert/strict";
import { test } from "node:test";

import { destinationInterests } from "../src/shared/contracts.ts";
import type { RecordKind, TourismItem } from "../src/shared/contracts.ts";
import type { Db } from "./db.ts";
import { InputError, ItineraryEntry } from "./domain.ts";
import { Application } from "./services.ts";
import { durableStorage, freshDb } from "./testing.ts";

const password = "synthetic-staff-credential";
const staffEmail = "staff@example.test";
const date = "2026-11-27";
const settings = { date, provisional: true };
export const testCost = { N: 1024, r: 8, p: 1 };
type After = { after: (fn: () => unknown) => void };

async function open(t: After, options: { db?: Db; admin?: boolean; adminPassword?: string; clock?: () => Date } = {}) {
  const db = options.db ?? await freshDb(t);
  const app = await Application.open({
    db, hashCost: testCost, clock: options.clock,
    admin: options.admin === false ? undefined : { email: staffEmail, password: options.adminPassword ?? password },
  });
  t.after(() => app.close());
  return app;
}

async function guestPlan(app: Application, settings: unknown) {
  const created = await app.coordinator.createItinerary(settings);
  assert.ok(created.guest);
  return { plan: created.plan, guest: created.guest };
}

async function durable(t: After, prefix: string) {
  const storage = await durableStorage(prefix);
  let current: Application | undefined;
  const start = async (adminPassword = password) => {
    await current?.close();
    current = await Application.open({ db: await storage.open(), hashCost: testCost, admin: { email: staffEmail, password: adminPassword } });
    return current;
  };
  t.after(async () => { await current?.close(); await storage.cleanup(); });
  return { app: await start(), restart: start };
}

async function signIn(app: Application, secret = password) {
  return (await app.accounts.signIn({ email: staffEmail, password: secret })).session;
}

test("interest suggestions keep the spelling of published destination categories without duplicates", async () => {
  const catalogue: TourismItem[] = [
    { id: "nature", kind: "destination", version: 1, fields: { interest: " Nature & wildlife " } },
    { id: "culture", kind: "destination", version: 1, fields: { interest: "Culture & heritage" } },
    { id: "another-culture", kind: "destination", version: 1, fields: { interest: "culture & heritage" } },
    { id: "blank", kind: "destination", version: 1, fields: { interest: " " } },
    { id: "event", kind: "event", version: 1, fields: { interest: "Events" } },
  ];
  assert.deepEqual(destinationInterests(catalogue), ["Culture & heritage", "Nature & wildlife"]);
});

test("catalogue searches published destinations and events", async (t) => {
  const app = await open(t);
  const destinations = (await app.catalog.findDestinations({ query: "bako" }));
  assert.equal(destinations.length, 1);
  assert.equal(destinations[0].id, "bako");
  assert.deepEqual(
    (await app.catalog.findDestinations({ query: "bako", location: "Kuching", interest: "Nature" })).map(({ id }) => id),
    ["bako"],
  );
  assert.deepEqual((await app.catalog.findDestinations({ query: "bako", interest: "Culture" })), []);
  assert.ok((await app.catalog.findEvents({ date })).some((event) => event.id === "sample-event"));
  assert.deepEqual((await app.catalog.findEvents({ date: "2026-11-29" })), []);
  await assert.rejects(async () => (await app.catalog.findEvents({ date: "2026-02-30" })), /valid date/);
});

test("publication validates drafts and preserves the last published version", async (t) => {
  const app = await open(t);
  const draft = (await app.manager.getDraft((await signIn(app)), "sample-event"));
  const staff = (await signIn(app));
  const invalid = (await app.manager.saveDraft(staff, "sample-event", "event", { ...draft.fields, title: "" }, draft.version));
  await assert.rejects(async () => (await app.manager.publish(undefined, invalid.id, invalid.version)), /staff access/);
  await assert.rejects(async () => (await app.manager.publish(staff, invalid.id, invalid.version)), /required fields/);
  assert.equal((await app.catalog.getPublishedEvent("sample-event"))?.fields.status, "scheduled");
  const updated = (await app.manager.saveDraft(staff, invalid.id, "event", { ...draft.fields, status: "postponed" }, invalid.version));
  await assert.rejects(async () => (await app.manager.publish(staff, invalid.id, invalid.version)), /changed/);
  (await app.manager.publish(staff, updated.id, updated.version));
  assert.equal((await app.catalog.getPublishedEvent("sample-event"))?.fields.status, "postponed");
});

test("itinerary preserves planned times when events change or are withdrawn", async (t) => {
  const app = await open(t);
  let { plan, guest } = (await guestPlan(app, settings));
  await assert.rejects(async () => (await app.coordinator.reviewItinerary(plan.id, "other")), /itinerary access/);
  const add = async (recordId: string, start: string, end: string) => {
    plan = (await app.coordinator.updateItinerary(plan.id, guest, plan.revision, { action: "add", recordId, start, end }));
  };
  await add("bako", "09:00", "10:00");
  await add("sample-event", "09:30", "11:00");
  assert.deepEqual(plan.entries.map(({ location }) => location), ["Kuching", "Waterfront stage"]);
  await assert.rejects(async () => (await app.coordinator.reviewItinerary(plan.id, "other")), /itinerary access/);
  assert.equal(plan.conflicts.length, 1);
  const event = plan.entries[1];
  const oldRevision = plan.revision;
  plan = (await app.coordinator.updateItinerary(plan.id, guest, plan.revision, { action: "update", entryId: event.id, start: "10:00", end: "11:00" }));
  assert.deepEqual(plan.conflicts, []);
  await assert.rejects(
    async () => (await app.coordinator.updateItinerary(plan.id, guest, oldRevision, { action: "remove", entryId: event.id })),
    (error) => error instanceof InputError && error.status === 409,
  );
  plan = (await app.coordinator.updateItinerary(plan.id, guest, plan.revision, { action: "move", entryId: event.id, position: 0 }));
  const planned = plan.entries.map(({ id, start, end }) => ({ id, start, end }));
  const staff = (await signIn(app));
  const draft = (await app.manager.getDraft(staff, "sample-event"));
  const cancelled = (await app.manager.saveDraft(
    staff, draft.id, "event", { ...draft.fields, status: "cancelled", venue: "Relocated venue" }, draft.version,
  ));
  assert.equal((await app.coordinator.reviewItinerary(plan.id, guest)).entries[0].location, "Waterfront stage");
  (await app.manager.publish(staff, cancelled.id, cancelled.version));
  plan = (await app.coordinator.reviewItinerary(plan.id, guest));
  assert.equal(plan.entries[0].notice, "cancelled");
  assert.equal(plan.entries[0].location, "Relocated venue");
  (await app.manager.withdraw(staff, cancelled.id));
  plan = (await app.coordinator.reviewItinerary(plan.id, guest));
  assert.equal(plan.entries[0].notice, "unavailable");
  assert.equal(plan.entries[0].location, undefined);
  assert.deepEqual(plan.entries.map(({ id, start, end }) => ({ id, start, end })), planned);
  assert.equal(plan.date, date);
  assert.equal(plan.provisional, true);
  assert.deepEqual(plan.conflicts, []);
  (await app.coordinator.deleteItinerary(plan.id, guest));
  await assert.rejects(async () => (await app.coordinator.reviewItinerary(plan.id, guest)), /itinerary access/);
});

test("staff can create, revise, publish and withdraw each record category", async (t) => {
  const app = await open(t);
  const staff = (await signIn(app));
  const examples = new Map((await app.manager.listDrafts(staff)).map((record) => [record.kind, record]));
  const order: RecordKind[] = ["destination", "event", "accommodation", "transportation", "dining", "visitor"];
  const requiredField: Record<RecordKind, string> = {
    destination: "location", event: "venue", accommodation: "accommodationType",
    transportation: "operator", dining: "cuisine", visitor: "guidanceCategory",
  };
  for (const kind of order) {
    const example = examples.get(kind);
    assert.ok(example);
    const field = requiredField[kind];
    const draft = (await app.manager.saveDraft(staff, null, kind, { ...example.fields, [field]: "" }, null));
    await assert.rejects(
      async () => (await app.manager.publish(staff, draft.id, draft.version)),
      (error) => error instanceof InputError && error.status === 422 && Boolean(error.issues?.[field]),
    );
    assert.equal((await app.catalog.getPublishedRecord(draft.id)), undefined);
    const revised = (await app.manager.saveDraft(staff, draft.id, kind, { ...example.fields, title: `QA ${kind}` }, draft.version));
    (await app.manager.publish(staff, revised.id, revised.version));
    assert.ok((await app.catalog.listPublished(kind)).some(({ id }) => id === draft.id));
    (await app.manager.withdraw(staff, draft.id));
    assert.equal((await app.catalog.getPublishedRecord(draft.id)), undefined);
  }
});

test("a database fault rolls back publication and the saved state reopens", async (t) => {
  const fixture = await durable(t, "stis-storage");
  let app = fixture.app;
  const staff = (await signIn(app));
  const { plan, guest } = (await guestPlan(app, settings));
  const saved = (await app.coordinator.updateItinerary(plan.id, guest, plan.revision, {
    action: "add", recordId: "sample-event", start: "10:00", end: "11:00",
  }));
  const event = (await app.manager.getDraft(staff, "sample-event"));
  const draft = (await app.manager.saveDraft(staff, event.id, "event", { ...event.fields, status: "postponed" }, event.version));
  const [entry] = await app.db.query("select * from stis.itinerary_entry where id = $1", [saved.entries[0].id]);
  assert.ok(entry);
  assert.equal(Object.hasOwn(entry, "location"), false);
  await app.db.exec(`create function stis.fixture_stop() returns trigger language plpgsql as $$ begin raise exception 'fixture storage failure'; end $$;
    create trigger fixture_stop_publication before update of published on stis.record_state for each row execute function stis.fixture_stop();`);
  await assert.rejects(async () => (await app.manager.publish(staff, draft.id, draft.version)), /fixture storage failure/);
  await app.db.exec("drop trigger fixture_stop_publication on stis.record_state; drop function stis.fixture_stop();");
  assert.equal((await app.catalog.getPublishedEvent(event.id))?.fields.status, "scheduled");
  (await app.manager.publish(staff, draft.id, draft.version));
  app = await fixture.restart();
  assert.equal((await app.catalog.getPublishedEvent(event.id))?.fields.status, "postponed");
  const reopened = (await app.coordinator.reviewItinerary(plan.id, guest));
  assert.equal(reopened.date, date);
  assert.equal(reopened.entries[0].location, "Waterfront stage");
  assert.equal(reopened.entries[0].start, "10:00");
  assert.equal(reopened.entries[0].notice, "postponed");
});

function isInputError(status: number, pattern?: RegExp) {
  return (error: unknown) => error instanceof InputError && error.status === status &&
    (!pattern || pattern.test(error.message));
}

test("a destination cannot be withdrawn while published records refer to it", async (t) => {
  const app = await open(t);
  const staff = (await signIn(app));
  await assert.rejects(async () => (await app.manager.withdraw(staff, "culture")), isInputError(409, /refer to this destination first: \S.*\.$/));
  await assert.rejects(async () => (await app.manager.withdraw(staff, "culture")),
    (error) => error instanceof InputError && error.message.includes("Heritage craft workshop") && error.message.includes("Kuching Heritage Shuttle"),
    "the message names the records that still refer to the destination");
  assert.ok((await app.catalog.getPublishedRecord("culture")));
  (await app.manager.withdraw(staff, "sample-workshop"));
  await assert.rejects(async () => (await app.manager.withdraw(staff, "culture")), isInputError(409));
  (await app.manager.withdraw(staff, "sample-transport"));
  (await app.manager.withdraw(staff, "culture"));
  assert.equal((await app.catalog.getPublishedRecord("culture")), undefined);
});

test("publication requires each related destination to be published first", async (t) => {
  const app = await open(t);
  const staff = (await signIn(app));
  const destination = (await app.manager.saveDraft(staff, null, "destination", {
    title: "Synthetic Highlands", location: "Synthetic town", interest: "Adventure", summary: "Synthetic summary.",
  }, null));
  const event = (await app.manager.saveDraft(staff, null, "event", {
    title: "Synthetic hike", destinationIds: destination.id, venue: "Trailhead", status: "scheduled", startsAt: "2026-12-01T08:00",
  }, null));
  await assert.rejects(async () => (await app.manager.publish(staff, event.id, event.version)),
    (error) => isInputError(422)(error) && Boolean((error as InputError).issues?.destinationIds));
  assert.equal((await app.catalog.getPublishedRecord(event.id)), undefined);
  await assert.rejects(async () => (await app.manager.saveDraft(staff, null, "event", { title: "Orphan", destinationIds: "missing-place" }, null)),
    isInputError(422, /existing destinations/));
  (await app.manager.publish(staff, destination.id, destination.version));
  (await app.manager.publish(staff, event.id, event.version));
  assert.equal((await app.catalog.getPublishedEvent(event.id))?.fields.venue, "Trailhead");
});

test("a second save from the same draft version is rejected as stale", async (t) => {
  const app = await open(t);
  const staff = (await signIn(app));
  const draft = (await app.manager.getDraft(staff, "sample-workshop"));
  const first = (await app.manager.saveDraft(staff, draft.id, "event", { ...draft.fields, venue: "First venue" }, draft.version));
  assert.equal(first.version, draft.version + 1);
  await assert.rejects(async () => (await app.manager.saveDraft(staff, draft.id, "event", { ...draft.fields, venue: "Second venue" }, draft.version)),
    isInputError(409, /Reload it/));
  await assert.rejects(async () => (await app.manager.saveDraft(staff, draft.id, "event", draft.fields, undefined)), isInputError(400, /Reload the draft/));
  assert.equal((await app.manager.getDraft(staff, draft.id)).fields.venue, "First venue");
  assert.equal((await app.catalog.getPublishedEvent(draft.id))?.fields.venue, "Community studio");
});

test("staff sessions end at sign-out, after thirty idle minutes and after eight hours", async (t) => {
  let now = Date.parse("2026-11-27T00:00:00Z");
  const app = await open(t, { clock: () => new Date(now) });
  await assert.rejects(async () => signIn(app, "incorrect-synthetic-guess"), isInputError(401));
  const first = (await signIn(app));
  assert.equal((await app.access.permits(first)), true);
  (await app.accounts.signOut(first));
  assert.equal((await app.access.permits(first)), false);
  await assert.rejects(async () => (await app.manager.listDrafts(first)), isInputError(401));
  const second = (await signIn(app));
  now += 29 * 60_000;
  assert.equal((await app.access.permits(second)), true, "activity within 30 minutes keeps the session");
  now += 29 * 60_000;
  assert.equal((await app.access.permits(second)), true, "the idle window slides with activity");
  now += 31 * 60_000;
  assert.equal((await app.access.permits(second)), false, "31 idle minutes end the session");
  await assert.rejects(async () => (await app.manager.listDrafts(second)), isInputError(401));
  const third = (await signIn(app));
  for (let minutes = 0; minutes < 8 * 60; minutes += 20) { now += 20 * 60_000; await app.access.permits(third); }
  assert.equal((await app.access.permits(third)), false, "eight hours is the absolute limit");
});

test("itinerary settings and intervals are validated", async (t) => {
  const app = await open(t);
  for (const invalid of [{ date: "2026-13-01", provisional: true }, { date: "2026-11-27", provisional: "yes" }, { date: "" }, null])
    await assert.rejects(async () => (await guestPlan(app, invalid)), isInputError(400), JSON.stringify(invalid));
  let { plan, guest } = (await guestPlan(app, settings));
  for (const [start, end] of [["10:00", "09:00"], ["10:00", "10:00"], ["10:00", ""], ["", "10:00"], ["24:00", "25:00"], ["9:00", "10:00"]]) {
    await assert.rejects(async () => (await app.coordinator.updateItinerary(plan.id, guest, plan.revision, { action: "add", recordId: "bako", start, end })),
      isInputError(400, /start time and an end time/), `${start}-${end}`);
  }
  plan = (await app.coordinator.updateItinerary(plan.id, guest, plan.revision, { action: "add", recordId: "bako", start: "", end: "" }));
  assert.deepEqual([plan.entries[0].start, plan.entries[0].end], ["", ""]);
  await assert.rejects(async () => (await app.coordinator.updateItinerary(plan.id, guest, plan.revision, { action: "add", recordId: "sample-guidance", start: "", end: "" })),
    isInputError(400, /destination, event, stay/));
  await assert.rejects(async () => (await app.coordinator.updateItinerary(plan.id, guest, plan.revision, { action: "add", recordId: "missing", start: "", end: "" })),
    isInputError(404));
  await assert.rejects(async () => (await app.coordinator.updateItinerary(plan.id, guest, plan.revision, { action: "rename" })), isInputError(400));
  plan = (await app.coordinator.updateItinerary(plan.id, guest, plan.revision, { action: "date", date: "2026-11-28", provisional: false }));
  assert.deepEqual([plan.date, plan.provisional], ["2026-11-28", false]);
});

test("an itinerary holds at most fifty entries", async (t) => {
  const app = await open(t);
  let { plan, guest } = (await guestPlan(app, settings));
  for (let count = 0; count < 50; count += 1)
    plan = (await app.coordinator.updateItinerary(plan.id, guest, plan.revision, { action: "add", recordId: "bako", start: "", end: "" }));
  assert.equal(plan.entries.length, 50);
  await assert.rejects(async () => (await app.coordinator.updateItinerary(plan.id, guest, plan.revision, { action: "add", recordId: "bako", start: "", end: "" })),
    isInputError(400, /50 entries/));
  assert.equal((await app.coordinator.reviewItinerary(plan.id, guest)).entries.length, 50);
});

test("entries move only to valid positions", async (t) => {
  const app = await open(t);
  let { plan, guest } = (await guestPlan(app, settings));
  for (const recordId of ["bako", "museum", "sample-event"])
    plan = (await app.coordinator.updateItinerary(plan.id, guest, plan.revision, { action: "add", recordId, start: "", end: "" }));
  const [first] = plan.entries;
  for (const position of [-1, 3, 1.5, "0", null])
    await assert.rejects(async () => (await app.coordinator.updateItinerary(plan.id, guest, plan.revision, { action: "move", entryId: first.id, position })),
      isInputError(400, /valid position/), String(position));
  await assert.rejects(async () => (await app.coordinator.updateItinerary(plan.id, guest, plan.revision, { action: "move", entryId: "missing", position: 0 })),
    isInputError(404));
  await assert.rejects(async () => (await app.coordinator.updateItinerary(plan.id, guest, plan.revision, { action: "update", entryId: "missing", start: "", end: "" })),
    isInputError(404));
  plan = (await app.coordinator.updateItinerary(plan.id, guest, plan.revision, { action: "move", entryId: first.id, position: 2 }));
  assert.deepEqual(plan.entries.map(({ recordId }) => recordId), ["museum", "sample-event", "bako"]);
  plan = (await app.coordinator.updateItinerary(plan.id, guest, plan.revision, { action: "remove", entryId: first.id }));
  assert.deepEqual(plan.entries.map(({ recordId }) => recordId), ["museum", "sample-event"]);
});

test("event location searches include the hosting destination", async (t) => {
  const app = await open(t);
  const kuching = (await app.catalog.findEvents({ location: "kuching" })).map(({ id }) => id);
  assert.ok(kuching.includes("sample-event"));
  assert.ok(!(await app.catalog.getPublishedEvent("sample-event"))?.fields.venue.toLowerCase().includes("kuching"));
  assert.deepEqual((await app.catalog.findEvents({ location: "studio" })).map(({ id }) => id), ["sample-workshop"]);
  assert.deepEqual((await app.catalog.findEvents({ location: "Miri" })), []);
  assert.deepEqual((await app.catalog.findEvents({ location: "Kuching", date })).map(({ id }) => id), ["sample-event"]);
  await assert.rejects(async () => (await app.catalog.findEvents({ query: 42 })), isInputError(400));
});

test("a postponed event is found on its new date only", async (t) => {
  const app = await open(t);
  const staff = (await signIn(app));
  const draft = (await app.manager.getDraft(staff, "sample-event"));
  const postponed = (await app.manager.saveDraft(staff, draft.id, "event", { ...draft.fields, status: "postponed", startsAt: "2026-12-05T10:00" }, draft.version));
  (await app.manager.publish(staff, postponed.id, postponed.version));
  assert.deepEqual((await app.catalog.findEvents({ date: "2026-12-05" })).map(({ id }) => id), ["sample-event"]);
  assert.ok(!(await app.catalog.findEvents({ date })).some(({ id }) => id === "sample-event"));
  const undated = (await app.manager.saveDraft(staff, draft.id, "event", { ...draft.fields, status: "postponed", startsAt: "" }, postponed.version));
  (await app.manager.publish(staff, undated.id, undated.version));
  assert.ok(!(await app.catalog.findEvents({ date: "2026-12-05" })).some(({ id }) => id === "sample-event"));
  assert.equal((await app.catalog.findEvents({ query: "showcase" }))[0].fields.status, "postponed");
});

test("restarting a profile keeps staff changes and the original staff password", async (t) => {
  const fixture = await durable(t, "stis-restart");
  let app = fixture.app;
  const staff = (await signIn(app));
  const count = (await app.manager.listDrafts(staff)).length;
  const draft = (await app.manager.getDraft(staff, "sample-dining"));
  const revised = (await app.manager.saveDraft(staff, draft.id, "dining", { ...draft.fields, cuisine: "Synthetic fusion" }, draft.version));
  (await app.manager.publish(staff, revised.id, revised.version));
  (await app.manager.withdraw(staff, "sample-guidance"));
  app = await fixture.restart("different-synthetic-credential");
  await assert.rejects(async () => signIn(app, "different-synthetic-credential"), isInputError(401), "bootstrap never overwrites an existing account");
  const again = (await signIn(app));
  assert.equal((await app.manager.listDrafts(again)).length, count);
  assert.equal((await app.catalog.getPublishedRecord("sample-dining"))?.fields.cuisine, "Synthetic fusion");
  assert.equal((await app.catalog.getPublishedRecord("sample-guidance")), undefined);
  assert.equal((await app.manager.getDraft(again, "sample-guidance")).publishedVersion, null);
});

test("a database without a bootstrapped administrator refuses staff sign-in", async (t) => {
  const app = await open(t, { admin: false });
  await assert.rejects(async () => signIn(app), isInputError(401, /incorrect/));
  await assert.rejects(async () => open(t, { adminPassword: "too-short" }), /12 to 200 characters/);
});

test("withdrawing a record that was never published is rejected (audit defect D5)", async (t) => {
  const app = await open(t);
  const staff = (await signIn(app));
  const draft = (await app.manager.saveDraft(staff, null, "dining", { title: "Unpublished synthetic cafe" }, null));
  await assert.rejects(async () => (await app.manager.withdraw(staff, draft.id)), isInputError(409, /not published/));
  assert.deepEqual((await app.manager.getDraft(staff, draft.id)), draft);
});

test("Sarawak-wide guidance does not block withdrawing a destination (audit defect D6)", async (t) => {
  const app = await open(t);
  const staff = (await signIn(app));
  const guidance = (await app.manager.saveDraft(staff, null, "visitor", {
    title: "General synthetic tip", area: "sarawak", guidanceCategory: "General", summary: "Synthetic.", destinationIds: "museum",
  }, null));
  (await app.manager.publish(staff, guidance.id, guidance.version));
  (await app.manager.withdraw(staff, "museum"));
  assert.equal((await app.catalog.getPublishedRecord("museum")), undefined);
});

test("changing a saved draft's category reports a category error (audit defect D7)", async (t) => {
  const app = await open(t);
  const staff = (await signIn(app));
  const draft = (await app.manager.saveDraft(staff, null, "dining", { title: "Synthetic cafe" }, null));
  await assert.rejects(async () => (await app.manager.saveDraft(staff, draft.id, "event", { title: "Synthetic cafe" }, draft.version)),
    isInputError(422, /category/));
});

async function eventPlan(app: Application, travelDate: string) {
  let { plan, guest } = (await guestPlan(app, { date: travelDate, provisional: false }));
  plan = (await app.coordinator.updateItinerary(plan.id, guest, plan.revision, { action: "add", recordId: "bako", start: "08:00", end: "09:00" }));
  plan = (await app.coordinator.updateItinerary(plan.id, guest, plan.revision, { action: "add", recordId: "sample-event", start: "10:00", end: "11:00" }));
  return { plan, guest };
}

async function republish(app: Application, fields: Record<string, string>) {
  const staff = (await signIn(app));
  const draft = (await app.manager.getDraft(staff, "sample-event"));
  const revised = (await app.manager.saveDraft(staff, draft.id, "event", { ...draft.fields, ...fields }, draft.version));
  (await app.manager.publish(staff, revised.id, revised.version));
  return staff;
}

const eventEntry = (plan: { entries: { kind: string }[] }) => plan.entries.find(({ kind }) => kind === "event") as Record<string, unknown>;
const planned = (plan: { entries: { id: string; start: string; end: string }[] }) => plan.entries.map(({ id, start, end }) => ({ id, start, end }));

test("a scheduled event on the travel date shows its published start without a date warning", async (t) => {
  const app = await open(t);
  const { plan } = await eventPlan(app, "2026-11-27");
  const event = eventEntry(plan);
  assert.equal(event.eventStartsAt, "2026-11-27T10:00");
  assert.equal(event.dateNotice, undefined);
  assert.equal(event.notice, undefined);
  const destination = plan.entries.find(({ kind }) => kind === "destination")!;
  assert.equal("eventStartsAt" in destination && destination.eventStartsAt !== undefined, false);
  assert.equal(destination.dateNotice, undefined);
});

test("a scheduled event on another date is flagged without changing the planned interval", async (t) => {
  const app = await open(t);
  const { plan } = await eventPlan(app, "2026-11-30");
  const event = eventEntry(plan);
  assert.equal(event.eventStartsAt, "2026-11-27T10:00");
  assert.equal(event.dateNotice, "different-date");
  assert.equal(event.notice, undefined);
  assert.deepEqual([event.start, event.end], ["10:00", "11:00"]);
});

test("a postponed event keeps its notice and shows the revised date", async (t) => {
  const app = await open(t);
  const { plan, guest } = await eventPlan(app, "2026-11-27");
  const before = planned(plan);
  await republish(app, { status: "postponed", startsAt: "2026-12-05T10:00" });
  const reviewed = (await app.coordinator.reviewItinerary(plan.id, guest));
  const event = eventEntry(reviewed);
  assert.equal(event.notice, "postponed");
  assert.equal(event.eventStartsAt, "2026-12-05T10:00");
  assert.equal(event.dateNotice, "different-date");
  assert.deepEqual(planned(reviewed), before);
  assert.equal(reviewed.revision, plan.revision);
});

test("a postponed event without a published start keeps its notice and invents no date", async (t) => {
  const app = await open(t);
  const { plan, guest } = await eventPlan(app, "2026-11-30");
  await republish(app, { status: "postponed", startsAt: "" });
  const event = eventEntry((await app.coordinator.reviewItinerary(plan.id, guest)));
  assert.equal(event.notice, "postponed");
  assert.equal(event.eventStartsAt, undefined);
  assert.equal(event.dateNotice, undefined);
});

test("a cancelled event keeps its cancellation notice and gets no date warning", async (t) => {
  const app = await open(t);
  const { plan, guest } = await eventPlan(app, "2026-11-30");
  await republish(app, { status: "cancelled" });
  const event = eventEntry((await app.coordinator.reviewItinerary(plan.id, guest)));
  assert.equal(event.notice, "cancelled");
  assert.equal(event.eventStartsAt, "2026-11-27T10:00");
  assert.equal(event.dateNotice, undefined);
});

test("a withdrawn event is unavailable and shows no published date", async (t) => {
  const app = await open(t);
  const { plan, guest } = await eventPlan(app, "2026-11-30");
  const staff = await republish(app, { startsAt: "2026-12-05T10:00" });
  assert.equal(eventEntry((await app.coordinator.reviewItinerary(plan.id, guest))).dateNotice, "different-date");
  (await app.manager.withdraw(staff, "sample-event"));
  const reviewed = (await app.coordinator.reviewItinerary(plan.id, guest));
  const event = eventEntry(reviewed);
  assert.equal(event.notice, "unavailable");
  assert.equal(event.title, "Unavailable event");
  assert.equal(event.eventStartsAt, undefined);
  assert.equal(event.dateNotice, undefined);
  assert.deepEqual(planned(reviewed), planned(plan));
});

test("changing the travel date recalculates the date warning", async (t) => {
  const app = await open(t);
  let { plan, guest } = await eventPlan(app, "2026-11-30");
  assert.equal(eventEntry(plan).dateNotice, "different-date");
  plan = (await app.coordinator.updateItinerary(plan.id, guest, plan.revision, { action: "date", date: "2026-11-27", provisional: true }));
  assert.equal(eventEntry(plan).dateNotice, undefined);
  plan = (await app.coordinator.updateItinerary(plan.id, guest, plan.revision, { action: "date", date: "2026-12-01", provisional: false }));
  assert.equal(eventEntry(plan).dateNotice, "different-date");
  assert.deepEqual([eventEntry(plan).start, eventEntry(plan).end], ["10:00", "11:00"]);
});

test("reopening an itinerary uses the current published date, including after restart", async (t) => {
  const fixture = await durable(t, "stis-event-date");
  let app = fixture.app;
  const { plan, guest } = await eventPlan(app, "2026-11-27");
  assert.equal(eventEntry(plan).dateNotice, undefined);
  const staff = (await signIn(app));
  const draft = (await app.manager.getDraft(staff, "sample-event"));
  const unpublished = (await app.manager.saveDraft(staff, draft.id, "event", { ...draft.fields, startsAt: "2026-12-05T10:00" }, draft.version));
  assert.equal(eventEntry((await app.coordinator.reviewItinerary(plan.id, guest))).eventStartsAt, "2026-11-27T10:00", "drafts stay private");
  (await app.manager.publish(staff, unpublished.id, unpublished.version));
  assert.equal(eventEntry((await app.coordinator.reviewItinerary(plan.id, guest))).eventStartsAt, "2026-12-05T10:00");
  app = await fixture.restart();
  const reopened = (await app.coordinator.reviewItinerary(plan.id, guest));
  assert.equal(eventEntry(reopened).eventStartsAt, "2026-12-05T10:00");
  assert.equal(eventEntry(reopened).dateNotice, "different-date");
  assert.deepEqual(planned(reopened), planned(plan));
  assert.equal(reopened.revision, plan.revision);
});

test("itinerary storage keeps no copy of published event dates", async (t) => {
  const app = await open(t);
  const { plan, guest } = await eventPlan(app, "2026-11-30");
  await republish(app, { status: "postponed", startsAt: "2026-12-05T10:00" });
  (await app.coordinator.reviewItinerary(plan.id, guest));
  const columns = async (table: string) => (await app.db.query<{ column_name: string }>(
    "select column_name from information_schema.columns where table_schema = 'stis' and table_name = $1 order by ordinal_position", [table]))
    .map(({ column_name }) => column_name);
  assert.deepEqual(await columns("itinerary_entry"), ["id", "itinerary_id", "record_id", "kind", "day", "start_time", "end_time", "note", "position"]);
  assert.deepEqual(await columns("itinerary"),
    ["id", "owner_id", "guest_digest", "title", "start_date", "end_date", "provisional", "revision", "created_at", "updated_at", "share_digest"]);
  const rows = await app.db.query("select * from stis.itinerary_entry where itinerary_id = $1", [plan.id]);
  assert.equal(rows.length, 2);
  assert.ok(!JSON.stringify(rows).includes("2026-12-05"), "no copy of the published event date");
  assert.ok(!JSON.stringify(rows).includes("2026-11-27"), "no copy of the original event date");
});

test("an event entry ignores a malformed published start", async () => {
  const entry = new ItineraryEntry({ id: "e", recordId: "x", kind: "event", day: "2026-11-27", start: "", end: "", note: "" });
  const record = (startsAt: string, status = "scheduled"): TourismItem =>
    ({ id: "x", kind: "event", version: 1, fields: { title: "Synthetic", status, startsAt } });
  for (const startsAt of ["", "2026-02-30T10:00", "2026-02-30", "2026-12-05T24:00", "2026-12-05T10:00Z"]) {
    assert.equal(entry.publishedStart(record(startsAt)), undefined, startsAt);
    assert.equal(entry.assessEventDate(record(startsAt), "2026-11-27"), undefined, startsAt);
  }
  assert.equal(entry.publishedStart(record("2026-12-05T23:30")), "2026-12-05T23:30");
  assert.equal(entry.publishedStart(record("2026-12-05")), "2026-12-05", "an all-day event start is a date without a time");
  assert.equal(entry.assessEventDate(record("2026-11-28"), "2026-11-27"), "different-date");
  assert.equal(entry.assessEventDate(record("2026-11-27T23:30"), "2026-11-27"), undefined);
  assert.equal(entry.assessEventDate(record("2026-11-28T00:00"), "2026-11-27"), "different-date");
  assert.equal(entry.publishedStart(undefined), undefined);
  const destination = new ItineraryEntry({ id: "d", recordId: "y", kind: "destination", day: "2026-11-27", start: "", end: "", note: "" });
  assert.equal(destination.publishedStart(record("2026-12-05T10:00")), undefined);
});

async function fileApp(t: After) {
  const app = await open(t);
  return { app, filename: app.db };
}

async function snapshot(db: Db) {
  const tables = await Promise.all(["tourism_record", "record_version", "record_state", "version_destination"]
    .map((table) => db.query(`select * from stis.${table} order by 1, 2`)));
  return JSON.stringify(tables);
}

async function links(db: Db, recordId: string) {
  return (await db.query<{ version: number; destination_id: string }>(
    "select version, destination_id from stis.version_destination where record_id = $1 order by 1, 2", [recordId]))
    .map(({ version, destination_id }) => `${version}:${destination_id}`);
}

test("a published record is withdrawn once and keeps its identity and draft history", async (t) => {
  const app = await open(t);
  const staff = (await signIn(app));
  const before = (await app.manager.getDraft(staff, "sample-dining"));
  assert.equal(before.publishedVersion, before.version);
  const withdrawn = (await app.manager.withdraw(staff, "sample-dining"));
  assert.deepEqual(withdrawn, { ...before, publishedVersion: null });
  assert.equal((await app.catalog.getPublishedRecord("sample-dining")), undefined);
  assert.ok(!(await app.catalog.listPublished("dining")).some(({ id }) => id === "sample-dining"));
  await assert.rejects(async () => (await app.manager.withdraw(staff, "sample-dining")), isInputError(409, /not published/));
  assert.deepEqual((await app.manager.getDraft(staff, "sample-dining")), withdrawn);
  (await app.manager.publish(staff, withdrawn.id, withdrawn.version));
  assert.equal((await app.catalog.getPublishedRecord("sample-dining"))?.fields.title, before.fields.title);
});

test("withdrawing an unknown record returns 404", async (t) => {
  const app = await open(t);
  const staff = (await signIn(app));
  await assert.rejects(async () => (await app.manager.withdraw(staff, "missing-record")), isInputError(404, /unavailable/));
});

test("destination-specific guidance keeps its links and blocks destination withdrawal", async (t) => {
  const { app, filename } = await fileApp(t);
  const staff = (await signIn(app));
  const missing = (await app.manager.saveDraft(staff, null, "visitor", {
    title: "Synthetic museum tip", area: "destination", guidanceCategory: "Access", summary: "Synthetic.",
  }, null));
  await assert.rejects(async () => (await app.manager.publish(staff, missing.id, missing.version)),
    (error) => isInputError(422)(error) && Boolean((error as InputError).issues?.destinationIds));
  const guidance = (await app.manager.saveDraft(staff, missing.id, "visitor", { ...missing.fields, destinationIds: "museum,bako" }, missing.version));
  assert.equal(guidance.fields.destinationIds, "museum,bako");
  assert.deepEqual(await links(filename, guidance.id), ["2:bako", "2:museum"]);
  (await app.manager.publish(staff, guidance.id, guidance.version));
  await assert.rejects(async () => (await app.manager.withdraw(staff, "museum")), isInputError(409, /refer to this destination/));
  assert.ok((await app.catalog.getPublishedRecord("museum")));
  (await app.manager.withdraw(staff, guidance.id));
  (await app.manager.withdraw(staff, "museum"));
  assert.equal((await app.catalog.getPublishedRecord("museum")), undefined);
});

test("Sarawak-wide guidance is saved without destination references", async (t) => {
  const { app, filename } = await fileApp(t);
  const staff = (await signIn(app));
  const created = (await app.manager.saveDraft(staff, null, "visitor", {
    title: "Synthetic general tip", area: "sarawak", guidanceCategory: "General", summary: "Synthetic.", destinationIds: "museum,bako",
  }, null));
  assert.equal(created.fields.destinationIds, "");
  const revised = (await app.manager.saveDraft(staff, created.id, "visitor", { ...created.fields, destinationIds: "waterfront" }, created.version));
  assert.equal(revised.fields.destinationIds, "");
  assert.deepEqual(await links(filename, created.id), []);
  (await app.manager.publish(staff, revised.id, revised.version));
  assert.equal((await app.catalog.getPublishedRecord(created.id))?.fields.destinationIds, "");
});

test("switching guidance to Sarawak-wide clears links only from the new version", async (t) => {
  const { app, filename } = await fileApp(t);
  const staff = (await signIn(app));
  const specific = (await app.manager.saveDraft(staff, null, "visitor", {
    title: "Synthetic switching tip", area: "destination", guidanceCategory: "Access", summary: "Synthetic.", destinationIds: "museum",
  }, null));
  (await app.manager.publish(staff, specific.id, specific.version));
  const general = (await app.manager.saveDraft(staff, specific.id, "visitor", { ...specific.fields, area: "sarawak" }, specific.version));
  assert.equal(general.fields.destinationIds, "");
  assert.equal(general.publishedVersion, 1);
  assert.deepEqual(await links(filename, specific.id), ["1:museum"]);
  const published = (await app.catalog.getPublishedRecord(specific.id));
  assert.deepEqual([published?.version, published?.fields.area, published?.fields.destinationIds], [1, "destination", "museum"]);
  await assert.rejects(async () => (await app.manager.withdraw(staff, "museum")), isInputError(409));
  (await app.manager.publish(staff, general.id, general.version));
  assert.equal((await app.catalog.getPublishedRecord(specific.id))?.fields.area, "sarawak");
  (await app.manager.withdraw(staff, "museum"));
  assert.equal((await app.catalog.getPublishedRecord("museum")), undefined);
});

test("legacy Sarawak-wide guidance published before this fix keeps its links until a new version is published", async (t) => {
  const { app, filename } = await fileApp(t);
  const staff = (await signIn(app));
  const linked = (await app.manager.saveDraft(staff, null, "visitor", {
    title: "Synthetic legacy tip", area: "destination", guidanceCategory: "General", summary: "Synthetic.", destinationIds: "museum",
  }, null));
  (await app.manager.publish(staff, linked.id, linked.version));
  await filename.query(`update stis.record_version set payload = jsonb_set(payload, '{area}', '"sarawak"') where record_id = $1`, [linked.id]);
  assert.equal((await app.catalog.getPublishedRecord(linked.id))?.fields.area, "sarawak");
  await assert.rejects(async () => (await app.manager.withdraw(staff, "museum")), isInputError(409), "historical links are not rewritten");
  const legacy = (await app.manager.getDraft(staff, linked.id));
  const resaved = (await app.manager.saveDraft(staff, legacy.id, "visitor", legacy.fields, legacy.version));
  (await app.manager.publish(staff, resaved.id, resaved.version));
  assert.deepEqual(await links(filename, linked.id), ["1:museum"]);
  (await app.manager.withdraw(staff, "museum"));
});

test("a category change is a 422 category error, distinct from a stale revision", async (t) => {
  const { app, filename } = await fileApp(t);
  const staff = (await signIn(app));
  const first = (await app.manager.saveDraft(staff, null, "dining", { title: "Synthetic cafe", cuisine: "Fusion" }, null));
  const second = (await app.manager.saveDraft(staff, first.id, "dining", { ...first.fields, cuisine: "Local" }, first.version));
  const before = await snapshot(filename);
  await assert.rejects(async () => (await app.manager.saveDraft(staff, first.id, "event", { title: "Synthetic cafe" }, second.version)),
    isInputError(422, /category of an existing record cannot be changed/));
  await assert.rejects(async () => (await app.manager.saveDraft(staff, first.id, "event", { title: "Synthetic cafe" }, first.version)),
    isInputError(422, /category/), "category is checked before the version");
  await assert.rejects(async () => (await app.manager.saveDraft(staff, first.id, "dining", { title: "Stale" }, first.version)), isInputError(409, /changed/));
  assert.equal(await snapshot(filename), before);
  const third = (await app.manager.saveDraft(staff, first.id, "dining", { ...second.fields, hours: "08:00–17:00" }, second.version));
  assert.deepEqual([third.kind, third.version, third.fields.cuisine, third.fields.hours], ["dining", 3, "Local", "08:00–17:00"]);
});

test("rejected staff operations leave stored records unchanged", async (t) => {
  const { app, filename } = await fileApp(t);
  const staff = (await signIn(app));
  const draft = (await app.manager.saveDraft(staff, null, "dining", { title: "Unpublished synthetic cafe" }, null));
  const published = (await app.manager.getDraft(staff, "sample-event"));
  const before = await snapshot(filename);
  const rejected: [() => Promise<unknown>, number][] = [
    [async () => (await app.manager.withdraw(staff, draft.id)), 409],
    [async () => (await app.manager.withdraw(staff, "missing-record")), 404],
    [async () => (await app.manager.withdraw(staff, "culture")), 409],
    [async () => (await app.manager.saveDraft(staff, draft.id, "event", { title: "x" }, draft.version)), 422],
    [async () => (await app.manager.saveDraft(staff, "sample-event", "event", published.fields, published.version + 5)), 409],
    [async () => (await app.manager.saveDraft(staff, "sample-event", "event", { ...published.fields, destinationIds: "missing-place" }, published.version)), 422],
    [async () => (await app.manager.publish(staff, draft.id, draft.version)), 422],
  ];
  for (const [operation, status] of rejected) await assert.rejects(operation, isInputError(status), String(operation));
  assert.equal(await snapshot(filename), before);
  assert.equal((await app.catalog.getPublishedEvent("sample-event"))?.version, published.version);
});

test("multi-day itineraries place stops on days, detect conflicts per day and move stops with the dates", async (t) => {
  const app = await open(t);
  let { plan, guest } = await guestPlan(app, { date: "2026-11-27", endDate: "2026-11-29", provisional: false, title: "Long weekend" });
  assert.deepEqual([plan.date, plan.endDate, plan.title], ["2026-11-27", "2026-11-29", "Long weekend"]);
  const edit = async (change: Record<string, unknown>) => { plan = await app.coordinator.updateItinerary(plan.id, guest, plan.revision, change); };
  await edit({ action: "add", recordId: "bako", day: "2026-11-27", start: "09:00", end: "11:00" });
  await edit({ action: "add", recordId: "museum", day: "2026-11-28", start: "10:00", end: "12:00", note: "  Children's gallery first " });
  await edit({ action: "add", recordId: "sample-accommodation", day: "2026-11-27", start: "", end: "" });
  assert.deepEqual(plan.conflicts, [], "overlapping times on different days are not conflicts");
  await edit({ action: "add", recordId: "culture", day: "2026-11-28", start: "11:00", end: "13:00" });
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.entries.find(({ recordId }) => recordId === "museum")?.note, "Children's gallery first");
  assert.equal(plan.entries.find(({ recordId }) => recordId === "sample-accommodation")?.title, "Waterfront Heritage Inn", "stays can be planned (extension)");
  const culture = plan.entries.find(({ recordId }) => recordId === "culture")!;
  await edit({ action: "update", entryId: culture.id, day: "2026-11-29", start: "11:00", end: "13:00" });
  assert.deepEqual(plan.conflicts, []);
  await assert.rejects(app.coordinator.updateItinerary(plan.id, guest, plan.revision, { action: "add", recordId: "bako", day: "2026-11-30", start: "", end: "" }),
    isInputError(400, /within the trip dates/));
  await edit({ action: "date", date: "2026-12-04", provisional: true });
  assert.deepEqual([plan.date, plan.endDate], ["2026-12-04", "2026-12-06"], "the trip keeps its length");
  assert.deepEqual(plan.entries.map(({ day }) => day).sort(), ["2026-12-04", "2026-12-04", "2026-12-05", "2026-12-06"]);
  await assert.rejects(app.coordinator.updateItinerary(plan.id, guest, plan.revision, { action: "date", date: "2026-12-04", endDate: "2026-12-05", provisional: true }),
    isInputError(400, /after the new end date/));
  for (const invalid of [{ date: "2026-12-04", endDate: "2026-12-03", provisional: true }, { date: "2026-12-01", endDate: "2026-12-15", provisional: true }])
    await assert.rejects(guestPlan(app, invalid), isInputError(400), JSON.stringify(invalid));
  assert.ok(await guestPlan(app, { date: "2026-12-01", endDate: "2026-12-14", provisional: true }), "fourteen days is the maximum");
});

test("an event is compared with the day it is planned for, not the trip start", async (t) => {
  const app = await open(t);
  let { plan, guest } = await guestPlan(app, { date: "2026-11-26", endDate: "2026-11-28", provisional: false });
  plan = await app.coordinator.updateItinerary(plan.id, guest, plan.revision, { action: "add", recordId: "sample-event", day: "2026-11-27", start: "10:00", end: "11:00" });
  assert.equal(plan.entries[0].dateNotice, undefined);
  plan = await app.coordinator.updateItinerary(plan.id, guest, plan.revision, { action: "update", entryId: plan.entries[0].id, day: "2026-11-28", start: "10:00", end: "11:00" });
  assert.equal(plan.entries[0].dateNotice, "different-date");
});

test("an itinerary exports as an iCalendar file in Kuching time", async (t) => {
  const { toCalendar } = await import("./calendar.ts");
  const app = await open(t);
  let { plan, guest } = await guestPlan(app, { date: "2026-11-27", endDate: "2026-11-28", provisional: true, title: "Trip, with; commas" });
  plan = await app.coordinator.updateItinerary(plan.id, guest, plan.revision, { action: "add", recordId: "bako", day: "2026-11-27", start: "09:00", end: "11:30", note: "Bring water\nand a hat" });
  plan = await app.coordinator.updateItinerary(plan.id, guest, plan.revision, { action: "add", recordId: "museum", day: "2026-11-28", start: "", end: "" });
  const ics = toCalendar(plan, new Date("2026-11-23T10:00:00Z"));
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  assert.ok(ics.split("\r\n").every((line) => line.length <= 75), "lines are folded");
  for (const line of ["X-WR-CALNAME:Trip\\, with\\; commas", "DTSTART;TZID=Asia/Kuching:20261127T090000", "DTEND;TZID=Asia/Kuching:20261127T113000",
    "DTSTART;VALUE=DATE:20261128", "DTEND;VALUE=DATE:20261129", "SUMMARY:Bako National Park", "DTSTAMP:20261123T100000Z"])
    assert.ok(ics.includes(line), line);
  assert.ok(ics.includes("Bring water\\nand a hat") && ics.includes("Travel dates are provisional."));
});
