import assert from "node:assert/strict";
import { test } from "node:test";

import { displayValue, needsDestinations, optionsFor, updateFields } from "./fieldPresentation.ts";

test("known enumerated values have human-readable labels", () => {
  assert.equal(displayValue("area", "sarawak"), "Across Sarawak");
  assert.equal(displayValue("area", "destination"), "Destination-specific");
  assert.equal(displayValue("status", "scheduled"), "Scheduled");
  assert.equal(displayValue("status", "postponed"), "Postponed");
  assert.equal(displayValue("status", "cancelled"), "Cancelled");
  assert.deepEqual(optionsFor("area"), [["sarawak", "Across Sarawak"], ["destination", "Destination-specific"]]);
  assert.deepEqual(optionsFor("status")?.map(([value]) => value), ["scheduled", "postponed", "cancelled"]);
  assert.equal(optionsFor("title"), undefined);
});

test("unknown values and free-text fields are shown unchanged", () => {
  assert.equal(displayValue("area", "statewide"), "statewide");
  assert.equal(displayValue("status", "sold-out"), "sold-out");
  assert.equal(displayValue("guidanceCategory", "sarawak"), "sarawak");
  assert.equal(displayValue("title", "<b>Bako</b>"), "<b>Bako</b>");
  assert.equal(displayValue("area", "toString"), "toString");
  assert.equal(displayValue("area", "__proto__"), "__proto__");
  assert.equal(displayValue("constructor", "x"), "x");
});

test("destination selection follows record type and guidance coverage", () => {
  assert.equal(needsDestinations("visitor", { area: "sarawak" }), false);
  assert.equal(needsDestinations("visitor", { area: "" }), false);
  assert.equal(needsDestinations("visitor", {}), false);
  assert.equal(needsDestinations("visitor", { area: "destination" }), true);
  for (const kind of ["event", "accommodation", "transportation", "dining"] as const)
    assert.equal(needsDestinations(kind, {}), true, kind);
  assert.equal(needsDestinations("destination", {}), false);
});

test("switching guidance to Sarawak-wide clears selected destinations", () => {
  const specific = { title: "Tip", area: "destination", destinationIds: "museum,bako" };
  const general = updateFields("visitor", specific, "area", "sarawak");
  assert.deepEqual(general, { title: "Tip", area: "sarawak", destinationIds: "" });
  assert.deepEqual(specific, { title: "Tip", area: "destination", destinationIds: "museum,bako" }, "input is not mutated");
  assert.equal(updateFields("visitor", specific, "area", "").destinationIds, "");
});

test("switching back to destination-specific starts with no selection", () => {
  const general = updateFields("visitor", { title: "Tip", area: "destination", destinationIds: "museum" }, "area", "sarawak");
  const specific = updateFields("visitor", general, "area", "destination");
  assert.deepEqual(specific, { title: "Tip", area: "destination", destinationIds: "" });
  assert.equal(needsDestinations("visitor", specific), true);
  assert.equal(updateFields("visitor", specific, "destinationIds", "museum").destinationIds, "museum");
});

test("records that need destinations keep their associations when other fields change", () => {
  const event = { title: "Showcase", destinationIds: "waterfront", status: "scheduled" };
  assert.deepEqual(updateFields("event", event, "status", "postponed"), { ...event, status: "postponed" });
  const specific = { area: "destination", destinationIds: "museum", summary: "" };
  assert.deepEqual(updateFields("visitor", specific, "summary", "Updated."), { ...specific, summary: "Updated." });
  const destination = { title: "Bako", location: "Kuching" };
  assert.deepEqual(updateFields("destination", destination, "location", "Santubong"), { title: "Bako", location: "Santubong" });
});
