import { fieldSpec, fieldSpecs } from "../shared/catalogue.ts";

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
export type PlanSettings = { date: string; endDate: string; provisional: boolean };
export type Entry = {
  id: string;
  recordId: string;
  kind: Exclude<RecordKind, "visitor">;
  day: string;
  start: string;
  end: string;
  note: string;
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
export type PlanSummary = { id: string; title: string; date: string; endDate: string; provisional: boolean; entryCount: number; updatedAt: string };

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

export const fieldLabels: Record<string, string> = Object.fromEntries(
  (Object.keys(categories) as RecordKind[]).flatMap((kind) => fieldSpecs(kind).map(({ key, label }) => [key, label])));

export function editableFields(kind: RecordKind): string[] {
  return fieldSpecs(kind).map(({ key }) => key);
}

export function labelFor(kind: RecordKind, key: string): string {
  return fieldSpec(kind, key)?.label ?? fieldLabels[key] ?? key;
}

export function isRecordKind(value: unknown): value is RecordKind {
  return typeof value === "string" && Object.hasOwn(categories, value);
}
