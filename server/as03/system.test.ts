import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { destinationInterests } from "../../src/as03/contracts.ts";
import type { RecordKind, TourismItem } from "../../src/as03/contracts.ts";
import { InputError } from "./domain.ts";
import { Application } from "./system.ts";

const password = "synthetic-staff-credential";
const date = "2026-11-27";
const settings = { date, provisional: true };

test("interest suggestions keep the spelling of published destination categories without duplicates", () => {
  const catalogue: TourismItem[] = [
    { id: "nature", kind: "destination", version: 1, fields: { interest: " Nature & wildlife " } },
    { id: "culture", kind: "destination", version: 1, fields: { interest: "Culture & heritage" } },
    { id: "another-culture", kind: "destination", version: 1, fields: { interest: "culture & heritage" } },
    { id: "blank", kind: "destination", version: 1, fields: { interest: " " } },
    { id: "event", kind: "event", version: 1, fields: { interest: "Events" } },
  ];
  assert.deepEqual(destinationInterests(catalogue), ["Culture & heritage", "Nature & wildlife"]);
});

test("catalogue searches published destinations and events", (t) => {
  const app = new Application(":memory:", password);
  t.after(() => app.close());
  const destinations = app.catalog.findDestinations({ query: "bako" });
  assert.equal(destinations.length, 1);
  assert.equal(destinations[0].id, "bako");
  assert.deepEqual(
    app.catalog.findDestinations({ query: "bako", location: "Kuching", interest: "Nature" }).map(({ id }) => id),
    ["bako"],
  );
  assert.deepEqual(app.catalog.findDestinations({ query: "bako", interest: "Culture" }), []);
  assert.ok(app.catalog.findEvents({ date }).some((event) => event.id === "sample-event"));
  assert.deepEqual(app.catalog.findEvents({ date: "2026-11-29" }), []);
  assert.throws(() => app.catalog.findEvents({ date: "2026-02-30" }), /valid date/);
});

test("publication validates drafts and preserves the last published version", (t) => {
  const app = new Application(":memory:", password);
  t.after(() => app.close());
  const draft = app.manager.getDraft(app.access.login(password), "sample-event");
  const staff = app.access.login(password);
  const invalid = app.manager.saveDraft(staff, "sample-event", "event", { ...draft.fields, title: "" }, draft.version);
  assert.throws(() => app.manager.publish(undefined, invalid.id, invalid.version), /staff access/);
  assert.throws(() => app.manager.publish(staff, invalid.id, invalid.version), /required fields/);
  assert.equal(app.catalog.getPublishedEvent("sample-event")?.fields.status, "scheduled");
  const updated = app.manager.saveDraft(staff, invalid.id, "event", { ...draft.fields, status: "postponed" }, invalid.version);
  assert.throws(() => app.manager.publish(staff, invalid.id, invalid.version), /changed/);
  app.manager.publish(staff, updated.id, updated.version);
  assert.equal(app.catalog.getPublishedEvent("sample-event")?.fields.status, "postponed");
});

test("itinerary preserves planned times when events change or are withdrawn", (t) => {
  const app = new Application(":memory:", password);
  t.after(() => app.close());
  let { plan, guest } = app.coordinator.createItinerary(settings);
  assert.throws(() => app.coordinator.reviewItinerary(plan.id, "other"), /itinerary access/);
  const add = (recordId: string, start: string, end: string) => {
    plan = app.coordinator.updateItinerary(plan.id, guest, plan.revision, { action: "add", recordId, start, end });
  };
  add("bako", "09:00", "10:00");
  add("sample-event", "09:30", "11:00");
  assert.deepEqual(plan.entries.map(({ location }) => location), ["Kuching", "Waterfront stage"]);
  assert.throws(() => app.coordinator.reviewItinerary(plan.id, "other"), /itinerary access/);
  assert.equal(plan.conflicts.length, 1);
  const event = plan.entries[1];
  const oldRevision = plan.revision;
  plan = app.coordinator.updateItinerary(plan.id, guest, plan.revision, { action: "update", entryId: event.id, start: "10:00", end: "11:00" });
  assert.deepEqual(plan.conflicts, []);
  assert.throws(
    () => app.coordinator.updateItinerary(plan.id, guest, oldRevision, { action: "remove", entryId: event.id }),
    (error) => error instanceof InputError && error.status === 409,
  );
  plan = app.coordinator.updateItinerary(plan.id, guest, plan.revision, { action: "move", entryId: event.id, position: 0 });
  const planned = plan.entries.map(({ id, start, end }) => ({ id, start, end }));
  const staff = app.access.login(password);
  const draft = app.manager.getDraft(staff, "sample-event");
  const cancelled = app.manager.saveDraft(
    staff, draft.id, "event", { ...draft.fields, status: "cancelled", venue: "Relocated venue" }, draft.version,
  );
  assert.equal(app.coordinator.reviewItinerary(plan.id, guest).entries[0].location, "Waterfront stage");
  app.manager.publish(staff, cancelled.id, cancelled.version);
  plan = app.coordinator.reviewItinerary(plan.id, guest);
  assert.equal(plan.entries[0].notice, "cancelled");
  assert.equal(plan.entries[0].location, "Relocated venue");
  app.manager.withdraw(staff, cancelled.id);
  plan = app.coordinator.reviewItinerary(plan.id, guest);
  assert.equal(plan.entries[0].notice, "unavailable");
  assert.equal(plan.entries[0].location, undefined);
  assert.deepEqual(plan.entries.map(({ id, start, end }) => ({ id, start, end })), planned);
  assert.equal(plan.date, date);
  assert.equal(plan.provisional, true);
  assert.deepEqual(plan.conflicts, []);
  app.coordinator.deleteItinerary(plan.id, guest);
  assert.throws(() => app.coordinator.reviewItinerary(plan.id, guest), /itinerary access/);
});

