import type { RecordKind, TourismItem } from "../shared/contracts";

export type DestinationOption = { id: string; title: string };

export function selectedIds(value: string): string[] {
  return [...new Set(value.split(",").map((id) => id.trim()).filter(Boolean))];
}

export function toggleDestination(value: string, id: string, checked: boolean): string {
  const ids = selectedIds(value);
  if (checked) return (ids.includes(id) ? ids : [...ids, id]).join(",");
  return ids.filter((existing) => existing !== id).join(",");
}

export function destinationOptions(records: readonly TourismItem[], value: string): DestinationOption[] {
  const options = records.filter(({ kind }) => kind === "destination")
    .map(({ id, fields }) => ({ id, title: fields.title || "Untitled destination" }));
  const known = new Set(options.map(({ id }) => id));
  const missing = selectedIds(value).filter((id) => !known.has(id))
    .map((id) => ({ id, title: `Unavailable destination (${id})` }));
  return [...options, ...missing];
}

export function matchingOptions(options: readonly DestinationOption[], query: string): DestinationOption[] {
  const text = query.trim().toLowerCase();
  return options.filter(({ title }) => title.toLowerCase().includes(text));
}

export function selectionSummary(count: number): string {
  if (!count) return "No destinations selected";
  return `${count} destination${count === 1 ? "" : "s"} selected`;
}

export function destinationHint(kind: RecordKind): string {
  if (kind === "event") return "Choose the one hosting destination before publishing.";
  if (kind === "accommodation" || kind === "dining") return "Choose one destination before publishing.";
  return "Choose at least one destination before publishing.";
}
