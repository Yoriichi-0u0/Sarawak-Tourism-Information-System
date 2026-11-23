import { randomUUID } from "node:crypto";

import { safeProvider } from "../src/domain.ts";
import { editableFields, labelFor } from "../src/shared/contracts.ts";
import { fieldSpecs, isDateOrDateTime, splitTags, type CatalogueKind } from "../src/shared/catalogue.ts";
import type { DateNotice, Entry, Fields, Notice, Plan, PlanSettings, RecordKind, TourismItem } from "../src/shared/contracts.ts";

export class InputError extends Error {
  constructor(message: string, readonly status = 400, readonly issues?: Fields) {
    super(message);
  }
}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new InputError("Enter a valid request.");
  return value as Record<string, unknown>;
}

export function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** A published event start: a date (all-day) or a date and Kuching time. */
export function validStart(value: unknown): value is string {
  return typeof value === "string" && isDateOrDateTime(value);
}

function httpsWithoutCredentials(value: string) {
  if (!safeProvider(value)) return false;
  const url = new URL(value);
  return !url.username && !url.password;
}

export const maxTripDays = 14;

export function addDays(date: string, days: number): string {
  const next = new Date(`${date}T00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

export function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00Z`) - Date.parse(`${start}T00:00Z`)) / 86_400_000);
}

/** Travel dates: a start date, an optional end date (single day by default, at most 14 days) and whether they are provisional. */
export function planSettings(value: unknown, keepLength?: number): PlanSettings {
  const { date, endDate, provisional } = object(value);
  if (!validDate(date)) throw new InputError("Enter a valid date.");
  const end = endDate === undefined || endDate === "" ? addDays(date, keepLength ?? 0) : endDate;
  if (!validDate(end) || end < date) throw new InputError("Enter an end date on or after the start date.");
  if (daysBetween(date, end) >= maxTripDays) throw new InputError(`Plan up to ${maxTripDays} days in one itinerary.`);
  if (typeof provisional !== "boolean") throw new InputError("Choose a date status.");
  return { date, endDate: end, provisional };
}

function readNote(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value !== "string" || value.length > 500) throw new InputError("Keep notes to 500 characters.");
  return value.trim();
}

function readInterval(start: unknown, end: unknown): [string, string] {
  const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if (start === "" && end === "") return ["", ""];
  if (typeof start !== "string" || typeof end !== "string" ||
      !time.test(start) || !time.test(end) || start >= end)
    throw new InputError("Enter a start time and an end time that follows it, or leave both blank.");
  return [start, end];
}

export abstract class TourismRecord {
  abstract readonly kind: CatalogueKind;

  constructor(readonly fields: Fields) {}

  get destinationIds(): string[] {
    return [...new Set((this.fields.destinationIds ?? "").split(",").filter(Boolean))];
  }

  protected required(...keys: string[]): Fields {
    const issues: Fields = {};
    for (const key of ["title", ...keys])
      if (!this.fields[key]) issues[key] = `Enter ${labelFor(this.kind, key).toLowerCase()}.`;
    for (const spec of fieldSpecs(this.kind)) {
      const value = this.fields[spec.key];
      if (!value || issues[spec.key]) continue;
      if (spec.type === "url" && !httpsWithoutCredentials(value))
        issues[spec.key] = spec.key === "provider" ? "Enter an HTTPS provider URL without credentials." : "Enter an HTTPS link without credentials.";
      if (spec.type === "select" && spec.strict && !spec.options?.some(([option]) => option === value))
        issues[spec.key] = `Choose a valid ${spec.label.toLowerCase()}.`;
      if (spec.type === "tags" && splitTags(value).some((tag) => !spec.options?.some(([option]) => option === tag)))
        issues[spec.key] = `Choose ${spec.label.toLowerCase()} from the list.`;
      if (spec.type === "datetime" && !isDateOrDateTime(value))
        issues[spec.key] = "Enter a valid Kuching date and time.";
    }
    if (this.fields.reviewedOn && !validDate(this.fields.reviewedOn)) issues.reviewedOn = "Enter the date the information was checked.";
    if (this.fields.provenance === "verified" || this.fields.provenance === "reported") {
      if (!this.fields.sourceName) issues.sourceName = "Name the source of this information.";
      if (!this.fields.sourceUrl) issues.sourceUrl = "Link to the source of this information.";
    }
    return issues;
  }

  abstract validateForPublication(): Fields;

  static parse(kind: RecordKind, value: unknown): TourismRecord {
    const raw = object(value);
    const fields: Fields = {};
    for (const key of editableFields(kind)) {
      const candidate = raw[key] ?? "";
      if (typeof candidate !== "string" || candidate.length > 2000)
        throw new InputError(`Enter a valid ${labelFor(kind, key).toLowerCase()}.`);
      fields[key] = candidate.trim();
    }
    for (const spec of fieldSpecs(kind))
      if (spec.type === "tags") fields[spec.key] = splitTags(fields[spec.key]).join(",");
    fields.provenance ||= "illustrative";
    fields.destinationIds = (fields.destinationIds ?? "").split(",")
      .map((value) => value.trim()).filter(Boolean).join(",");
    return new subclasses[kind](fields);
  }
}

class Destination extends TourismRecord {
  readonly kind = "destination";

  validateForPublication() {
    return this.required("location", "interest", "summary");
  }
}

class Event extends TourismRecord {
  readonly kind = "event";

