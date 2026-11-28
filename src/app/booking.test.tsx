import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { ReviewedPlan } from "../shared/contracts.ts";
import { BookingBadge, bookingLabel, nextDay, StopBooking, stopDates } from "./booking.tsx";

type Stop = ReviewedPlan["entries"][number];
const stop = (kind: Stop["kind"], fields: Partial<Stop> = {}): Stop => ({
  id: "s1", recordId: "r1", kind, day: "2999-01-10", start: "", end: "", note: "", bookedWith: "", bookedUntil: "",
  title: "Riverside Inn", provenance: "reported", ...fields,
});
const plan = { endDate: "2999-01-13" };
const render = (entry: Stop, handoff?: { entryId: string; host: string; back: boolean }) => renderToStaticMarkup(
  <StopBooking stop={entry} plan={plan} busy={false} change={async () => true} handoff={handoff} onHandoff={() => {}} onDismiss={() => {}} />);

test("booking marks read as who the booking is with and, for stays, the dates", () => {
  assert.equal(bookingLabel(stop("accommodation")), undefined);
  assert.equal(bookingLabel(stop("accommodation", { bookedWith: "booking.com", bookedUntil: "2999-01-12" })), "Booked with booking.com · 10 Jan 2999 – 12 Jan 2999");
  assert.equal(bookingLabel(stop("dining", { bookedWith: "phone" })), "Reserved by phone");
  assert.equal(bookingLabel(stop("transportation", { bookedWith: "grab.com" })), "Booked with grab.com");
  assert.match(renderToStaticMarkup(<BookingBadge stop={stop("dining", { bookedWith: "phone" })} />), /Reserved by phone/);
  assert.equal(renderToStaticMarkup(<BookingBadge stop={stop("dining")} />), "");
});

test("providers are offered a stay's own dates, or the stop's day to the trip's end", () => {
  assert.deepEqual(stopDates(stop("accommodation"), plan), { checkIn: "2999-01-10", checkOut: "2999-01-13" });
  assert.deepEqual(stopDates(stop("accommodation", { bookedUntil: "2999-01-11" }), plan), { checkIn: "2999-01-10", checkOut: "2999-01-11" });
  assert.equal(stopDates(stop("accommodation", { day: "2999-01-13" }), plan), undefined, "a stop on the last day gets no invented check-out");
  assert.equal(stopDates(stop("event"), plan), undefined);
  assert.equal(nextDay("2999-02-28"), "2999-03-01");
  assert.equal(nextDay("2028-02-28"), "2028-02-29");
  assert.equal(nextDay("2026-12-31"), "2027-01-01");
});

test("an unbooked stay offers the provider with trip dates and a way to mark it", () => {
  const html = render(stop("accommodation", { provider: "https://www.booking.com/hotel/my/x.html" }));
  assert.match(html, /Search Booking.com/);
  assert.match(html, /checkin=2999-01-10&amp;checkout=2999-01-13/);
  assert.match(html, /Your trip dates are filled in/);
  assert.match(html, /Mark as booked/);
  assert.doesNotMatch(html, /Did you book/, "no prompt before the tourist has left for the provider");
});

test("coming back from the provider asks whether the stop was booked", () => {
  const html = render(stop("accommodation", { provider: "https://www.booking.com/x" }), { entryId: "s1", host: "booking.com", back: true });
  assert.match(html, /Did you book Riverside Inn on booking.com\?/);
  assert.match(html, /Yes, mark it as booked/);
  assert.match(html, /Not yet/);
  assert.doesNotMatch(render(stop("accommodation"), { entryId: "other", host: "booking.com", back: true }), /Did you book/, "only the stop that was opened");
  assert.doesNotMatch(render(stop("accommodation"), { entryId: "s1", host: "booking.com", back: false }), /Did you book/, "not while still away");
  assert.match(render(stop("dining"), { entryId: "s1", host: "example.com", back: true }), /Did you reserve/);
});

test("a booked stop links back to its provider and can be cleared, but destinations offer nothing", () => {
  const html = render(stop("accommodation", { provider: "https://www.booking.com/x", bookedWith: "booking.com", bookedUntil: "2999-01-12" }));
  assert.match(html, /Open booking.com/);
  assert.match(html, /checkin=2999-01-10&amp;checkout=2999-01-12/, "the link reopens with the booked dates");
  assert.match(html, /Clear booking mark/);
  assert.match(html, /STIS doesn(&#x27;|')t check bookings/);
  assert.doesNotMatch(render(stop("dining", { provider: "https://www.example.com/", bookedWith: "phone" })), /Open /, "a phone booking has no site to reopen");
  assert.equal(render(stop("destination", { provider: "https://www.example.com/" })), "");
});