test("staff can create, revise, publish and withdraw each record category", (t) => {
  const app = new Application(":memory:", password);
  t.after(() => app.close());
  const staff = app.access.login(password);
  const examples = new Map(app.manager.listDrafts(staff).map((record) => [record.kind, record]));
  const order: RecordKind[] = ["destination", "event", "accommodation", "transportation", "dining", "visitor"];
  const requiredField: Record<RecordKind, string> = {
    destination: "location", event: "venue", accommodation: "accommodationType",
    transportation: "operator", dining: "cuisine", visitor: "guidanceCategory",
  };
  for (const kind of order) {
    const example = examples.get(kind);
    assert.ok(example);
    const field = requiredField[kind];
    const draft = app.manager.saveDraft(staff, null, kind, { ...example.fields, [field]: "" }, null);
    assert.throws(
      () => app.manager.publish(staff, draft.id, draft.version),
      (error) => error instanceof InputError && error.status === 422 && Boolean(error.issues?.[field]),
    );
    assert.equal(app.catalog.getPublishedRecord(draft.id), undefined);
    const revised = app.manager.saveDraft(staff, draft.id, kind, { ...example.fields, title: `QA ${kind}` }, draft.version);
    app.manager.publish(staff, revised.id, revised.version);
    assert.ok(app.catalog.listPublished(kind).some(({ id }) => id === draft.id));
    app.manager.withdraw(staff, draft.id);
    assert.equal(app.catalog.getPublishedRecord(draft.id), undefined);
  }
});

test("a database fault rolls back publication and the saved state reopens", (t) => {
  mkdirSync("test-results", { recursive: true });
  const directory = mkdtempSync("test-results/as03-storage-");
  const filename = join(directory, "fixture.sqlite");
  let app = new Application(filename, password);
  t.after(() => { app.close(); rmSync(directory, { recursive: true }); });
  const staff = app.access.login(password);
  const { plan, guest } = app.coordinator.createItinerary(settings);
  const saved = app.coordinator.updateItinerary(plan.id, guest, plan.revision, {
    action: "add", recordId: "sample-event", start: "10:00", end: "11:00",
  });
  const event = app.manager.getDraft(staff, "sample-event");
  const draft = app.manager.saveDraft(staff, event.id, "event", { ...event.fields, status: "postponed" }, event.version);
  const fixture = new DatabaseSync(filename);
  try {
    const entry = fixture.prepare("SELECT * FROM itinerary_entry WHERE id = ?").get(saved.entries[0].id);
    assert.ok(entry);
    assert.equal(Object.hasOwn(entry, "location"), false);
    fixture.exec("CREATE TRIGGER fixture_stop_publication BEFORE UPDATE OF published ON record_state BEGIN SELECT RAISE(ABORT, 'fixture storage failure'); END;");
    assert.throws(() => app.manager.publish(staff, draft.id, draft.version), /fixture storage failure/);
    fixture.exec("DROP TRIGGER fixture_stop_publication;");
  } finally { fixture.close(); }
  assert.equal(app.catalog.getPublishedEvent(event.id)?.fields.status, "scheduled");
  app.manager.publish(staff, draft.id, draft.version);
  app.close();
  app = new Application(filename);
  assert.equal(app.catalog.getPublishedEvent(event.id)?.fields.status, "postponed");
  const reopened = app.coordinator.reviewItinerary(plan.id, guest);
  assert.equal(reopened.date, date);
  assert.equal(reopened.entries[0].location, "Waterfront stage");
  assert.equal(reopened.entries[0].start, "10:00");
  assert.equal(reopened.entries[0].notice, "postponed");
});

