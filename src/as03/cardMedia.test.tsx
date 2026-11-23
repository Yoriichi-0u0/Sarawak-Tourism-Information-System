import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { CardMedia, cardMedia, cardPhotos } from "./cardMedia.tsx";

test("allow-listed images are shown as local photos", () => {
  assert.deepEqual(cardMedia("destinations", "bako"), { kind: "photo", src: "/images/bako.webp" });
  assert.deepEqual(cardMedia("events", "museum"), { kind: "photo", src: "/images/museum.webp" });
});

test("the allow-list is unchanged and leaves out the illustrative hero image", () => {
  assert.deepEqual([...cardPhotos].sort(), ["bako", "cave", "culture", "kolo", "museum", "waterfront", "wildlife"]);
  assert.equal(cardPhotos.has("hero"), false);
});

test("destinations without a verified photo get the destination placeholder", () => {
  for (const image of [undefined, "", "hero", "../secret", "https://example.org/x.webp", "BAKO", "toString", "__proto__"]) {
    assert.deepEqual(cardMedia("destinations", image), { kind: "destination" }, String(image));
  }
});

test("events without a verified photo keep the event placeholder", () => {
  assert.deepEqual(cardMedia("events", undefined), { kind: "event" });
  assert.deepEqual(cardMedia("events", "hero"), { kind: "event" });
});

test("a destination placeholder never renders the event calendar icon", () => {
  const destination = renderToStaticMarkup(<CardMedia mode="destinations" image="hero" />);
  assert.match(destination, /class="as03-card-banner"/);
  assert.match(destination, /lucide-map-pinned/);
  assert.doesNotMatch(destination, /lucide-calendar-days|<img/);
  assert.match(destination, /aria-hidden="true"/);

  const event = renderToStaticMarkup(<CardMedia mode="events" />);
  assert.match(event, /lucide-calendar-days/);
  assert.doesNotMatch(event, /lucide-map-pinned/);
});

test("photos keep decorative alt text and lazy loading", () => {
  const photo = renderToStaticMarkup(<CardMedia mode="destinations" image="bako" />);
  assert.equal(photo, '<img src="/images/bako.webp" alt="" loading="lazy"/>');
});
