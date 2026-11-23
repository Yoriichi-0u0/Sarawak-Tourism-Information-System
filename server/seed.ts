import { seedListings } from "../src/data.ts";
import type { Fields, RecordKind } from "../src/shared/contracts.ts";
import { TourismRecord } from "./domain.ts";
import type { Db } from "./db.ts";
import type { TourismRepository } from "./repositories.ts";

export async function seedCatalogue(db: Db, repo: TourismRepository) {
  if ((await db.query("select 1 from stis.tourism_record limit 1")).length) return;
  {
    const add = async (id: string, kind: RecordKind, fields: Fields) => {
      const domain = TourismRecord.parse(kind, fields);
      const draft = await repo.saveDraft(id, kind, domain, null, null);
      await repo.commitPublication(draft, domain.destinationIds, null);
    };
    for (const item of seedListings.filter((listing) => listing.kind === "discover")) {
      await add(item.id, "destination", {
        title: item.name, location: item.region, interest: item.category,
        summary: item.description, activities: item.duration, image: item.image, provider: item.url,
      });
    }
    await add("sample-event", "event", {
      title: "Kuching cultural showcase", destinationIds: "waterfront", venue: "Waterfront stage",
      status: "scheduled", startsAt: "2026-11-27T10:00",
      summary: "Fictional event for the assessed workflow demonstration.",
      provider: "https://example.org/",
    });
    await add("sample-workshop", "event", {
      title: "Heritage craft workshop", destinationIds: "culture", venue: "Community studio",
      status: "scheduled", startsAt: "2026-11-28T14:00",
      summary: "Fictional craft workshop for the assessment dataset.",
    });
    await add("sample-accommodation", "accommodation", {
      title: "Waterfront Heritage Inn", destinationIds: "waterfront", accommodationType: "Inn",
      summary: "Fictional accommodation record for the assessment dataset.",
    });
    await add("sample-transport", "transportation", {
      title: "Kuching Heritage Shuttle", destinationIds: "waterfront,culture",
      operator: "Sample Shuttle", route: "Waterfront to Cultural Village", mode: "shuttle",
      from: "Kuching Waterfront", to: "Sarawak Cultural Village",
    });
    await add("sample-dining", "dining", {
      title: "Riverfront Cafe", destinationIds: "waterfront", cuisine: "Sarawakian", location: "Kuching",
    });
    await add("sample-guidance", "visitor", {
      title: "Outdoor visits", area: "sarawak", guidanceCategory: "General",
      summary: "Check local conditions with the destination operator before travelling.",
    });
  }
}
