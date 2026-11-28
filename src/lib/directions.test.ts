import assert from "node:assert/strict";
import { test } from "node:test";

import { directionsUrl, inSarawak, legDirections, stopDirections, stopPlace, travelModeFor } from "./directions.ts";

test("the travel mode follows the transport type, and boats and flights get no Maps link", () => {
  for (const mode of ["bus", "shuttle"]) assert.equal(travelModeFor(mode), "transit", mode);
  for (const mode of ["taxi", "ride-hailing"]) assert.equal(travelModeFor(mode), "driving", mode);
  for (const mode of ["boat", "flight", "long-distance-bus", "", undefined, "hovercraft"]) assert.equal(travelModeFor(mode), undefined, String(mode));
  assert.equal(legDirections("flight", "Kuching International Airport", "Gunung Mulu National Park"), undefined);
  assert.equal(legDirections("long-distance-bus", "Kuching Sentral", "Miri Sentral"), undefined, "Google has no coach routes here");
});

test("stop names get the region added once, so Maps looks in Sarawak", () => {
  assert.equal(inSarawak("Kuching Sentral"), "Kuching Sentral, Sarawak, Malaysia");
  assert.equal(inSarawak("  Miri Sentral "), "Miri Sentral, Sarawak, Malaysia");
  assert.equal(inSarawak("Kuching, Sarawak"), "Kuching, Sarawak");
  assert.equal(inSarawak("Kota Kinabalu, Malaysia"), "Kota Kinabalu, Malaysia");
  assert.equal(inSarawak(""), "");
});

test("stop names Maps misreads are searched as the place they mean", () => {
  assert.equal(inSarawak("Kuching city centre"), "Kuching, Sarawak, Malaysia", "not King Centre");
  assert.equal(inSarawak("  KUCHING CITY CENTRE "), "Kuching, Sarawak, Malaysia");
  const bako = new URL(legDirections("bus", "Kuching city centre", "Kampung Bako jetty")!);
  assert.equal(bako.searchParams.get("origin"), "Kuching, Sarawak, Malaysia");
  const airport = new URL(legDirections("ride-hailing", "Kuching International Airport", "Kuching city centre")!);
  assert.equal(airport.searchParams.get("destination"), "Kuching, Sarawak, Malaysia");
  assert.equal(directionsUrl("Kuching city centre", "Kuching", "driving"), undefined, "the same place at both ends");
});

test("directions links use Google's documented format and encode every name", () => {
  const url = legDirections("bus", "Kuching Sentral", "Semenggoh Wildlife Centre");
  assert.ok(url);
  const parsed = new URL(url);
  assert.equal(`${parsed.origin}${parsed.pathname}`, "https://www.google.com/maps/dir/");
  assert.deepEqual(Object.fromEntries(parsed.searchParams), {
    api: "1", origin: "Kuching Sentral, Sarawak, Malaysia", destination: "Semenggoh Wildlife Centre, Sarawak, Malaysia", travelmode: "transit",
  });
  assert.match(url, /origin=Kuching\+Sentral%2C\+Sarawak%2C\+Malaysia/);
  const odd = new URL(directionsUrl("Bako & Co #1", "Kampung Bako jetty?", "driving")!);
  assert.equal(odd.searchParams.get("origin"), "Bako & Co #1, Sarawak, Malaysia");
  assert.equal(odd.searchParams.get("destination"), "Kampung Bako jetty?, Sarawak, Malaysia");
});

test("no link when a place is missing, both ends are the same, or the link would be too long", () => {
  assert.equal(directionsUrl("", "Miri", "transit"), undefined);
  assert.equal(directionsUrl("Miri", "   ", "transit"), undefined);
  assert.equal(directionsUrl("Miri", "miri", "driving"), undefined);
  assert.equal(directionsUrl("a".repeat(1100), "b".repeat(1100), "transit"), undefined);
  assert.equal(legDirections("bus", undefined, "Semenggoh Wildlife Centre"), undefined);
});

test("trip stops are found by their name, or an event by its venue, and only when they are real places", () => {
  assert.equal(stopPlace({ kind: "destination", title: "Fort Margherita", location: "Kuching", provenance: "reported" }), "Fort Margherita");
  assert.equal(stopPlace({ kind: "dining", title: "Kim Joo", provenance: "reported" }), "Kim Joo");
  assert.equal(stopPlace({ kind: "event", title: "Rainforest World Music Festival 2026", location: "Sarawak Cultural Village", provenance: "verified" }),
    "Sarawak Cultural Village", "an event's title is not a place");
  assert.equal(stopPlace({ kind: "event", title: "Talk", location: "  ", provenance: "reported" }), undefined, "an event without a venue");
  assert.equal(stopPlace({ kind: "transportation", title: "Route 1 bus to Kampung Bako", provenance: "verified" }), undefined, "a journey, not a place");
  assert.equal(stopPlace({ kind: "accommodation", title: "Riverside heritage hotel", provenance: "illustrative" }), undefined, "demo records aren't real places");
  assert.equal(stopPlace({ kind: "destination", title: "Bako National Park", provenance: "verified", notice: "unavailable" }), undefined, "withdrawn");
});

test("back-to-back stops get public-transport directions only when both ends are places", () => {
  const fort = { kind: "destination", title: "Fort Margherita", provenance: "reported" };
  const temple = { kind: "destination", title: "Tua Pek Kong Temple", provenance: "reported" };
  const url = new URL(stopDirections(fort, temple)!);
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    api: "1", origin: "Fort Margherita, Sarawak, Malaysia", destination: "Tua Pek Kong Temple, Sarawak, Malaysia", travelmode: "transit",
  });
  assert.equal(stopDirections(fort, { kind: "transportation", title: "Boat", provenance: "verified" }), undefined);
  assert.equal(stopDirections({ kind: "dining", title: "Garden vegetarian kitchen", provenance: "illustrative" }, temple), undefined);
  assert.equal(stopDirections(fort, fort), undefined, "no directions from a place to itself");
});
