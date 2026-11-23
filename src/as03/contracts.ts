export const categories = {
  destination: "Destination",
  event: "Event",
  accommodation: "Accommodation",
  transportation: "Transportation",
  dining: "Dining option",
  visitor: "Visitor information",
} as const;

export type RecordKind = keyof typeof categories;
export type Fields = Record<string, string>;
export type TourismItem = {
  id: string;
  kind: RecordKind;
  version: number;
  fields: Fields;
};
export type StaffRecord = TourismItem & { publishedVersion: number | null };
export type Notice = "cancelled" | "postponed" | "unavailable";
export type DateNotice = "different-date";
export type PlanSettings = { date: string; provisional: boolean };
export type Entry = {
  id: string;
  recordId: string;
  kind: "destination" | "event";
  start: string;
  end: string;
};
export type Plan = PlanSettings & {
  id: string;
  title: string;
  revision: number;
  entries: Entry[];
};
export type ReviewedPlan = Omit<Plan, "entries"> & {
  owned: boolean;
  entries: (Entry & { title: string; location?: string; notice?: Notice; eventStartsAt?: string; dateNotice?: DateNotice })[];
  conflicts: [string, string][];
};
export type PlanSummary = { id: string; title: string; date: string; provisional: boolean; entryCount: number; updatedAt: string };

export type Role = "tourist" | "staff" | "admin";
export type Account = { id: string; email: string; displayName: string; role: Role; createdAt: string };
export type RecordActivity = { action: "create" | "save" | "publish" | "withdraw"; version: number; actor: string | null; at: string };

export function destinationInterests(catalogue: readonly TourismItem[]): string[] {
  const interests = new Map<string, string>();
  for (const item of catalogue) {
    if (item.kind !== "destination") continue;
    const label = item.fields.interest?.trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (!interests.has(key)) interests.set(key, label);
  }
  return [...interests.values()].sort((first, second) => first.localeCompare(second));
}

const details = {
  destination: ["location", "interest", "summary", "activities", "image", "provider"],
  event: ["destinationIds", "venue", "status", "startsAt", "summary", "provider"],
  accommodation: ["destinationIds", "accommodationType", "summary", "provider"],
  transportation: ["destinationIds", "operator", "route", "schedule", "provider"],
  dining: ["destinationIds", "cuisine", "location", "dietary", "hours"],
  visitor: ["guidanceCategory", "area", "destinationIds", "summary", "provider"],
} as const;

export const fieldLabels: Record<string, string> = {
  title: "Title", location: "Location", interest: "Interest category",
  summary: "Description", activities: "Activities", image: "Photo", provider: "External provider URL",
  destinationIds: "Related destinations", venue: "Venue", status: "Event status",
  startsAt: "Start date and time", accommodationType: "Accommodation type",
  operator: "Operator", route: "Route description", schedule: "Schedule",
  cuisine: "Cuisine", dietary: "Dietary details", hours: "Opening hours",
  guidanceCategory: "Guidance category", area: "Coverage",
};

export function editableFields(kind: RecordKind) {
  return ["title", ...details[kind]];
}

export function isRecordKind(value: unknown): value is RecordKind {
  return typeof value === "string" && Object.hasOwn(categories, value);
}
