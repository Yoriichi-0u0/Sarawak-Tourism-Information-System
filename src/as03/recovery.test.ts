import assert from "node:assert/strict";
import { test } from "node:test";

import type { ReviewedPlan } from "./contracts.ts";
import { compareDraft, describePlanChanges, isStale, rebaseDraft } from "./recovery.ts";
import { RequestError } from "./client.ts";

const base = { title: "Heritage craft workshop", venue: "Community studio", status: "scheduled", summary: "Original." };

test("only HTTP 409 responses are treated as stale revisions", () => {
  assert.equal(isStale(new RequestError("changed", 409)), true);
  assert.equal(isStale(new RequestError("invalid", 422)), false);
  assert.equal(isStale(new Error("network")), false);
  assert.equal(isStale(undefined), false);
});

test("draft comparison separates edits made here, edits saved elsewhere and overlaps", () => {
  const local = { ...base, venue: "My venue", summary: "Mine." };
  const latest = { ...base, venue: "Their venue", status: "postponed" };
  assert.deepEqual(compareDraft(base, local, latest), {
    changedHere: ["summary", "venue"],
    changedElsewhere: ["status", "venue"],
    overlapping: ["venue"],
  });
});

test("draft comparison ignores surrounding spaces and treats missing fields as blank", () => {
  const local = { ...base, venue: " Community studio ", provider: "" };
  assert.deepEqual(compareDraft(base, local, { ...base, provider: "" }), { changedHere: [], changedElsewhere: [], overlapping: [] });
});

test("an identical edit made in both places is not an overlap", () => {
  const both = { ...base, venue: "Same new venue" };
  assert.deepEqual(compareDraft(base, both, both).overlapping, []);
});

test("rebasing keeps the newer saved draft and reapplies only this editor's changes", () => {
  const local = { ...base, venue: "My venue", summary: "Mine." };
  const latest = { ...base, venue: "Their venue", status: "postponed", provider: "https://example.org/" };
  assert.deepEqual(rebaseDraft(base, local, latest), {
    title: "Heritage craft workshop", venue: "My venue", status: "postponed", summary: "Mine.", provider: "https://example.org/",
  });
  assert.deepEqual(rebaseDraft(base, base, latest), latest);
});

function plan(revision: number, date: string, entries: [string, string, string, string][], provisional = true): ReviewedPlan {
  return {
    id: "plan", title: "Trip", owned: false, revision, date, provisional, conflicts: [],
    entries: entries.map(([id, title, start, end]) => ({ id, recordId: id, kind: "destination", title, start, end })),
  };
}

test("plan changes describe date, status, additions, removals, times and order", () => {
  const current = plan(3, "2026-11-27", [["a", "Bako", "09:00", "10:00"], ["b", "Museum", "", ""], ["c", "Showcase", "11:00", "12:00"]]);
  const latest = plan(5, "2026-11-28", [["c", "Showcase", "11:00", "12:00"], ["a", "Bako", "10:00", "11:00"], ["d", "Semenggoh", "", ""]], false);
  assert.deepEqual(describePlanChanges(current, latest), [
    "Travel date is now 2026-11-28 (was 2026-11-27).",
    "The travel date is now confirmed.",
    "Added: Semenggoh.",
    "Removed: Museum.",
    "Bako is now 10:00–11:00 (was 09:00–10:00).",
    "The order of stops changed.",
  ]);
});

test("plan changes name undecided times and fall back when only the revision moved", () => {
  const current = plan(1, "2026-11-27", [["a", "Bako", "09:00", "10:00"]], false);
  const latest = plan(2, "2026-11-27", [["a", "Bako", "", ""]]);
  assert.deepEqual(describePlanChanges(current, latest), [
    "The travel date is now provisional.",
    "Bako is now time undecided (was 09:00–10:00).",
  ]);
  assert.deepEqual(describePlanChanges(current, plan(2, "2026-11-27", [["a", "Bako", "09:00", "10:00"]], false)), [
    "Saved details changed.",
  ]);
});
