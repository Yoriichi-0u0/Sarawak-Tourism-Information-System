// Google Maps directions links (issue #10, step 4). Format documented in Google's Maps URLs guide:
// https://www.google.com/maps/dir/?api=1&origin=…&destination=…&travelmode=…, at most 2,048 characters.

export type TravelMode = "transit" | "driving";

const region = ", Sarawak, Malaysia";
const maxLength = 2048;

/** Adds the region so Maps doesn't pick a same-named place elsewhere, unless the name already says where it is. */
export function inSarawak(name: string): string {
  const trimmed = name.trim();
  return !trimmed || /\b(sarawak|malaysia)\b/i.test(trimmed) ? trimmed : `${trimmed}${region}`;
}

/**
 * Public transport for city buses and shuttles, driving for taxis and ride-hailing. Boats, flights and long-distance
 * coaches get none: Google has no route data for them here (checked 28 Nov 2026: Kuching Sentral to Miri Sentral
 * answers "outside our current coverage area").
 */
export function travelModeFor(mode: string | undefined): TravelMode | undefined {
  switch (mode) {
    case "bus": case "shuttle": return "transit";
    case "taxi": case "ride-hailing": return "driving";
    default: return undefined;
  }
}

/** A directions link between two named places, or undefined when there is nothing sensible to ask Maps. */
export function directionsUrl(from: string, to: string, travelmode: TravelMode): string | undefined {
  const origin = inSarawak(from), destination = inSarawak(to);
  if (!origin || !destination || origin.toLowerCase() === destination.toLowerCase()) return undefined;
  const url = `https://www.google.com/maps/dir/?${new URLSearchParams({ api: "1", origin, destination, travelmode })}`;
  return url.length <= maxLength ? url : undefined;
}

/** What a trip stop needs for Maps to find it. */
export type StopForMaps = { kind: string; title: string; location?: string; provenance?: string; notice?: string };

/**
 * The name Maps should look for: a place's own title, or an event's venue. Transport stops are journeys, not
 * places; demonstration records describe no real place; withdrawn records may no longer be accurate. None of
 * those get directions.
 */
export function stopPlace(stop: StopForMaps): string | undefined {
  if (stop.kind === "transportation" || stop.provenance === "illustrative" || stop.notice === "unavailable") return undefined;
  const name = stop.kind === "event" ? stop.location : stop.title;
  return name?.trim() || undefined;
}

/** Public-transport directions from one trip stop to the next, when both are real places. */
export function stopDirections(from: StopForMaps, to: StopForMaps): string | undefined {
  const origin = stopPlace(from), destination = stopPlace(to);
  return origin && destination ? directionsUrl(origin, destination, "transit") : undefined;
}

/** Directions for one transport leg, in the direction it is being travelled. */
export function legDirections(mode: string | undefined, from: string | undefined, to: string | undefined): string | undefined {
  const travelmode = travelModeFor(mode);
  return travelmode && directionsUrl(from ?? "", to ?? "", travelmode);
}
