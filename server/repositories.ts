import { createHash } from "node:crypto";

import type { Fields, Plan, PlanSummary, RecordActivity, RecordKind, StaffRecord, TourismItem } from "../src/as03/contracts.ts";
import type { Db } from "./db.ts";
import { pgCode } from "./db.ts";
import { InputError, TourismRecord } from "./domain.ts";

export function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

type StoredRecord = { id: string; kind: RecordKind; version: number; payload: Fields; published?: number | null };

const item = (row: StoredRecord): TourismItem => ({ id: row.id, kind: row.kind, version: row.version, fields: row.payload });
const staffRecord = (row: StoredRecord): StaffRecord => ({ ...item(row), publishedVersion: row.published ?? null });

const publishedSelect = `
  select r.id, r.kind, v.version, v.payload from stis.tourism_record r
  join stis.record_state s on s.record_id = r.id
  join stis.record_version v on v.record_id = r.id and v.version = s.published`;
const draftSelect = `
  select r.id, r.kind, v.version, v.payload, s.published from stis.tourism_record r
  join stis.record_state s on s.record_id = r.id
  join stis.record_version v on v.record_id = r.id and v.version = s.draft`;

const unavailableDraft = () => new InputError("This draft is unavailable.", 404);

export class TourismRepository {
  constructor(private readonly db: Db) {}

  async searchPublished(kind: RecordKind): Promise<TourismItem[]> {
    const rows = await this.db.query<StoredRecord>(`${publishedSelect} where r.kind = $1 order by lower(v.payload->>'title'), r.id`, [kind]);
    return rows.map(item);
  }

  async findPublished(id: string): Promise<TourismItem | undefined> {
    const [row] = await this.db.query<StoredRecord>(`${publishedSelect} where r.id = $1`, [id]);
    return row && item(row);
  }

  async publishedLinkedTo(destinationId: string): Promise<TourismItem[]> {
    const rows = await this.db.query<StoredRecord>(`select r.id, r.kind, v.version, v.payload from stis.version_destination d
      join stis.record_state s on s.record_id = d.record_id and s.published = d.version
      join stis.tourism_record r on r.id = d.record_id
      join stis.record_version v on v.record_id = r.id and v.version = s.published
      where d.destination_id = $1 order by r.kind, lower(v.payload->>'title'), r.id`, [destinationId]);
    return rows.map(item);
  }

  async listDrafts(): Promise<StaffRecord[]> {
    const rows = await this.db.query<StoredRecord>(`${draftSelect} order by r.kind, lower(v.payload->>'title'), r.id`);
    return rows.map(staffRecord);
  }

  async loadDraft(id: string, db: Db = this.db, lock = false): Promise<StaffRecord> {
    const [row] = await db.query<StoredRecord>(`${draftSelect} where r.id = $1${lock ? " for update of s" : ""}`, [id]);
    if (!row) throw unavailableDraft();
    return staffRecord(row);
  }

  async saveDraft(id: string, kind: RecordKind, draft: TourismRecord, expected: number | null, actor: string | null): Promise<StaffRecord> {
    try {
      return await this.db.transaction(async (tx) => {
        const previous = expected === null ? null : await this.loadDraft(id, tx, true);
        if (previous && previous.kind !== kind)
          throw new InputError("The category of an existing record cannot be changed. Create a new record in the other category.", 422);
        if (previous && previous.version !== expected)
          throw new InputError("This draft changed. Reload it before editing.", 409);
        if (!previous) await tx.query("insert into stis.tourism_record(id, kind) values ($1, $2)", [id, kind]);
        const version = (previous?.version ?? 0) + 1;
        await tx.query("insert into stis.record_version(record_id, version, payload, author_id) values ($1, $2, $3::text::jsonb, $4)",
          [id, version, JSON.stringify(draft.fields), actor]);
        for (const target of draft.destinationIds) {
          const [existing] = await tx.query<{ kind: string }>("select kind from stis.tourism_record where id = $1", [target]);
          if (existing?.kind !== "destination")
            throw new InputError("Choose existing destinations.", 422, { destinationIds: "A selected destination is unavailable." });
          await tx.query("insert into stis.version_destination(record_id, version, destination_id) values ($1, $2, $3)", [id, version, target]);
        }
        await tx.query(`insert into stis.record_state(record_id, draft, published) values ($1, $2, null)
          on conflict (record_id) do update set draft = excluded.draft, updated_at = now()`, [id, version]);
        await this.recordActivity(tx, id, previous ? "save" : "create", version, actor);
        return this.loadDraft(id, tx);
      });
    } catch (error) {
      if (pgCode(error) === "23505") throw new InputError("This draft changed. Reload it before editing.", 409);
      throw error;
    }
  }

