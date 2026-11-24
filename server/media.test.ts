import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { fieldSpecs } from "../src/shared/catalogue.ts";
import { mediaAsset, mediaLibrary, mediaRole } from "../src/shared/media.ts";
import { catalogue as curatedRecords } from "./content/catalogue.ts";
import { TourismRecord } from "./domain.ts";

const accepted = /^(CC0|Public domain|CC BY(-SA)? (2\.0|2\.5|3\.0|4\.0))$/;
const publicDir = join(import.meta.dirname, "..", "public");

test("every library image records its subject, author, licence and source, with alt text and encoded files", () => {
  assert.ok(mediaLibrary.length >= 20);
  for (const asset of mediaLibrary) {
    assert.ok(asset.alt.length >= 20 && !/^(image|photo) of/i.test(asset.alt), `${asset.id}: descriptive alt text`);
    assert.ok(asset.subject && asset.author && asset.changes, `${asset.id}: subject, author, changes`);
    if (asset.kind === "photo") {
      assert.match(asset.licence, accepted, `${asset.id}: accepted licence`);
      assert.match(asset.sourceUrl, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/, `${asset.id}: source page`);
      if (!/^(CC0|Public domain)$/.test(asset.licence)) assert.match(asset.licenceUrl, /^https?:\/\/creativecommons\.org\//, `${asset.id}: licence link`);
    } else assert.equal(asset.recordIds.length, 0, `${asset.id}: an illustration never claims to depict a record`);
    for (const width of asset.widths) for (const format of ["avif", "webp"])
      assert.ok(existsSync(join(publicDir, "media", `${asset.id}-${width}.${format}`)), `${asset.id}-${width}.${format}`);
  }
});

test("curated records only use library images, and exact-match claims are consistent", () => {
  const records = new Map(curatedRecords.map((record) => [record.id, record]));
  for (const record of curatedRecords) {
    const image = record.fields.image;
    if (image) assert.ok(mediaAsset(image), `${record.id} uses unknown image ${image}`);
  }
  for (const asset of mediaLibrary) for (const id of asset.recordIds) {
    assert.ok(records.has(id), `${asset.id} claims to show missing record ${id}`);
    assert.equal(records.get(id)!.fields.image, asset.id, `${id} should show the photo that depicts it`);
  }
});

test("every destination shows a real photograph of that destination, never a stand-in or illustration", () => {
  for (const record of curatedRecords.filter(({ kind }) => kind === "destination")) {
    const asset = mediaAsset(record.fields.image);
    assert.ok(asset, `${record.id} has a photo`);
    assert.equal(mediaRole(asset, record.id), "exact", `${record.id}: ${asset.id} must depict it`);
  }
  for (const record of curatedRecords.filter(({ fields }) => fields.provenance === "illustrative")) {
    const asset = mediaAsset(record.fields.image);
    if (asset) assert.notEqual(mediaRole(asset, record.id), "exact", `${record.id} is fictional, so no photo can depict it`);
  }
});

test("every category can carry an image, and an image outside the library blocks publication", () => {
  for (const kind of ["destination", "event", "accommodation", "transportation", "dining", "visitor"] as const)
    assert.ok(fieldSpecs(kind).some(({ key, type }) => key === "image" && type === "image"), kind);
  const fields = { title: "Synthetic place", location: "Kuching", interest: "Nature", summary: "Synthetic.", provenance: "illustrative" };
  assert.equal(TourismRecord.parse("destination", { ...fields, image: "bako-coast" }).validateForPublication().image, undefined);
  assert.match(TourismRecord.parse("destination", { ...fields, image: "hotlinked-or-unknown" }).validateForPublication().image ?? "", /media library/);
});
