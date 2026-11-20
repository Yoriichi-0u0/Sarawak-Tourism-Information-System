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