  async commitPublication(draft: StaffRecord, destinations: string[], actor: string | null): Promise<StaffRecord> {
    return this.db.transaction(async (tx) => {
      for (const id of destinations) {
        const [target] = await tx.query<{ kind: string }>(`select r.kind from stis.record_state s join stis.tourism_record r on r.id = s.record_id
          where s.record_id = $1 and s.published is not null for share of s`, [id]);
        if (target?.kind !== "destination")
          throw new InputError("Choose published destinations.", 422, { destinationIds: "Publish each related destination first." });
      }
      const changed = await tx.query(`update stis.record_state set published = $1, updated_at = now()
        where record_id = $2 and draft = $1 returning record_id`, [draft.version, draft.id]);
      if (!changed.length) throw new InputError("This draft changed. Reload it before publishing.", 409);
      await this.recordActivity(tx, draft.id, "publish", draft.version, actor);
      return this.loadDraft(draft.id, tx);
    });
  }

  async withdraw(id: string, actor: string | null): Promise<StaffRecord> {
    return this.db.transaction(async (tx) => {
      const current = await this.loadDraft(id, tx, true);
      if (current.publishedVersion === null)
        throw new InputError("This record is not published, so there is nothing to withdraw.", 409);
      const linked = await tx.query(`select 1 from stis.version_destination d join stis.record_state s
          on s.record_id = d.record_id and s.published = d.version
        where d.destination_id = $1 limit 1`, [id]);
      if (linked.length) throw new InputError("Update or withdraw the published records that refer to this destination first.", 409);
      const changed = await tx.query(`update stis.record_state set published = null, updated_at = now()
        where record_id = $1 and published is not null returning record_id`, [id]);
      if (!changed.length) throw new InputError("This record is not published, so there is nothing to withdraw.", 409);
      await this.recordActivity(tx, id, "withdraw", current.publishedVersion, actor);
      return this.loadDraft(id, tx);
    });
  }

  async history(id: string): Promise<RecordActivity[]> {
    await this.loadDraft(id);
    return this.db.query<RecordActivity>(`select a.action, a.version, coalesce(u.display_name, null) as actor,
        to_char(a.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as at
      from stis.record_activity a left join stis.account u on u.id = a.actor_id
      where a.record_id = $1 order by a.id desc limit 200`, [id]);
  }

  private async recordActivity(tx: Db, id: string, action: RecordActivity["action"], version: number, actor: string | null) {
    await tx.query("insert into stis.record_activity(record_id, action, version, actor_id) values ($1, $2, $3, $4)", [id, action, version, actor]);
  }
}

export type PlanAccess = { accountId?: string; guest?: string };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const unavailablePlan = () => new InputError("This itinerary access link is invalid or the itinerary was removed.", 404);
type PlanRow = { id: string; title: string; date: string; end_date: string; provisional: boolean; revision: number; owner_id: string | null };

function accessParams(access: PlanAccess) {
  return [access.accountId ?? null, access.guest ? digest(access.guest) : null];
}
const accessClause = "((owner_id is not null and owner_id = $2::uuid) or (guest_digest is not null and guest_digest = $3))";

