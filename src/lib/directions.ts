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

/** Public transport for buses and shuttles, driving for taxis and ride-hailing, and none for boats and flights. */
export function travelModeFor(mode: string | undefined): TravelMode | undefined {
  switch (mode) {
    case "bus": case "long-distance-bus": case "shuttle": return "transit";
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

/** Directions for one transport leg, in the direction it is being travelled. */
export function legDirections(mode: string | undefined, from: string | undefined, to: string | undefined): string | undefined {
  const travelmode = travelModeFor(mode);
  return travelmode && directionsUrl(from ?? "", to ?? "", travelmode);
}
