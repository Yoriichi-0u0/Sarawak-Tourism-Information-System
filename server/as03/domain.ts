import { randomUUID } from "node:crypto";

import { safeProvider } from "../../src/domain.ts";
import { editableFields, fieldLabels } from "../../src/as03/contracts.ts";
import type { Entry, Fields, Notice, Plan, PlanSettings, RecordKind, TourismItem } from "../../src/as03/contracts.ts";

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

export function planSettings(value: unknown): PlanSettings {
  const { date, provisional } = object(value);
  if (!validDate(date)) throw new InputError("Enter a valid date.");
  if (typeof provisional !== "boolean") throw new InputError("Choose a date status.");
  return { date, provisional };
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
  constructor(readonly fields: Fields) {}

  get destinationIds(): string[] {
    return [...new Set((this.fields.destinationIds ?? "").split(",").filter(Boolean))];
  }

  protected required(...keys: string[]): Fields {
    const issues: Fields = {};
    for (const key of ["title", ...keys])
      if (!this.fields[key]) issues[key] = `Enter ${fieldLabels[key].toLowerCase()}.`;
    const provider = this.fields.provider;
    if (provider && (!safeProvider(provider) || new URL(provider).username || new URL(provider).password))
      issues.provider = "Enter an HTTPS provider URL without credentials.";
    return issues;
  }

  abstract validateForPublication(): Fields;

  static parse(kind: RecordKind, value: unknown): TourismRecord {
    const raw = object(value);
    const fields: Fields = {};
    for (const key of editableFields(kind)) {
      const candidate = raw[key] ?? "";
      if (typeof candidate !== "string" || candidate.length > 2000)
        throw new InputError(`Enter a valid ${fieldLabels[key].toLowerCase()}.`);
      fields[key] = candidate.trim();
    }
    fields.destinationIds = (fields.destinationIds ?? "").split(",")
      .map((value) => value.trim()).filter(Boolean).join(",");
    return new subclasses[kind](fields);
  }
}

class Destination extends TourismRecord {
  validateForPublication() {
    return this.required("location", "interest", "summary");
  }
}

class Event extends TourismRecord {
  validateForPublication() {
    const issues = this.required("venue", "status");
    if (this.destinationIds.length !== 1) issues.destinationIds = "Choose one hosting destination.";
    const { status, startsAt } = this.fields;
    if (!["scheduled", "postponed", "cancelled"].includes(status))
      issues.status = "Choose a valid event status.";
    if ((status === "scheduled" || startsAt) &&
        (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(startsAt) ||
          !validDate(startsAt.slice(0, 10))))
      issues.startsAt = "Enter a valid Kuching date and time.";
    return issues;
  }
}

class Accommodation extends TourismRecord {
  validateForPublication() {
    const issues = this.required("accommodationType", "summary");
    if (this.destinationIds.length !== 1) issues.destinationIds = "Choose one destination.";
    return issues;
  }
}

class Transportation extends TourismRecord {
  validateForPublication() {
    return this.required("operator", "route", "destinationIds");
  }
}

class DiningOption extends TourismRecord {
  validateForPublication() {
    const issues = this.required("cuisine", "location");
    if (this.destinationIds.length !== 1) issues.destinationIds = "Choose one destination.";
    return issues;
  }
}

class VisitorInformation extends TourismRecord {
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
}

export class Itinerary {
  constructor(readonly value: Plan) {}

  addEntry(record: TourismItem, start: unknown, end: unknown) {
    if (record.kind !== "event" && record.kind !== "destination")
      throw new InputError("Choose a destination or event.");
    if (this.value.entries.length >= 50) throw new InputError("This itinerary has 50 entries.");
    const interval = readInterval(start, end);
    this.value.entries.push({
      id: randomUUID(), recordId: record.id, kind: record.kind, start: interval[0], end: interval[1],
    });
  }

  updateEntryTime(id: unknown, start: unknown, end: unknown) {
    new ItineraryEntry(this.entry(id)).updatePlannedInterval(start, end);
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

  updateTravelDate(value: unknown) {
    Object.assign(this.value, planSettings(value));
  }

  detectConflicts(): [string, string][] {
    const timed = this.value.entries.filter((entry) => entry.start);
    return timed.flatMap((a, index) => timed.slice(index + 1)
      .filter((b) => a.start < b.end && b.start < a.end)
      .map((b): [string, string] => [a.id, b.id]));
  }

  private entry(id: unknown) {
    const entry = this.value.entries.find((item) => item.id === id);
    if (!entry) throw new InputError("This itinerary entry is unavailable.", 404);
    return entry;
  }
}
