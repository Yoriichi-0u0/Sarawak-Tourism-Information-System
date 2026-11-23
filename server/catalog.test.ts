import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import { fieldSpecs } from "../src/shared/catalogue.ts";
import { catalogue } from "./content/catalogue.ts";
import { syncContent } from "./content/sync.ts";
import { InputError, TourismRecord } from "./domain.ts";
import { Application } from "./services.ts";
import { freshDb } from "./testing.ts";

async function open(t: TestContext) {
  const app = await Application.open({ db: await freshDb(t), hashCost: { N: 1024, r: 8, p: 1 }, seed: "content" });
  t.after(() => app.close());
  return app;
}
const ids = (items: { id: string }[]) => items.map(({ id }) => id).sort();
const legIds = (legs: { record: { id: string } }[]) => legs.map(({ record }) => record.id);

test("every curated record is publishable, sourced honestly and unique", () => {
  assert.equal(new Set(catalogue.map(({ id }) => id)).size, catalogue.length);
  const kinds = new Set(catalogue.map(({ kind }) => kind));
  assert.deepEqual([...kinds].sort(), ["accommodation", "destination", "dining", "event", "transportation", "visitor"]);
  for (const { id, kind, fields } of catalogue) {
    const record = TourismRecord.parse(kind, fields);
    assert.deepEqual(record.validateForPublication(), {}, id);
    const known = new Set(fieldSpecs(kind).map(({ key }) => key));
    for (const key of Object.keys(fields)) assert.ok(known.has(key), `${id}.${key} is not a ${kind} field`);
    if (fields.provenance === "verified" || fields.provenance === "reported") assert.match(fields.sourceUrl, /^https:\/\//, id);
    if (fields.provenance === "illustrative") {
      assert.match(`${fields.summary ?? ""} ${fields.route ?? ""}`, /not a real|demonstration/i, `${id} says it is illustrative`);
      assert.equal(fields.provider, undefined, `${id} must not link to a provider`);
    }
    for (const claim of [/RM\s?\d/i, /\bguaranteed availability\b/i]) assert.doesNotMatch(JSON.stringify(fields), claim, `${id} states a price or availability`);
  }
});

test("content sync publishes everything once and is idempotent; updates only on request", async (t) => {
  const app = await open(t);
  assert.equal((await app.records.listDrafts()).filter(({ publishedVersion }) => publishedVersion).length, catalogue.length);
  const again = await syncContent(app.records);
  assert.deepEqual([again.created.length, again.updated.length], [0, 0]);
  const changed = catalogue.map((record) => record.id === "kubah" ? { ...record, fields: { ...record.fields, activities: "Forest trails" } } : record);
  assert.deepEqual((await syncContent(app.records, changed)).updated, [], "existing records are left alone without --update");
  assert.deepEqual((await syncContent(app.records, changed, { update: true })).updated, ["kubah"]);
  assert.equal((await app.catalog.getPublishedRecord("kubah"))?.fields.activities, "Forest trails");
  assert.equal((await app.catalog.getPublishedRecord("kubah"))?.version, 2);
});

test("discovery filters work for every category", async (t) => {
  const app = await open(t);
  assert.deepEqual(ids(await app.catalog.search("destination", { interest: "culture" })), ["culture", "museum", "niah"]);
  assert.deepEqual(ids(await app.catalog.search("accommodation", { accessibility: "step-free-entrance,lift" })), ["demo-miri-hotel", "demo-riverside-hotel"]);
  assert.deepEqual(ids(await app.catalog.search("accommodation", { type: "park-lodge" })), ["bako-park-lodging", "mulu-park-hq"]);
  assert.deepEqual(ids(await app.catalog.search("accommodation", { location: "santubong", price: "premium" })), ["demo-santubong-resort"]);
  assert.deepEqual(ids(await app.catalog.search("dining", { dietary: "vegan-options" })), ["demo-garden-kitchen"]);
  assert.deepEqual(ids(await app.catalog.search("dining", { dietary: "halal-options", location: "kuching" })),
    ["demo-waterfront-food-court", "lepau-restaurant", "mee-kolok-hj-salleh"]);
  assert.deepEqual(ids(await app.catalog.search("transportation", { mode: "flight" })), ["kuching-mulu-flight", "miri-mulu-flight"]);
  assert.deepEqual(ids(await app.catalog.search("event", { date: "2026-06-27" })), ["rwmf-2026"], "multi-day events match any day they run");
  assert.deepEqual(ids(await app.catalog.search("event", { from: "2026-12-01", to: "2026-12-31" })),
    ["demo-cultural-evening", "demo-mangrove-walk", "demo-river-food-evening"]);
  const semenggoh = await app.catalog.search("visitor", { destination: "semenggoh" });
  assert.equal(semenggoh[0].fields.priority, "urgent", "urgent guidance comes first");
  assert.ok(semenggoh.some(({ id }) => id === "semenggoh-sightings") && semenggoh.some(({ id }) => id === "entry-requirements"));
  assert.ok(!semenggoh.some(({ id }) => id === "mulu-weather-flights"), "other destinations' guidance is excluded");
  assert.deepEqual(ids(await app.catalog.search("visitor", { category: "emergency" })), ["emergency-999"]);
  await assert.rejects(app.catalog.search("event", { from: "2026-12-31", to: "2026-12-01" }), (error) => error instanceof InputError && error.status === 400);
});

test("the journey planner finds direct routes, two-leg connections and alternatives", async (t) => {
  const app = await open(t);
  const bako = await app.catalog.journeys({ from: "Kuching city centre", to: "Bako National Park" });
  assert.deepEqual(bako.direct, []);
  assert.deepEqual(bako.connections.map((pair) => legIds(pair)), [["kuching-bako-bus", "bako-boat"]], "bus to the jetty, then the boat");
  const mulu = await app.catalog.journeys({ from: "kuching international airport", to: "mulu" });
  assert.deepEqual(legIds(mulu.direct), ["kuching-mulu-flight"]);
  assert.deepEqual(legIds(mulu.alternatives), ["miri-mulu-flight"], "other ways to reach Mulu are offered");
  const back = await app.catalog.journeys({ from: "Gunung Mulu", to: "Miri Airport" });
  assert.deepEqual(legIds(back.direct), ["miri-mulu-flight"]);
  assert.equal(back.direct[0].reversed, true, "two-way services are found in reverse");
  const viaMiri = await app.catalog.journeys({ from: "Miri", to: "Gunung Mulu" });
  assert.ok(viaMiri.connections.some((pair) => legIds(pair).join() === "miri-airport-grab,miri-mulu-flight"));
  const none = await app.catalog.journeys({ from: "Sibu", to: "Bako" });
  assert.deepEqual([none.direct.length, none.connections.length], [0, 0]);
  assert.deepEqual(legIds(none.alternatives).sort(), ["bako-boat", "kuching-bako-bus"], "no direct transport: other options toward Bako are shown once each (SRS T3 2a)");
  await assert.rejects(app.catalog.journeys({ from: "", to: "Bako" }), (error) => error instanceof InputError && error.status === 400);
  assert.ok((await app.catalog.places()).includes("Kampung Bako jetty"));
});

test("a destination's related records bring the categories together", async (t) => {
  const app = await open(t);
  const bako = await app.catalog.related("destination", "bako");
  assert.deepEqual(ids(bako.transportation ?? []), ["bako-boat", "kuching-bako-bus"]);
  assert.deepEqual(ids(bako.accommodation ?? []), ["bako-park-lodging"]);
  assert.deepEqual(ids(bako.event ?? []), ["demo-mangrove-walk"]);
  assert.deepEqual(ids((await app.catalog.related("dining", "lepau-restaurant")).destination ?? []), ["kuching"]);
  await assert.rejects(app.catalog.related("event", "bako"), (error) => error instanceof InputError && error.status === 404);
});

test("verified and reported records must name and link their source; links must be HTTPS", () => {
  const base = { title: "Synthetic park", location: "Kuching", interest: "Nature", summary: "Synthetic." };
  assert.deepEqual(TourismRecord.parse("destination", base).fields.provenance, "illustrative", "unlabelled records default to illustrative");
  const issues = TourismRecord.parse("destination", { ...base, provenance: "verified" }).validateForPublication();
  assert.deepEqual(Object.keys(issues).sort(), ["sourceName", "sourceUrl"]);
  const insecure = TourismRecord.parse("destination", { ...base, provenance: "reported", sourceName: "X", sourceUrl: "http://example.org" }).validateForPublication();
  assert.deepEqual(Object.keys(insecure), ["sourceUrl"]);
  const tags = TourismRecord.parse("accommodation", { title: "X", accommodationType: "hotel", summary: "S", destinationIds: "bako", amenities: "wifi, sauna, wifi" });
  assert.equal(tags.fields.amenities, "wifi,sauna");
  assert.deepEqual(Object.keys(tags.validateForPublication()), ["amenities"]);
  const transport = TourismRecord.parse("transportation", { title: "X", operator: "O", route: "R", destinationIds: "bako", mode: "hovercraft" }).validateForPublication();
  assert.deepEqual(Object.keys(transport).sort(), ["from", "mode", "to"]);
  const event = TourismRecord.parse("event", { title: "X", venue: "V", status: "scheduled", destinationIds: "bako", startsAt: "2026-12-05", endsAt: "2026-12-04" }).validateForPublication();
  assert.deepEqual(Object.keys(event), ["endsAt"]);
});
