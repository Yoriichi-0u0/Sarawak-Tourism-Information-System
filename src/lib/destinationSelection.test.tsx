import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { StaffRecord } from "../shared/contracts.ts";
import { DestinationPicker } from "../app/DestinationPicker.tsx";
import { destinationHint, destinationOptions, matchingOptions, selectedIds, selectionSummary, toggleDestination } from "./destinationSelection.ts";
import { planRestore, retainDraft } from "./sessionRecovery.ts";
import { updateFields } from "./fieldPresentation.ts";

const record = (id: string, kind: StaffRecord["kind"], title: string): StaffRecord =>
  ({ id, kind, version: 1, fields: { title }, publishedVersion: 1 });
const records = [
  record("sample-event", "event", "Kuching cultural showcase"),
  record("bako", "destination", "Bako National Park"),
  record("museum", "destination", "Borneo Cultures Museum"),
  record("mulu", "destination", "Gunung Mulu National Park"),
  record("draft-place", "destination", ""),
];

test("selected ids are read from the stored comma-separated value", () => {
  assert.deepEqual(selectedIds(""), []);
  assert.deepEqual(selectedIds(" museum, bako,,museum "), ["museum", "bako"]);
});

test("checking and unchecking keeps order and never duplicates", () => {
  let value = "";
  value = toggleDestination(value, "museum", true);
  value = toggleDestination(value, "bako", true);
  assert.equal(value, "museum,bako");
  assert.equal(toggleDestination(value, "museum", true), "museum,bako");
  value = toggleDestination(value, "museum", false);
  assert.equal(value, "bako");
  assert.equal(toggleDestination(value, "mulu", false), "bako");
  assert.equal(toggleDestination(value, "bako", false), "");
});

test("options list destinations only and keep unknown selected ids visible", () => {
  assert.deepEqual(destinationOptions(records, "museum"), [
    { id: "bako", title: "Bako National Park" },
    { id: "museum", title: "Borneo Cultures Museum" },
    { id: "mulu", title: "Gunung Mulu National Park" },
    { id: "draft-place", title: "Untitled destination" },
  ]);
  assert.deepEqual(destinationOptions(records, "bako,retired-place").at(-1), { id: "retired-place", title: "Unavailable destination (retired-place)" });
});

test("search filters by name without changing the selection", () => {
  const options = destinationOptions(records, "museum,bako");
  assert.deepEqual(matchingOptions(options, "  NATIONAL ").map(({ id }) => id), ["bako", "mulu"]);
  assert.deepEqual(matchingOptions(options, "").map(({ id }) => id), ["bako", "museum", "mulu", "draft-place"]);
  assert.deepEqual(matchingOptions(options, "zzz"), []);
  assert.deepEqual(selectedIds("museum,bako"), ["museum", "bako"], "the stored value is untouched by searching");
});

test("the selection count is stated in words", () => {
  assert.equal(selectionSummary(0), "No destinations selected");
  assert.equal(selectionSummary(1), "1 destination selected");
  assert.equal(selectionSummary(3), "3 destinations selected");
});

test("hints restate each category's existing destination rule", () => {
  assert.equal(destinationHint("event"), "Choose the one hosting destination before publishing.");
  assert.equal(destinationHint("accommodation"), "Choose one destination before publishing.");
  assert.equal(destinationHint("dining"), "Choose one destination before publishing.");
  assert.equal(destinationHint("transportation"), "Choose at least one destination before publishing.");
  assert.equal(destinationHint("visitor"), "Choose at least one destination before publishing.");
});

test("the picker renders a labelled group with search, count and checked boxes", () => {
  const html = renderToStaticMarkup(<DestinationPicker options={destinationOptions(records, "museum,bako")} value="museum,bako"
    onChange={() => {}} hintId="hint" errorId="error" />);
  assert.match(html, /<fieldset[^>]*aria-describedby="hint error"/);
  assert.match(html, /<legend>Related destinations<\/legend>/);
  assert.match(html, /<label[^>]*>Search destinations<input type="search"/);
  assert.match(html, /role="status"[^>]*>2 destinations selected</);
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 4);
  assert.equal((html.match(/checked=""/g) ?? []).length, 2);
  for (const id of ["museum", "bako"]) assert.match(html, new RegExp(`<input type="checkbox"(?=[^>]*checked="")(?=[^>]*value="${id}")`), id);
  assert.doesNotMatch(html, /<input type="checkbox"(?=[^>]*checked="")(?=[^>]*value="mulu")/);
  assert.doesNotMatch(html, /<select/);
});

test("switching guidance to Sarawak-wide clears checked destinations", () => {
  const fields = { area: "destination", destinationIds: toggleDestination("museum", "bako", true) };
  assert.equal(updateFields("visitor", fields, "area", "sarawak").destinationIds, "");
  assert.equal(updateFields("visitor", fields, "destinationIds", toggleDestination(fields.destinationIds, "museum", false)).destinationIds, "bako");
});

test("checked destinations survive session-expiry retention and restore", () => {
  const base: StaffRecord = { id: "tip", kind: "visitor", version: 1, fields: { title: "Tip", area: "destination", destinationIds: "museum" }, publishedVersion: 1 };
  const editor = { id: "tip", kind: "visitor" as const, version: 1, fields: { ...base.fields, destinationIds: "museum,bako" } };
  const plan = planRestore(retainDraft(editor, true, [base])!, [base]);
  assert.equal(plan.action === "open" && plan.editor.fields.destinationIds, "museum,bako");
});