export class ItineraryRepository {
  constructor(private readonly db: Db) {}

  async create(plan: Plan, owner: { accountId: string } | { guest: string }) {
    await this.db.query(`insert into stis.itinerary(id, owner_id, guest_digest, title, start_date, end_date, provisional, revision)
      values ($1, $2, $3, $4, $5, $6, $7, $8)`, [plan.id, "accountId" in owner ? owner.accountId : null,
      "guest" in owner ? digest(owner.guest) : null, plan.title, plan.date, plan.endDate, plan.provisional, plan.revision]);
  }

  async load(id: string, access: PlanAccess, db: Db = this.db): Promise<Plan & { owned: boolean }> {
    if (!uuid.test(id) || (!access.accountId && !access.guest)) throw unavailablePlan();
    const [row] = await db.query<PlanRow>(`select id, title, start_date as date, end_date, provisional, revision, owner_id
      from stis.itinerary where id = $1 and ${accessClause}`, [id, ...accessParams(access)]);
    if (!row) throw unavailablePlan();
    const entries = await db.query<Plan["entries"][number]>(`select id, record_id as "recordId", kind, day, start_time as start, end_time as "end", note
      from stis.itinerary_entry where itinerary_id = $1 order by position`, [id]);
    return { id: row.id, title: row.title, date: row.date, endDate: row.end_date, provisional: row.provisional, revision: row.revision, entries, owned: row.owner_id !== null };
  }

  async save(plan: Plan, access: PlanAccess) {
    return this.db.transaction(async (tx) => {
      const changed = await tx.query(`update stis.itinerary set title = $4, start_date = $5, end_date = $6, provisional = $7,
          revision = revision + 1, updated_at = now()
        where id = $1 and ${accessClause} and revision = $8 returning id`,
      [plan.id, ...accessParams(access), plan.title, plan.date, plan.endDate, plan.provisional, plan.revision]);
      if (!changed.length) throw new InputError("This itinerary changed. Reopen it before saving.", 409);
      await tx.query("delete from stis.itinerary_entry where itinerary_id = $1", [plan.id]);
      for (const [position, entry] of plan.entries.entries()) {
        await tx.query(`insert into stis.itinerary_entry(id, itinerary_id, record_id, kind, day, start_time, end_time, note, position)
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [entry.id, plan.id, entry.recordId, entry.kind, entry.day, entry.start, entry.end, entry.note, position]);
      }
      return this.load(plan.id, access, tx);
    });
  }

  async delete(id: string, access: PlanAccess) {
    if (!uuid.test(id) || (!access.accountId && !access.guest)) throw unavailablePlan();
    const removed = await this.db.query(`delete from stis.itinerary where id = $1 and ${accessClause} returning id`, [id, ...accessParams(access)]);
    if (!removed.length) throw unavailablePlan();
  }

  async listOwned(accountId: string): Promise<PlanSummary[]> {
    return this.db.query<PlanSummary>(`select i.id, i.title, i.start_date as date, i.end_date as "endDate", i.provisional,
        (select count(*)::int from stis.itinerary_entry e where e.itinerary_id = i.id) as "entryCount",
        to_char(i.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "updatedAt"
      from stis.itinerary i where i.owner_id = $1 order by i.updated_at desc, i.id`, [accountId]);
  }

  async claim(id: string, guest: string, accountId: string) {
    return this.db.transaction(async (tx) => {
      if (!uuid.test(id)) throw unavailablePlan();
      const claimed = await tx.query(`update stis.itinerary set owner_id = $2, guest_digest = null, revision = revision + 1, updated_at = now()
        where id = $1 and guest_digest = $3 and owner_id is null returning id`, [id, accountId, digest(guest)]);
      if (!claimed.length) throw unavailablePlan();
      return this.load(id, { accountId }, tx);
    });
  }
}
