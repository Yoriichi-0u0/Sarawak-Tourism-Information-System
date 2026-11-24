// One schema for every tourism category: fields, option lists, provenance and search filters.
// The server validates against it; the staff editor and the discovery filters are generated from it.

export type FieldType = "text" | "longtext" | "select" | "tags" | "datetime" | "url" | "destinations" | "image";
export type Option = readonly [value: string, label: string];
export type FieldSpec = {
  key: string;
  label: string;
  type: FieldType;
  options?: readonly Option[];
  strict?: boolean;
  hint?: string;
};

export const provenanceOptions = [
  ["verified", "Verified with an official source"],
  ["reported", "Reported by travel sources (check locally)"],
  ["staff", "Guidance written by STIS staff"],
  ["illustrative", "Illustrative demonstration record"],
] as const satisfies readonly Option[];

export const options = {
  status: [["scheduled", "Scheduled"], ["postponed", "Postponed"], ["cancelled", "Cancelled"]],
  area: [["sarawak", "Across Sarawak"], ["destination", "Destination-specific"]],
  provenance: provenanceOptions,
  mode: [["bus", "City bus"], ["long-distance-bus", "Long-distance bus"], ["boat", "Boat"], ["flight", "Flight"],
    ["ride-hailing", "Ride-hailing"], ["taxi", "Taxi"], ["shuttle", "Shuttle"]],
  scheduleStatus: [["timetable", "Published timetable"], ["on-demand", "On demand"], ["check", "Check with the operator"], ["unavailable", "Schedule unavailable"]],
  direction: [["both", "Both directions"], ["one-way", "One way only"]],
  priceGuide: [["budget", "Budget"], ["mid", "Mid-range"], ["premium", "Premium"]],
  priority: [["normal", "General"], ["urgent", "Urgent or safety-critical"]],
  accommodationType: [["hotel", "Hotel"], ["guesthouse", "Guesthouse"], ["homestay", "Homestay"], ["resort", "Resort"],
    ["park-lodge", "National park lodging"], ["hostel", "Hostel"]],
  amenities: [["wifi", "Wi-Fi"], ["air-conditioning", "Air conditioning"], ["breakfast", "Breakfast"], ["parking", "Parking"],
    ["pool", "Pool"], ["family-rooms", "Family rooms"], ["restaurant", "Restaurant"], ["airport-transfer", "Airport transfer"]],
  accessibility: [["step-free-entrance", "Step-free entrance"], ["accessible-bathroom", "Accessible bathroom"],
    ["lift", "Lift"], ["ground-floor-rooms", "Ground-floor rooms"]],
  dietary: [["halal-options", "Halal options (confirm with the vendor)"], ["pork-free", "Pork-free"],
    ["vegetarian-options", "Vegetarian options"], ["vegan-options", "Vegan options"]],
  guidanceCategory: [["emergency", "Emergency"], ["safety", "Safety"], ["health", "Health"], ["entry", "Entry and documents"],
    ["accessibility", "Accessibility"], ["culture", "Culture and etiquette"], ["weather", "Weather"], ["getting-around", "Getting around"]],
} as const satisfies Record<string, readonly Option[]>;

const provenance: FieldSpec[] = [
  { key: "provenance", label: "Information source type", type: "select", options: options.provenance, strict: true },
  { key: "sourceName", label: "Source name", type: "text", hint: "Required for verified and reported information." },
  { key: "sourceUrl", label: "Source URL", type: "url" },
  { key: "reviewedOn", label: "Last checked (YYYY-MM-DD)", type: "text" },
];

const select = (key: keyof typeof options, label: string, strict = true): FieldSpec => ({ key, label, type: "select", options: options[key], strict });
const tags = (key: keyof typeof options, label: string): FieldSpec => ({ key, label, type: "tags", options: options[key], strict: true });

