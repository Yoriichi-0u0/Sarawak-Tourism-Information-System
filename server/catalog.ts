import type { RecordKind, TourismItem } from "../src/as03/contracts.ts";
import { splitTags } from "../src/shared/catalogue.ts";
import { InputError, validDate } from "./domain.ts";
import type { TourismRepository } from "./repositories.ts";

type Filters = Record<string, unknown>;

function filterText(value: unknown, limit = 200): string {
  if (value === undefined) return "";
  if (typeof value !== "string" || value.length > limit) throw new InputError("Enter shorter search criteria.");
  return value.trim().toLowerCase();
}

function filterDate(value: unknown): string {
  const date = filterText(value);
  if (date && !validDate(date)) throw new InputError("Enter a valid date.");
  return date;
}

const field = (item: TourismItem, key: string) => (item.fields[key] ?? "").toLowerCase();
const hasAll = (item: TourismItem, key: string, wanted: string) => {
  const required = splitTags(wanted);
  const present = new Set(splitTags(item.fields[key]));
  return required.every((tag) => present.has(tag));
};

export type JourneyLeg = { record: TourismItem; from: string; to: string; reversed: boolean };
export type JourneyOptions = { direct: JourneyLeg[]; connections: [JourneyLeg, JourneyLeg][]; alternatives: JourneyLeg[] };

const place = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

export class TourismCatalog {
  constructor(private readonly repository: TourismRepository) {}

  async search(kind: RecordKind, filters: Filters = {}): Promise<TourismItem[]> {
    switch (kind) {
      case "destination": return this.findDestinations(filters);
      case "event": return this.findEvents(filters);
      case "accommodation": return this.findAccommodation(filters);
      case "transportation": return this.findTransport(filters);
      case "dining": return this.findDining(filters);
      case "visitor": return this.findVisitorInformation(filters);
    }
  }

  async findDestinations(filters: Filters = {}) {
    const query = filterText(filters.query);
    const location = filterText(filters.location);
    const interest = filterText(filters.interest);
    return (await this.repository.searchPublished("destination")).filter((item) =>
      field(item, "title").includes(query) && field(item, "location").includes(location) && field(item, "interest").includes(interest));
  }

  async findEvents(filters: Filters = {}) {
    const query = filterText(filters.query);
    const location = filterText(filters.location);
    const date = filterDate(filters.date);
    const from = filterDate(filters.from);
    const to = filterDate(filters.to);
    if (from && to && to < from) throw new InputError("Choose an end date on or after the start date.");
    const places = await this.destinationPlaces();
    return (await this.repository.searchPublished("event")).filter((item) => {
      const start = (item.fields.startsAt ?? "").slice(0, 10);
      const end = (item.fields.endsAt || item.fields.startsAt || "").slice(0, 10);
      return field(item, "title").includes(query) &&
        `${field(item, "venue")} ${places.get(item.fields.destinationIds) ?? ""}`.includes(location) &&
        (!date || (start !== "" && start <= date && date <= end)) &&
        (!from || (end !== "" && end >= from)) && (!to || (start !== "" && start <= to));
    });
  }

  async findAccommodation(filters: Filters = {}) {
    const query = filterText(filters.query);
    const location = filterText(filters.location);
    const type = filterText(filters.type);
    const price = filterText(filters.price);
    const amenities = filterText(filters.amenities);
    const accessibility = filterText(filters.accessibility);
    const places = await this.destinationPlaces();
    return (await this.repository.searchPublished("accommodation")).filter((item) =>
      field(item, "title").includes(query) &&
      `${field(item, "location")} ${places.get(item.fields.destinationIds) ?? ""}`.includes(location) &&
      (!type || field(item, "accommodationType") === type) && (!price || field(item, "priceGuide") === price) &&
      hasAll(item, "amenities", amenities) && hasAll(item, "accessibility", accessibility));
  }

  async findDining(filters: Filters = {}) {
    const query = filterText(filters.query);
    const location = filterText(filters.location);
    const cuisine = filterText(filters.cuisine);
    const dietary = filterText(filters.dietary);
    const places = await this.destinationPlaces();
    return (await this.repository.searchPublished("dining")).filter((item) =>
      field(item, "title").includes(query) && field(item, "cuisine").includes(cuisine) &&
      `${field(item, "location")} ${places.get(item.fields.destinationIds) ?? ""}`.includes(location) &&
      hasAll(item, "dietary", dietary));
  }