function isInputError(status: number, pattern?: RegExp) {
  return (error: unknown) => error instanceof InputError && error.status === status &&
    (!pattern || pattern.test(error.message));
}

test("a destination cannot be withdrawn while published records refer to it", (t) => {
  const app = new Application(":memory:", password);
  t.after(() => app.close());
  const staff = app.access.login(password);
  assert.throws(() => app.manager.withdraw(staff, "culture"), isInputError(409, /refer to this destination/));
  assert.ok(app.catalog.getPublishedRecord("culture"));
  app.manager.withdraw(staff, "sample-workshop");
  assert.throws(() => app.manager.withdraw(staff, "culture"), isInputError(409));
  app.manager.withdraw(staff, "sample-transport");
  app.manager.withdraw(staff, "culture");
  assert.equal(app.catalog.getPublishedRecord("culture"), undefined);
});

test("publication requires each related destination to be published first", (t) => {
  const app = new Application(":memory:", password);
  t.after(() => app.close());
  const staff = app.access.login(password);
  const destination = app.manager.saveDraft(staff, null, "destination", {
    title: "Synthetic Highlands", location: "Synthetic town", interest: "Adventure", summary: "Synthetic summary.",
  }, null);
  const event = app.manager.saveDraft(staff, null, "event", {
    title: "Synthetic hike", destinationIds: destination.id, venue: "Trailhead", status: "scheduled", startsAt: "2026-12-01T08:00",
  }, null);
  assert.throws(() => app.manager.publish(staff, event.id, event.version),
    (error) => isInputError(422)(error) && Boolean((error as InputError).issues?.destinationIds));
  assert.equal(app.catalog.getPublishedRecord(event.id), undefined);
  assert.throws(() => app.manager.saveDraft(staff, null, "event", { title: "Orphan", destinationIds: "missing-place" }, null),
    isInputError(422, /existing destinations/));
  app.manager.publish(staff, destination.id, destination.version);
  app.manager.publish(staff, event.id, event.version);
  assert.equal(app.catalog.getPublishedEvent(event.id)?.fields.venue, "Trailhead");
});

test("a second save from the same draft version is rejected as stale", (t) => {
  const app = new Application(":memory:", password);
  t.after(() => app.close());
  const staff = app.access.login(password);
  const draft = app.manager.getDraft(staff, "sample-workshop");
  const first = app.manager.saveDraft(staff, draft.id, "event", { ...draft.fields, venue: "First venue" }, draft.version);
  assert.equal(first.version, draft.version + 1);
  assert.throws(() => app.manager.saveDraft(staff, draft.id, "event", { ...draft.fields, venue: "Second venue" }, draft.version),
    isInputError(409, /Reload it/));
  assert.throws(() => app.manager.saveDraft(staff, draft.id, "event", draft.fields, undefined), isInputError(400, /Reload the draft/));
  assert.equal(app.manager.getDraft(staff, draft.id).fields.venue, "First venue");
  assert.equal(app.catalog.getPublishedEvent(draft.id)?.fields.venue, "Community studio");
});

test("staff sessions end at sign-out and after thirty minutes", (t) => {
  const app = new Application(":memory:", password);
  t.after(() => app.close());
  assert.throws(() => app.access.login("incorrect-synthetic-guess"), isInputError(401));
  const first = app.access.login(password);
  assert.equal(app.access.permits(first), true);
  app.access.logout(first);
  assert.equal(app.access.permits(first), false);
  assert.throws(() => app.manager.listDrafts(first), isInputError(401));
  const started = Date.now();
  const second = app.access.login(password);
  t.mock.method(Date, "now", () => started + 29 * 60_000);
  assert.equal(app.access.permits(second), true);
  t.mock.method(Date, "now", () => started + 31 * 60_000);
  assert.equal(app.access.permits(second), false);
  assert.throws(() => app.manager.listDrafts(second), isInputError(401));
});

