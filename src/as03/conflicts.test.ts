import assert from "node:assert/strict";
import { test } from "node:test";

import type { ReviewedPlan } from "./contracts.ts";
import { conflictDetails } from "./conflicts.ts";

function plan(entries: [string, string, string, string][], conflicts: [string, string][]): ReviewedPlan {
  return {
    id: "plan", title: "Trip", owned: false, revision: 1, date: "2026-11-27", endDate: "2026-11-27", provisional: true, conflicts,
    entries: entries.map(([id, title, start, end]) => ({ id, recordId: id, kind: "destination", day: "2026-11-27", note: "", title, start, end })),
  };
}

test("each reported conflict names both entries and their planned intervals", () => {
  const details = conflictDetails(plan([
    ["a", "Bako National Park", "09:00", "10:00"],
    ["b", "Kuching cultural showcase", "09:30", "11:00"],
    ["c", "Borneo Cultures Museum", "13:00", "14:00"],
  ], [["a", "b"]]));
  assert.deepEqual(details.pairs, [{
    first: { id: "a", title: "Bako National Park", interval: "09:00–10:00 MYT" },
    second: { id: "b", title: "Kuching cultural showcase", interval: "09:30–11:00 MYT" },
  }]);
  assert.deepEqual(details.partners.get("a"), [{ id: "b", title: "Kuching cultural showcase", interval: "09:30–11:00 MYT" }]);
  assert.deepEqual(details.partners.get("b"), [{ id: "a", title: "Bako National Park", interval: "09:00–10:00 MYT" }]);
  assert.equal(details.partners.has("c"), false);
});

test("an entry that overlaps several entries lists every partner in server order", () => {
  const details = conflictDetails(plan([
    ["a", "Long walk", "09:00", "12:00"],
    ["b", "Showcase", "09:30", "10:00"],
    ["c", "Workshop", "11:00", "11:30"],
  ], [["a", "b"], ["a", "c"]]));
  assert.equal(details.pairs.length, 2);
  assert.deepEqual(details.partners.get("a")?.map(({ title }) => title), ["Showcase", "Workshop"]);
  assert.deepEqual(details.partners.get("c")?.map(({ title }) => title), ["Long walk"]);
});

test("identically named entries are kept apart by entry identity", () => {
  const details = conflictDetails(plan([
    ["a", "Bako National Park", "09:00", "10:00"],
    ["b", "Bako National Park", "09:30", "10:30"],
  ], [["a", "b"]]));
  assert.deepEqual(details.partners.get("a")?.map(({ id }) => id), ["b"]);
  assert.deepEqual(details.partners.get("b")?.map(({ id }) => id), ["a"]);
});

test("the helper reports only the server's conflicts and ignores unknown entries", () => {
  const entries: [string, string, string, string][] = [["a", "Bako", "09:00", "10:00"], ["b", "Museum", "09:30", "10:30"]];
  const none = conflictDetails(plan(entries, []));
  assert.deepEqual(none.pairs, []);
  assert.equal(none.partners.size, 0);
  const unknown = conflictDetails(plan(entries, [["a", "missing"]]));
  assert.deepEqual(unknown.pairs, []);
  assert.equal(unknown.partners.size, 0);
  const absent = conflictDetails(undefined);
  assert.deepEqual([absent.pairs, absent.partners.size], [[], 0]);
});
