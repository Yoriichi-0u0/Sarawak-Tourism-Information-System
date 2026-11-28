import assert from "node:assert/strict";
import { test } from "node:test";

import { directionsUrl, inSarawak, legDirections, travelModeFor } from "./directions.ts";

test("the travel mode follows the transport type, and boats and flights get no Maps link", () => {
  for (const mode of ["bus", "long-distance-bus", "shuttle"]) assert.equal(travelModeFor(mode), "transit", mode);
  for (const mode of ["taxi", "ride-hailing"]) assert.equal(travelModeFor(mode), "driving", mode);
  for (const mode of ["boat", "flight", "", undefined, "hovercraft"]) assert.equal(travelModeFor(mode), undefined, String(mode));
  assert.equal(legDirections("flight", "Kuching International Airport", "Gunung Mulu National Park"), undefined);
});

test("stop names get the region added once, so Maps looks in Sarawak", () => {
  assert.equal(inSarawak("Kuching Sentral"), "Kuching Sentral, Sarawak, Malaysia");
  assert.equal(inSarawak("  Miri Sentral "), "Miri Sentral, Sarawak, Malaysia");
  assert.equal(inSarawak("Kuching, Sarawak"), "Kuching, Sarawak");
  assert.equal(inSarawak("Kota Kinabalu, Malaysia"), "Kota Kinabalu, Malaysia");
  assert.equal(inSarawak(""), "");
});

test("directions links use Google's documented format and encode every name", () => {
  const url = legDirections("long-distance-bus", "Kuching Sentral", "Miri Sentral");
  assert.ok(url);
  const parsed = new URL(url);
  assert.equal(`${parsed.origin}${parsed.pathname}`, "https://www.google.com/maps/dir/");
  assert.deepEqual(Object.fromEntries(parsed.searchParams), {
    api: "1", origin: "Kuching Sentral, Sarawak, Malaysia", destination: "Miri Sentral, Sarawak, Malaysia", travelmode: "transit",
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
