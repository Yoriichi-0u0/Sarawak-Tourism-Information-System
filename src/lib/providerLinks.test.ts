import assert from "node:assert/strict";
import { test } from "node:test";

import type { TourismItem } from "../shared/contracts.ts";
import { providerLink } from "./providerLinks.ts";

const item = (kind: TourismItem["kind"], provider: string, fields: Record<string, string> = {}): TourismItem =>
  ({ id: "x", kind, version: 1, fields: { title: "Sample", provenance: "reported", provider, ...fields } }) as TourismItem;
const stay = (provider: string) => item("accommodation", provider);
const today = "2026-12-01";
const trip = { checkIn: "2026-12-12", checkOut: "2026-12-14", today };

test("Booking.com links get valid trip dates and keep what staff entered", () => {
  const link = providerLink(stay("https://www.booking.com/searchresults.html?ss=Kuching%20Waterfront"), trip);
  assert.ok(link);
  const url = new URL(link.href);
  assert.equal(url.searchParams.get("ss"), "Kuching Waterfront");
  assert.equal(url.searchParams.get("checkin"), "2026-12-12");
  assert.equal(url.searchParams.get("checkout"), "2026-12-14");
  assert.equal(link.datesFilled, true);
  assert.equal(link.label, "Search Booking.com");
  assert.equal(link.host, "booking.com");

  const replaced = providerLink(stay("https://www.booking.com/hotel/my/x.html?checkin=2020-01-01&checkout=2020-01-02"), trip);
  assert.equal(new URL(replaced!.href).searchParams.getAll("checkin").join(), "2026-12-12", "stale dates are replaced, not duplicated");
});

test("Booking.com gets no dates unless both are real days, in order and not in the past", () => {
  const url = "https://www.booking.com/hotel/my/x.html";
  const cases: [string, Partial<typeof trip>][] = [
    ["no trip", {}],
    ["check-in only", { checkIn: "2026-12-12", checkOut: undefined }],
    ["check-out only", { checkIn: undefined }],
    ["past check-in", { checkIn: "2026-11-30" }],
    ["same-day check-out", { checkOut: "2026-12-12" }],
    ["check-out before check-in", { checkOut: "2026-12-10" }],
    ["impossible date", { checkIn: "2026-02-30" }],
    ["date-time instead of a day", { checkIn: "2026-12-12T14:00" }],
  ];
  for (const [name, change] of cases) {
    const link = providerLink(stay(url), name === "no trip" ? undefined : { ...trip, ...change });
    assert.equal(link?.href, url, name);
    assert.equal(link?.datesFilled, false, name);
  }
  assert.equal(providerLink(stay(url), { ...trip, checkIn: today })?.datesFilled, true, "check-in today is allowed");
  assert.equal(providerLink(item("dining", url), trip)?.datesFilled, false, "only stays receive dates");
});

test("Agoda and Grab open unchanged, with labels that don't promise a booking", () => {
  const agoda = providerLink(stay("https://www.agoda.com/kuching"), trip);
  assert.deepEqual([agoda?.label, agoda?.href, agoda?.datesFilled], ["Open Agoda", "https://www.agoda.com/kuching", false]);
  const grab = providerLink(item("transportation", "https://www.grab.com/my/airport/"), trip);
  assert.equal(grab?.label, "Open Grab");
  assert.match(grab?.note ?? "", /doesn't book a ride/);
});

test("only the real provider domains are recognised", () => {
  for (const lookalike of ["https://booking.com.example.test/x", "https://notbooking.com/x", "https://grab.com.evil.test/"])
    assert.equal(providerLink(stay(lookalike), trip)?.label, "Check availability and book", lookalike);
  assert.equal(providerLink(stay("https://secure.booking.com/x"), trip)?.label, "Search Booking.com", "subdomains count");
});

test("other links open unchanged with the label for their category", () => {
  const labels: [TourismItem["kind"], string][] = [
    ["accommodation", "Check availability and book"], ["event", "Tickets and registration"],
    ["transportation", "Operator information"], ["dining", "Website or menu"],
    ["visitor", "Read the official guidance"], ["destination", "Official information"],
  ];
  for (const [kind, label] of labels) {
    const link = providerLink(item(kind, "https://www.mulunationalpark.com/stay?room=a%20b"), trip);
    assert.deepEqual([link?.label, link?.href, link?.host], [label, "https://www.mulunationalpark.com/stay?room=a%20b", "mulunationalpark.com"], kind);
  }
});

test("no link is offered for illustrative records or unsafe URLs", () => {
  assert.equal(providerLink(item("accommodation", "https://www.booking.com/x", { provenance: "illustrative" }), trip), undefined);
  for (const unsafe of ["", "not a url", "http://www.booking.com/x", "https://user:pass@www.booking.com/x", "javascript:alert(1)"])
    assert.equal(providerLink(stay(unsafe), trip), undefined, unsafe || "empty");
});
