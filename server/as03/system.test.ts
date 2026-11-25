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

const denied = (status: number) => (error: unknown) => error instanceof InputError && error.status === status;

test("every restricted staff operation requires a current staff session", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-25T09:00:00Z") });
  const app = new Application(":memory:", password);
  t.after(() => app.close());
  const staff = app.access.login(password);
  const draft = app.manager.getDraft(staff, "sample-event");
  const operations = (session: string | undefined) => [
    () => app.manager.listDrafts(session),
    () => app.manager.getDraft(session, draft.id),
    () => app.manager.saveDraft(session, null, "event", draft.fields, null),
    () => app.manager.saveDraft(session, draft.id, "event", { ...draft.fields, status: "cancelled" }, draft.version),
    () => app.manager.publish(session, draft.id, draft.version),
    () => app.manager.withdraw(session, draft.id),
  ];

  for (const session of [undefined, "forged-session-token"])
    for (const operation of operations(session)) assert.throws(operation, denied(401));
  assert.throws(() => app.access.login("incorrect-synthetic-value"), denied(401));

  const signedOut = app.access.login(password);
  app.access.logout(signedOut);
  for (const operation of operations(signedOut)) assert.throws(operation, denied(401));

  const expiring = app.access.login(password);
  t.mock.timers.tick(30 * 60_000);
  for (const operation of operations(expiring)) assert.throws(operation, denied(401));

  assert.equal(app.catalog.getPublishedEvent(draft.id)?.fields.status, "scheduled");
  assert.equal(app.catalog.getPublishedEvent(draft.id)?.version, draft.version);
});

test("category-specific publication rules reject each invalid draft and keep it unpublished", (t) => {
  const app = new Application(":memory:", password);
  t.after(() => app.close());
  const staff = app.access.login(password);
  const event = { title: "QA event", destinationIds: "waterfront", venue: "Hall", status: "scheduled", startsAt: "2026-12-01T10:00" };
  const cases: [RecordKind, Record<string, string>, string][] = [
    ["event", { ...event, status: "rescheduled" }, "status"],
    ["event", { ...event, startsAt: "" }, "startsAt"],
    ["event", { ...event, startsAt: "2026-02-30T10:00" }, "startsAt"],
    ["event", { ...event, destinationIds: "" }, "destinationIds"],
    ["event", { ...event, destinationIds: "waterfront,culture" }, "destinationIds"],
    ["event", { ...event, provider: "http://example.org/" }, "provider"],
    ["event", { ...event, provider: "https://user:secret@example.org/" }, "provider"],
    ["accommodation", { title: "QA stay", accommodationType: "Inn", summary: "Stay", destinationIds: "waterfront,culture" }, "destinationIds"],
    ["transportation", { title: "QA route", operator: "Operator", route: "Route", destinationIds: "" }, "destinationIds"],
    ["dining", { title: "QA dining", cuisine: "Local", location: "Kuching", destinationIds: "" }, "destinationIds"],
    ["visitor", { title: "QA guidance", guidanceCategory: "Safety", summary: "Guidance", area: "elsewhere" }, "area"],
    ["visitor", { title: "QA guidance", guidanceCategory: "Safety", summary: "Guidance", area: "destination" }, "destinationIds"],
    ["destination", { title: "QA place", location: "Miri", interest: "Nature", summary: "" }, "summary"],
  ];

  for (const [kind, fields, field] of cases) {
    const draft = app.manager.saveDraft(staff, null, kind, fields, null);
    assert.throws(
      () => app.manager.publish(staff, draft.id, draft.version),
      (error) => error instanceof InputError && error.status === 422 && Boolean(error.issues?.[field]),
      `${kind} should reject ${field}`,
    );
    assert.equal(app.catalog.getPublishedRecord(draft.id), undefined);
    assert.equal(app.manager.getDraft(staff, draft.id).publishedVersion, null);
  }

  const postponed = app.manager.saveDraft(staff, null, "event", { ...event, status: "postponed", startsAt: "" }, null);
  app.manager.publish(staff, postponed.id, postponed.version);
  assert.equal(app.catalog.getPublishedEvent(postponed.id)?.fields.status, "postponed");
});

