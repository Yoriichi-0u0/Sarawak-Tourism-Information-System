import { seedListings } from "../../src/data.ts";
import type { Fields, RecordKind } from "../../src/as03/contracts.ts";
import { TourismRecord } from "./domain.ts";
import { Storage, TourismRepository } from "./storage.ts";

export function seedCatalogue(storage: Storage, repo: TourismRepository) {
  storage.write(() => {
    if (storage.db.prepare("SELECT 1 FROM tourism_record LIMIT 1").get()) return;
    const add = (id: string, kind: RecordKind, fields: Fields) => {
      const domain = TourismRecord.parse(kind, fields);
      const draft = repo.saveDraft(id, kind, domain, null);
      repo.commitPublication(draft, domain.destinationIds);
    };
    for (const item of seedListings.filter((listing) => listing.kind === "discover")) {
      add(item.id, "destination", {
        title: item.name, location: item.region, interest: item.category,
        summary: item.description, activities: item.duration, image: item.image, provider: item.url,
      });
    }
    add("sample-event", "event", {
      title: "Kuching cultural showcase", destinationIds: "waterfront", venue: "Waterfront stage",
      status: "scheduled", startsAt: "2026-11-27T10:00",
      summary: "Fictional event for the assessed workflow demonstration.",
      provider: "https://example.org/",
    });
    add("sample-workshop", "event", {
      title: "Heritage craft workshop", destinationIds: "culture", venue: "Community studio",
      status: "scheduled", startsAt: "2026-11-28T14:00",
      summary: "Fictional craft workshop for the assessment dataset.",
    });
    add("sample-accommodation", "accommodation", {
      title: "Waterfront Heritage Inn", destinationIds: "waterfront", accommodationType: "Inn",
      summary: "Fictional accommodation record for the assessment dataset.",
    });
    add("sample-transport", "transportation", {
      title: "Kuching Heritage Shuttle", destinationIds: "waterfront,culture",
      operator: "Sample Shuttle", route: "Waterfront to Cultural Village",
    });
    add("sample-dining", "dining", {
      title: "Riverfront Cafe", destinationIds: "waterfront", cuisine: "Sarawakian", location: "Kuching",
    });
    add("sample-guidance", "visitor", {
      title: "Outdoor visits", area: "sarawak", guidanceCategory: "General",
      summary: "Check local conditions with the destination operator before travelling.",
    });
  });
}