export const schema = {
  destination: [
    { key: "location", label: "Location", type: "text" },
    { key: "interest", label: "Interest category", type: "text" },
    { key: "summary", label: "Description", type: "longtext" },
    { key: "activities", label: "Activities", type: "text" },
    { key: "hours", label: "Opening hours", type: "text" },
    { key: "accessibilityNotes", label: "Accessibility notes", type: "longtext" },
    { key: "image", label: "Photo", type: "image" },
    { key: "provider", label: "Official information URL", type: "url" },
  ],
  event: [
    { key: "destinationIds", label: "Hosting destination", type: "destinations" },
    { key: "venue", label: "Venue", type: "text" },
    select("status", "Event status"),
    { key: "startsAt", label: "Starts (date, or date and time)", type: "datetime" },
    { key: "endsAt", label: "Ends (date, or date and time)", type: "datetime" },
    { key: "summary", label: "Description", type: "longtext" },
    { key: "registration", label: "Tickets or registration", type: "text" },
    { key: "image", label: "Photo", type: "image" },
    { key: "provider", label: "Organiser or ticket URL", type: "url" },
  ],
  accommodation: [
    { key: "destinationIds", label: "Nearest destination", type: "destinations" },
    { key: "accommodationType", label: "Accommodation type", type: "select", options: options.accommodationType },
    { key: "location", label: "Location", type: "text" },
    { key: "summary", label: "Description", type: "longtext" },
    tags("amenities", "Amenities"),
    tags("accessibility", "Accessibility features"),
    select("priceGuide", "Indicative price level"),
    { key: "image", label: "Photo", type: "image" },
    { key: "provider", label: "Booking provider URL", type: "url" },
  ],
  transportation: [
    { key: "destinationIds", label: "Destinations served", type: "destinations" },
    select("mode", "Transport type"),
    { key: "operator", label: "Operator", type: "text" },
    { key: "from", label: "From", type: "text" },
    { key: "to", label: "To", type: "text" },
    select("direction", "Direction"),
    { key: "route", label: "Route description", type: "longtext" },
    { key: "schedule", label: "Schedule", type: "text" },
    select("scheduleStatus", "Schedule status"),
    { key: "duration", label: "Typical journey time", type: "text" },
    { key: "image", label: "Photo", type: "image" },
    { key: "provider", label: "Operator or booking URL", type: "url" },
  ],
  dining: [
    { key: "destinationIds", label: "Nearest destination", type: "destinations" },
    { key: "cuisine", label: "Cuisine", type: "text" },
    { key: "location", label: "Location", type: "text" },
    tags("dietary", "Dietary options"),
    { key: "hours", label: "Opening hours", type: "text" },
    select("priceGuide", "Indicative price level"),
    { key: "summary", label: "Description", type: "longtext" },
    { key: "image", label: "Photo", type: "image" },
    { key: "provider", label: "Website or menu URL", type: "url" },
  ],
  visitor: [
    { key: "guidanceCategory", label: "Guidance category", type: "select", options: options.guidanceCategory },
    select("area", "Coverage"),
    { key: "destinationIds", label: "Related destinations", type: "destinations" },
    select("priority", "Priority"),
    { key: "summary", label: "Summary", type: "longtext" },
    { key: "details", label: "Details", type: "longtext" },
    { key: "authority", label: "Issuing authority", type: "text" },
    { key: "image", label: "Photo", type: "image" },
    { key: "provider", label: "Authority link", type: "url" },
  ],
} as const satisfies Record<string, readonly FieldSpec[]>;

export type CatalogueKind = keyof typeof schema;

export function fieldSpecs(kind: CatalogueKind): readonly FieldSpec[] {
  return [{ key: "title", label: "Title", type: "text" }, ...schema[kind], ...provenance];
}

export function fieldSpec(kind: CatalogueKind, key: string): FieldSpec | undefined {
  return fieldSpecs(kind).find((spec) => spec.key === key);
}

export function optionLabel(list: readonly Option[] | undefined, value: string) {
  return list?.find(([option]) => option === value)?.[1];
}

export function splitTags(value: string | undefined): string[] {
  return [...new Set((value ?? "").split(",").map((tag) => tag.trim()).filter(Boolean))];
}

export function isDateOrDateTime(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(?:[01]\d|2[0-3]):[0-5]\d)?$/.exec(value);
  if (!match) return false;
  const date = new Date(`${value.slice(0, 10)}T00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value.slice(0, 10);
}