  async findTransport(filters: Filters = {}) {
    const query = filterText(filters.query);
    const mode = filterText(filters.mode);
    const from = filterText(filters.from);
    const to = filterText(filters.to);
    return (await this.repository.searchPublished("transportation")).filter((item) =>
      `${field(item, "title")} ${field(item, "operator")}`.includes(query) && (!mode || field(item, "mode") === mode) &&
      field(item, "from").includes(from) && field(item, "to").includes(to));
  }

  async findVisitorInformation(filters: Filters = {}) {
    const query = filterText(filters.query);
    const category = filterText(filters.category);
    const destination = filterText(filters.destination, 100);
    const records = (await this.repository.searchPublished("visitor")).filter((item) =>
      `${field(item, "title")} ${field(item, "summary")} ${field(item, "details")}`.includes(query) &&
      (!category || field(item, "guidanceCategory") === category) &&
      (!destination || item.fields.area === "sarawak" || splitTags(item.fields.destinationIds).includes(destination)));
    return records.sort((a, b) => Number(b.fields.priority === "urgent") - Number(a.fields.priority === "urgent"));
  }

  async journeys(filters: Filters = {}): Promise<JourneyOptions> {
    const from = filterText(filters.from, 100);
    const to = filterText(filters.to, 100);
    if (!from || !to) throw new InputError("Enter where the journey starts and where it ends.");
    const legs = (await this.repository.searchPublished("transportation")).flatMap((record): JourneyLeg[] => {
      const forward = { record, from: record.fields.from ?? "", to: record.fields.to ?? "", reversed: false };
      return record.fields.direction === "one-way" ? [forward] : [forward, { record, from: forward.to, to: forward.from, reversed: true }];
    });
    const starts = (leg: JourneyLeg) => place(leg.from).includes(from);
    const ends = (leg: JourneyLeg) => place(leg.to).includes(to);
    const unique = (list: JourneyLeg[]) => list.filter((leg, index) => list.findIndex((other) => other.record.id === leg.record.id) === index);
    const direct = unique(legs.filter((leg) => starts(leg) && ends(leg)));
    const connections = legs.filter((first) => starts(first) && !ends(first)).flatMap((first) => legs
      .filter((second) => second.record.id !== first.record.id && ends(second) && place(second.from) === place(first.to))
      .map((second): [JourneyLeg, JourneyLeg] => [first, second]));
    const used = new Set([...direct, ...connections.flat()].map((leg) => leg.record.id));
    const alternatives = unique(legs.filter((leg) => ends(leg) && !used.has(leg.record.id)));
    return { direct, connections, alternatives };
  }

  async places(): Promise<string[]> {
    const names = new Map<string, string>();
    for (const item of await this.repository.searchPublished("transportation"))
      for (const name of [item.fields.from, item.fields.to]) if (name?.trim()) names.set(place(name), name.trim());
    return [...names.values()].sort((a, b) => a.localeCompare(b));
  }

  async related(kind: RecordKind, id: string): Promise<Partial<Record<RecordKind, TourismItem[]>>> {
    const record = await this.repository.findPublished(id);
    if (!record || record.kind !== kind) throw new InputError("This information is unavailable.", 404);
    if (kind === "destination") {
      const grouped: Partial<Record<RecordKind, TourismItem[]>> = {};
      for (const item of await this.repository.publishedLinkedTo(id)) (grouped[item.kind] ??= []).push(item);
      return grouped;
    }
    const destinations: TourismItem[] = [];
    for (const target of splitTags(record.fields.destinationIds)) {
      const destination = await this.repository.findPublished(target);
      if (destination?.kind === "destination") destinations.push(destination);
    }
    return { destination: destinations };
  }

  getPublishedRecord(id: string) {
    return this.repository.findPublished(id);
  }

  listPublished(kind: RecordKind) {
    return this.repository.searchPublished(kind);
  }

  async getPublishedEvent(id: string) {
    const record = await this.getPublishedRecord(id);
    return record?.kind === "event" ? record : undefined;
  }

  private async destinationPlaces() {
    return new Map((await this.repository.searchPublished("destination"))
      .map((item) => [item.id, `${item.fields.title ?? ""} ${item.fields.location ?? ""}`.toLowerCase()]));
  }
}
