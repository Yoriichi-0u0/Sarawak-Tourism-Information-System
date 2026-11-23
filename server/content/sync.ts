import type { Fields } from "../../src/shared/contracts.ts";
import { InputError, TourismRecord } from "../domain.ts";
import type { TourismRepository } from "../repositories.ts";
import { catalogue, type ContentRecord } from "./catalogue.ts";

const canonical = (fields: Fields) => JSON.stringify(Object.keys(fields).sort().map((key) => [key, fields[key]]));

/** Publishes curated content through the normal draft → validate → publish path. Existing records change only when update is true. */
export async function syncContent(repository: TourismRepository, records: ContentRecord[] = catalogue, options: { update?: boolean } = {}) {
  const ordered = [...records].sort((a, b) => Number(b.kind === "destination") - Number(a.kind === "destination"));
  const result = { created: [] as string[], updated: [] as string[], unchanged: [] as string[] };
  for (const { id, kind, fields } of ordered) {
    const record = TourismRecord.parse(kind, fields);
    const issues = record.validateForPublication();
    if (Object.keys(issues).length) throw new Error(`Content record ${id} is incomplete: ${Object.keys(issues).join(", ")}`);
    const existing = await repository.loadDraft(id).catch((error) => {
      if (error instanceof InputError && error.status === 404) return undefined;
      throw error;
    });
    if (existing && existing.kind !== kind) throw new Error(`Content record ${id} already exists as ${existing.kind}.`);
    if (existing && (!options.update || (canonical(existing.fields) === canonical(record.fields) && existing.publishedVersion === existing.version))) {
      result.unchanged.push(id);
      continue;
    }
    const draft = await repository.saveDraft(id, kind, record, existing?.version ?? null, null);
    await repository.commitPublication(draft, record.destinationIds, null);
    (existing ? result.updated : result.created).push(id);
  }
  return result;
}
