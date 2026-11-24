import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { TourismItem } from "../shared/contracts.ts";
import { detailPath, sectionAt } from "./kinds.ts";
import { match } from "./router.tsx";
import { daysOf, guestPath, readGuestHash, readShareHash, sharePath } from "./trips.tsx";
import { formatDay, formatWhen, ProvenanceBadge, SourceNote, StatusBadge, subtitle } from "./ui.tsx";

const item = (kind: TourismItem["kind"], fields: Record<string, string>): TourismItem => ({ id: "x", kind, version: 1, fields: { title: "Sample", ...fields } }) as TourismItem;
const token = "a".repeat(43);

test("calendar days are formatted without timezone drift", () => {
  assert.equal(formatDay("2026-12-01"), "Tue 1 Dec 2026");
  assert.equal(formatDay("2026-12-01", false), "1 Dec 2026");
  assert.equal(formatDay("not a date"), "not a date");
});

test("event timing never invents a time for all-day events", () => {
  assert.equal(formatWhen(), "Date to be confirmed");
  assert.equal(formatWhen("2026-12-01"), "Tue 1 Dec 2026");
  assert.equal(formatWhen("2026-12-01", "2026-12-03"), "Tue 1 Dec 2026 – Thu 3 Dec 2026");
  assert.equal(formatWhen("2026-12-01T19:00", "2026-12-01T22:00"), "Tue 1 Dec 2026, 19:00–22:00 MYT");
  assert.equal(formatWhen("2026-12-01T19:00"), "Tue 1 Dec 2026, 19:00 MYT");
});

test("card subtitles use human-readable values per category", () => {
  assert.equal(subtitle(item("visitor", { area: "sarawak" })), "Across Sarawak");
  assert.equal(subtitle(item("visitor", { area: "destination" })), "Destination-specific");
  assert.equal(subtitle(item("transportation", { from: "Kuching", to: "Bako" })), "Kuching → Bako");
  assert.equal(subtitle(item("event", { venue: "Waterfront" })), "Waterfront");
  assert.equal(subtitle(item("destination", { location: "Kuching" })), "Kuching");
});

test("provenance is always disclosed and unknown values fall back to illustrative", () => {
  assert.match(renderToStaticMarkup(<ProvenanceBadge fields={{ provenance: "verified" }} />), /Verified/);
  assert.match(renderToStaticMarkup(<ProvenanceBadge fields={{ provenance: "made-up" }} />), /Illustrative/);
  assert.match(renderToStaticMarkup(<SourceNote fields={{ provenance: "illustrative" }} />), /does not describe a real business/);
  const sourced = renderToStaticMarkup(<SourceNote fields={{ provenance: "reported", sourceName: "Sarawak Tourism", sourceUrl: "https://www.sarawaktourism.com/", reviewedOn: "2026-11-20" }} />);
  assert.match(sourced, /href="https:\/\/www.sarawaktourism.com\/"/);
  assert.match(sourced, /rel="noopener noreferrer"/);
  assert.match(sourced, /checked 20 Nov 2026/);
});

test("event status is conveyed in text, not colour alone", () => {
  const future = "2999-01-01";
  assert.match(renderToStaticMarkup(<StatusBadge item={item("event", { startsAt: future, status: "postponed" })} />), /Postponed/);
  assert.match(renderToStaticMarkup(<StatusBadge item={item("event", { startsAt: future, status: "cancelled" })} />), /Cancelled/);
  assert.match(renderToStaticMarkup(<StatusBadge item={item("event", { startsAt: "2000-01-01", status: "scheduled" })} />), /Past event/);
  assert.equal(renderToStaticMarkup(<StatusBadge item={item("destination", {})} />), "");
});

test("route patterns match, decode and reject extra segments", () => {
  assert.deepEqual(match("/trips/:id", "/trips/abc"), { id: "abc" });
  assert.deepEqual(match("/:section/:id", "/food/laksa%20house"), { section: "food", id: "laksa house" });
  assert.deepEqual(match("/trips", "/trips/"), {});
  assert.equal(match("/trips/:id", "/trips/abc/def"), undefined);
  assert.equal(sectionAt("/stay")?.kind, "accommodation");
  assert.equal(detailPath("event", "rwmf 2027"), "/events/rwmf%202027");
});

test("guest links are read only from a well-formed hash", () => {
  assert.deepEqual(readGuestHash(`#plan-1/${token}`), { id: "plan-1", token });
  assert.deepEqual(readGuestHash(`#itinerary/plan-1/${token}`), { id: "plan-1", token }, "legacy AS03 links still open");
  assert.equal(readGuestHash("#plan-1/short"), undefined);
  assert.equal(readGuestHash(`#plan-1/${token}/extra`), undefined);
  assert.equal(guestPath({ id: "plan-1", token }), `/trips/guest#plan-1/${token}`);
});

test("trip days span the inclusive range and stop at fourteen", () => {
  assert.deepEqual(daysOf({ date: "2026-12-30", endDate: "2027-01-01" }), ["2026-12-30", "2026-12-31", "2027-01-01"]);
  assert.equal(daysOf({ date: "2026-12-01", endDate: "2027-02-01" }).length, 14);
});

test("view-only links are read from the fragment only and are never mistaken for guest edit links", () => {
  assert.equal(readShareHash(`#${token}`), token);
  assert.equal(sharePath(token), `/trips/shared#${token}`);
  assert.equal(readShareHash(`#plan-1/${token}`), undefined);
  assert.equal(readGuestHash(`#${token}`), undefined);
  assert.equal(readShareHash("#short"), undefined);
});
