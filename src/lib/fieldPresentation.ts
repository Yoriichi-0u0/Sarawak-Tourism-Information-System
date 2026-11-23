import { options } from "../shared/catalogue";
import { editableFields } from "../shared/contracts";
import type { Fields, RecordKind } from "../shared/contracts";

export function optionsFor(field: string): readonly (readonly [string, string])[] | undefined {
  return Object.hasOwn(options, field) ? options[field as keyof typeof options] : undefined;
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