test("itinerary settings and intervals are validated", (t) => {
  const app = new Application(":memory:", password);
  t.after(() => app.close());
  for (const invalid of [{ date: "2026-13-01", provisional: true }, { date: "2026-11-27", provisional: "yes" }, { date: "" }, null])
    assert.throws(() => app.coordinator.createItinerary(invalid), isInputError(400), JSON.stringify(invalid));
  let { plan, guest } = app.coordinator.createItinerary(settings);
  for (const [start, end] of [["10:00", "09:00"], ["10:00", "10:00"], ["10:00", ""], ["", "10:00"], ["24:00", "25:00"], ["9:00", "10:00"]]) {
    assert.throws(() => app.coordinator.updateItinerary(plan.id, guest, plan.revision, { action: "add", recordId: "bako", start, end }),
      isInputError(400, /start time and an end time/), `${start}-${end}`);
  }
  plan = app.coordinator.updateItinerary(plan.id, guest, plan.revision, { action: "add", recordId: "bako", start: "", end: "" });
  assert.deepEqual([plan.entries[0].start, plan.entries[0].end], ["", ""]);
  assert.throws(() => app.coordinator.updateItinerary(plan.id, guest, plan.revision, { action: "add", recordId: "sample-accommodation", start: "", end: "" }),
    isInputError(400, /destination or event/));
  assert.throws(() => app.coordinator.updateItinerary(plan.id, guest, plan.revision, { action: "add", recordId: "missing", start: "", end: "" }),
    isInputError(404));
  assert.throws(() => app.coordinator.updateItinerary(plan.id, guest, plan.revision, { action: "rename" }), isInputError(400));
  plan = app.coordinator.updateItinerary(plan.id, guest, plan.revision, { action: "date", date: "2026-11-28", provisional: false });
  assert.deepEqual([plan.date, plan.provisional], ["2026-11-28", false]);
});

test("an itinerary holds at most fifty entries", (t) => {
  const app = new Application(":memory:", password);
  t.after(() => app.close());
  let { plan, guest } = app.coordinator.createItinerary(settings);
  for (let count = 0; count < 50; count += 1)
    plan = app.coordinator.updateItinerary(plan.id, guest, plan.revision, { action: "add", recordId: "bako", start: "", end: "" });
  assert.equal(plan.entries.length, 50);
  assert.throws(() => app.coordinator.updateItinerary(plan.id, guest, plan.revision, { action: "add", recordId: "bako", start: "", end: "" }),
    isInputError(400, /50 entries/));
  assert.equal(app.coordinator.reviewItinerary(plan.id, guest).entries.length, 50);
});

test("entries move only to valid positions", (t) => {
  const app = new Application(":memory:", password);
  t.after(() => app.close());
  let { plan, guest } = app.coordinator.createItinerary(settings);
  for (const recordId of ["bako", "museum", "sample-event"])
    plan = app.coordinator.updateItinerary(plan.id, guest, plan.revision, { action: "add", recordId, start: "", end: "" });
  const [first] = plan.entries;
  for (const position of [-1, 3, 1.5, "0", null])
    assert.throws(() => app.coordinator.updateItinerary(plan.id, guest, plan.revision, { action: "move", entryId: first.id, position }),
      isInputError(400, /valid position/), String(position));
  assert.throws(() => app.coordinator.updateItinerary(plan.id, guest, plan.revision, { action: "move", entryId: "missing", position: 0 }),
    isInputError(404));
  assert.throws(() => app.coordinator.updateItinerary(plan.id, guest, plan.revision, { action: "update", entryId: "missing", start: "", end: "" }),
    isInputError(404));
  plan = app.coordinator.updateItinerary(plan.id, guest, plan.revision, { action: "move", entryId: first.id, position: 2 });
  assert.deepEqual(plan.entries.map(({ recordId }) => recordId), ["museum", "sample-event", "bako"]);
  plan = app.coordinator.updateItinerary(plan.id, guest, plan.revision, { action: "remove", entryId: first.id });
  assert.deepEqual(plan.entries.map(({ recordId }) => recordId), ["museum", "sample-event"]);
});

test("event location searches include the hosting destination", (t) => {
  const app = new Application(":memory:", password);
  t.after(() => app.close());
  const kuching = app.catalog.findEvents({ location: "kuching" }).map(({ id }) => id);
  assert.ok(kuching.includes("sample-event"));
  assert.ok(!app.catalog.getPublishedEvent("sample-event")?.fields.venue.toLowerCase().includes("kuching"));
  assert.deepEqual(app.catalog.findEvents({ location: "studio" }).map(({ id }) => id), ["sample-workshop"]);
  assert.deepEqual(app.catalog.findEvents({ location: "Miri" }), []);
  assert.deepEqual(app.catalog.findEvents({ location: "Kuching", date }).map(({ id }) => id), ["sample-event"]);
  assert.throws(() => app.catalog.findEvents({ query: 42 }), isInputError(400));
});

