import { editableFields } from "./contracts";
import type { Fields, RecordKind } from "./contracts";

const options: Record<string, readonly (readonly [string, string])[]> = {
  area: [["sarawak", "Across Sarawak"], ["destination", "Destination-specific"]],
  status: [["scheduled", "Scheduled"], ["postponed", "Postponed"], ["cancelled", "Cancelled"]],
};

export function optionsFor(field: string) {
  return Object.hasOwn(options, field) ? options[field] : undefined;
}

export function displayValue(field: string, value: string): string {
  return optionsFor(field)?.find(([option]) => option === value)?.[1] ?? value;
}

export function needsDestinations(kind: RecordKind, fields: Fields): boolean {
  if (!editableFields(kind).includes("destinationIds")) return false;
  return kind !== "visitor" || fields.area === "destination";
}

export function updateFields(kind: RecordKind, fields: Fields, field: string, value: string): Fields {
  const next = { ...fields, [field]: value };
  if (editableFields(kind).includes("destinationIds") && !needsDestinations(kind, next)) next.destinationIds = "";
  return next;
}