test("stale or reclassified revisions leave the saved draft and published version unchanged", (t) => {
  const app = new Application(":memory:", password);
  t.after(() => app.close());
  const staff = app.access.login(password);
  const original = app.manager.getDraft(staff, "waterfront");
  const revised = app.manager.saveDraft(staff, original.id, "destination", { ...original.fields, title: "Revised title" }, original.version);

  assert.throws(() => app.manager.saveDraft(staff, original.id, "destination", { ...original.fields, title: "Stale title" }, original.version), denied(409));
  assert.throws(() => app.manager.saveDraft(staff, original.id, "event", original.fields, revised.version), denied(409));
  assert.throws(() => app.manager.saveDraft(staff, original.id, "destination", original.fields, undefined), denied(400));
  assert.throws(() => app.manager.saveDraft(staff, "missing-record", "destination", original.fields, 1), denied(404));

  const current = app.manager.getDraft(staff, original.id);
  assert.equal(current.kind, "destination");
  assert.equal(current.version, revised.version);
  assert.equal(current.fields.title, "Revised title");
  assert.equal(current.publishedVersion, original.publishedVersion);
  assert.equal(app.catalog.getPublishedRecord(original.id)?.fields.title, original.fields.title);
});

test("related destinations must be published first and cannot be withdrawn while published records depend on them", (t) => {
  const app = new Application(":memory:", password);
  t.after(() => app.close());
  const staff = app.access.login(password);
  const destination = app.manager.saveDraft(staff, null, "destination",
    { title: "QA place", location: "Miri", interest: "Nature", summary: "A new destination." }, null);
  const event = app.manager.saveDraft(staff, null, "event", {
    title: "QA event", destinationIds: destination.id, venue: "Hall", status: "scheduled", startsAt: "2026-12-01T10:00",
  }, null);

  assert.throws(
    () => app.manager.saveDraft(staff, null, "event", { title: "Bad link", destinationIds: "sample-event" }, null),
    (error) => error instanceof InputError && error.status === 422 && Boolean(error.issues?.destinationIds),
  );
  assert.throws(
    () => app.manager.publish(staff, event.id, event.version),
    (error) => error instanceof InputError && error.status === 422 && Boolean(error.issues?.destinationIds),
  );
  assert.equal(app.catalog.getPublishedRecord(event.id), undefined);

  app.manager.publish(staff, destination.id, destination.version);
  app.manager.publish(staff, event.id, event.version);
  assert.throws(() => app.manager.withdraw(staff, destination.id), denied(409));
  assert.ok(app.catalog.getPublishedRecord(destination.id));
  assert.throws(() => app.manager.withdraw(staff, "waterfront"), denied(409));
  assert.ok(app.catalog.getPublishedRecord("waterfront"));

  const { plan, guest } = app.coordinator.createItinerary({ date: "2026-12-01", provisional: false });
  const planned = app.coordinator.updateItinerary(plan.id, guest, plan.revision,
    { action: "add", recordId: destination.id, start: "", end: "" });
  app.manager.withdraw(staff, event.id);
  app.manager.withdraw(staff, destination.id);
  assert.equal(app.catalog.getPublishedRecord(destination.id), undefined);

  const reviewed = app.coordinator.reviewItinerary(plan.id, guest);
  assert.equal(reviewed.entries[0].id, planned.entries[0].id);
  assert.equal(reviewed.entries[0].recordId, destination.id);
  assert.equal(reviewed.entries[0].notice, "unavailable");
  assert.throws(() => app.coordinator.updateItinerary(plan.id, guest, reviewed.revision,
    { action: "add", recordId: destination.id, start: "", end: "" }), denied(404));

  const withdrawn = app.manager.getDraft(staff, destination.id);
  assert.equal(withdrawn.publishedVersion, null);
  app.manager.publish(staff, withdrawn.id, withdrawn.version);
  assert.equal(app.coordinator.reviewItinerary(plan.id, guest).entries[0].notice, undefined);
  assert.equal(app.coordinator.reviewItinerary(plan.id, guest).entries[0].title, "QA place");
});