test("a postponed event is found on its new date only", (t) => {
  const app = new Application(":memory:", password);
  t.after(() => app.close());
  const staff = app.access.login(password);
  const draft = app.manager.getDraft(staff, "sample-event");
  const postponed = app.manager.saveDraft(staff, draft.id, "event", { ...draft.fields, status: "postponed", startsAt: "2026-12-05T10:00" }, draft.version);
  app.manager.publish(staff, postponed.id, postponed.version);
  assert.deepEqual(app.catalog.findEvents({ date: "2026-12-05" }).map(({ id }) => id), ["sample-event"]);
  assert.ok(!app.catalog.findEvents({ date }).some(({ id }) => id === "sample-event"));
  const undated = app.manager.saveDraft(staff, draft.id, "event", { ...draft.fields, status: "postponed", startsAt: "" }, postponed.version);
  app.manager.publish(staff, undated.id, undated.version);
  assert.ok(!app.catalog.findEvents({ date: "2026-12-05" }).some(({ id }) => id === "sample-event"));
  assert.equal(app.catalog.findEvents({ query: "showcase" })[0].fields.status, "postponed");
});

test("restarting a profile keeps staff changes and the original staff password", (t) => {
  mkdirSync("test-results", { recursive: true });
  const directory = mkdtempSync("test-results/as03-restart-");
  const filename = join(directory, "fixture.sqlite");
  let app = new Application(filename, password);
  t.after(() => { app.close(); rmSync(directory, { recursive: true }); });
  const staff = app.access.login(password);
  const count = app.manager.listDrafts(staff).length;
  const draft = app.manager.getDraft(staff, "sample-dining");
  const revised = app.manager.saveDraft(staff, draft.id, "dining", { ...draft.fields, cuisine: "Synthetic fusion" }, draft.version);
  app.manager.publish(staff, revised.id, revised.version);
  app.manager.withdraw(staff, "sample-guidance");
  app.close();
  app = new Application(filename, "different-synthetic-credential");
  assert.throws(() => app.access.login("different-synthetic-credential"), isInputError(401));
  const again = app.access.login(password);
  assert.equal(app.manager.listDrafts(again).length, count);
  assert.equal(app.catalog.getPublishedRecord("sample-dining")?.fields.cuisine, "Synthetic fusion");
  assert.equal(app.catalog.getPublishedRecord("sample-guidance"), undefined);
  assert.equal(app.manager.getDraft(again, "sample-guidance").publishedVersion, null);
});

test("a profile without a configured staff password refuses staff sign-in", (t) => {
  const app = new Application(":memory:");
  t.after(() => app.close());
  assert.throws(() => app.access.login(""), isInputError(401, /not been configured/));
  assert.throws(() => new Application(":memory:", "too-short"), /12 to 200 characters/);
});

test("withdrawing a record that was never published is rejected (audit defect D5)", { todo: "D5: withdraw currently succeeds silently" }, (t) => {
  const app = new Application(":memory:", password);
  t.after(() => app.close());
  const staff = app.access.login(password);
  const draft = app.manager.saveDraft(staff, null, "dining", { title: "Unpublished synthetic cafe" }, null);
  assert.throws(() => app.manager.withdraw(staff, draft.id), isInputError(409));
});

test("Sarawak-wide guidance does not block withdrawing a destination (audit defect D6)", { todo: "D6: general guidance keeps destination links" }, (t) => {
  const app = new Application(":memory:", password);
  t.after(() => app.close());
  const staff = app.access.login(password);
  const guidance = app.manager.saveDraft(staff, null, "visitor", {
    title: "General synthetic tip", area: "sarawak", guidanceCategory: "General", summary: "Synthetic.", destinationIds: "museum",
  }, null);
  app.manager.publish(staff, guidance.id, guidance.version);
  app.manager.withdraw(staff, "museum");
  assert.equal(app.catalog.getPublishedRecord("museum"), undefined);
});

test("changing a saved draft's category reports a category error (audit defect D7)", { todo: "D7: reported as a stale draft" }, (t) => {
  const app = new Application(":memory:", password);
  t.after(() => app.close());
  const staff = app.access.login(password);
  const draft = app.manager.saveDraft(staff, null, "dining", { title: "Synthetic cafe" }, null);
  assert.throws(() => app.manager.saveDraft(staff, draft.id, "event", { title: "Synthetic cafe" }, draft.version),
    isInputError(422, /category/));
});