  validateForPublication() {
    const issues = this.required("venue", "status");
    if (this.destinationIds.length !== 1) issues.destinationIds = "Choose one hosting destination.";
    const { status, startsAt, endsAt } = this.fields;
    if (!["scheduled", "postponed", "cancelled"].includes(status))
      issues.status = "Choose a valid event status.";
    if ((status === "scheduled" || startsAt) && !validStart(startsAt))
      issues.startsAt = "Enter a valid Kuching date and time.";
    if (endsAt && !startsAt) issues.endsAt = "Enter the start before the end.";
    else if (endsAt && validStart(startsAt) && validStart(endsAt) && endsAt.slice(0, 10) < startsAt.slice(0, 10))
      issues.endsAt = "Enter an end that is not before the start.";
    return issues;
  }
}

class Accommodation extends TourismRecord {
  readonly kind = "accommodation";

  validateForPublication() {
    const issues = this.required("accommodationType", "summary");
    if (this.destinationIds.length !== 1) issues.destinationIds = "Choose one destination.";
    return issues;
  }
}

class Transportation extends TourismRecord {
  readonly kind = "transportation";

  validateForPublication() {
    return this.required("mode", "operator", "from", "to", "route", "destinationIds");
  }
}

class DiningOption extends TourismRecord {
  readonly kind = "dining";

  validateForPublication() {
    const issues = this.required("cuisine", "location");
    if (this.destinationIds.length !== 1) issues.destinationIds = "Choose one destination.";
    return issues;
  }
}

class VisitorInformation extends TourismRecord {
  readonly kind = "visitor";

  constructor(fields: Fields) {
    super(fields.area === "sarawak" ? { ...fields, destinationIds: "" } : fields);
  }

  validateForPublication() {
    const issues = this.required("guidanceCategory", "summary", "area");
    if (!["sarawak", "destination"].includes(this.fields.area))
      issues.area = "Choose general or destination-specific guidance.";
    if (this.fields.area === "destination" && !this.destinationIds.length)
      issues.destinationIds = "Choose at least one destination.";
    return issues;
  }
}

const subclasses = {
  destination: Destination, event: Event, accommodation: Accommodation,
  transportation: Transportation, dining: DiningOption, visitor: VisitorInformation,
};

export class ItineraryEntry {
  constructor(readonly value: Entry) {}

  updatePlannedInterval(start: unknown, end: unknown) {
    [this.value.start, this.value.end] = readInterval(start, end);
  }

  assessEvent(record: TourismItem | undefined): Notice | undefined {
    if (!record) return "unavailable";
    const status = record.fields.status;
    if (this.value.kind === "event" && (status === "cancelled" || status === "postponed")) return status;
  }

  publishedStart(record: TourismItem | undefined): string | undefined {
    const startsAt = record?.fields.startsAt;
    if (this.value.kind === "event" && validStart(startsAt)) return startsAt;
  }

  /** Compares the published event date with the day this stop is planned for. */
  assessEventDate(record: TourismItem | undefined, travelDate: string): DateNotice | undefined {
    const startsAt = this.publishedStart(record);
    const status = record?.fields.status;
    if (startsAt && (status === "scheduled" || status === "postponed") && startsAt.slice(0, 10) !== travelDate)
      return "different-date";
  }
}

export class Itinerary {
  constructor(readonly value: Plan) {}

  addEntry(record: TourismItem, start: unknown, end: unknown, day?: unknown, note?: unknown) {
    if (record.kind === "visitor") throw new InputError("Choose a destination, event, stay, transport option or place to eat.");
    if (this.value.entries.length >= 50) throw new InputError("This itinerary has 50 entries.");
    const interval = readInterval(start, end);
    this.value.entries.push({
      id: randomUUID(), recordId: record.id, kind: record.kind, day: this.readDay(day), start: interval[0], end: interval[1], note: readNote(note),
    });
  }

  updateEntryTime(id: unknown, start: unknown, end: unknown, day?: unknown, note?: unknown) {
    const entry = this.entry(id);
    new ItineraryEntry(entry).updatePlannedInterval(start, end);
    if (day !== undefined) entry.day = this.readDay(day);
    if (note !== undefined) entry.note = readNote(note);
  }

  removeEntry(id: unknown) {
    const index = this.value.entries.indexOf(this.entry(id));
    this.value.entries.splice(index, 1);
  }

  moveEntry(id: unknown, position: unknown) {
    if (typeof position !== "number" || !Number.isInteger(position) ||
        position < 0 || position >= this.value.entries.length)
      throw new InputError("Choose a valid position.");
    const entry = this.entry(id);
    this.removeEntry(id);
    this.value.entries.splice(position, 0, entry);
  }

  /** Moving the start date moves every stop with it; shortening the trip is refused while stops fall outside it. */
  updateTravelDate(value: unknown) {
    const settings = planSettings(value, daysBetween(this.value.date, this.value.endDate));
    const shift = daysBetween(this.value.date, settings.date);
    const moved = this.value.entries.map((entry) => ({ entry, day: addDays(entry.day, shift) }));
    if (moved.some(({ day }) => day > settings.endDate))
      throw new InputError("Some stops fall after the new end date. Move or remove them first.");
    for (const { entry, day } of moved) entry.day = day;
    Object.assign(this.value, settings);
  }

  detectConflicts(): [string, string][] {
    const timed = this.value.entries.filter((entry) => entry.start);
    return timed.flatMap((a, index) => timed.slice(index + 1)
      .filter((b) => a.day === b.day && a.start < b.end && b.start < a.end)
      .map((b): [string, string] => [a.id, b.id]));
  }

  private readDay(value: unknown): string {
    if (value === undefined || value === "") return this.value.date;
    if (!validDate(value) || value < this.value.date || value > this.value.endDate)
      throw new InputError("Choose a day within the trip dates.");
    return value;
  }

  private entry(id: unknown) {
    const entry = this.value.entries.find((item) => item.id === id);
    if (!entry) throw new InputError("This itinerary entry is unavailable.", 404);
    return entry;
  }
}
