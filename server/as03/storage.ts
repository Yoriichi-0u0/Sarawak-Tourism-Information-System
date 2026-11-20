import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import type { Fields, Plan, RecordKind, StaffRecord, TourismItem } from "../../src/as03/contracts.ts";
import { InputError, TourismRecord } from "./domain.ts";

export function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export class Storage {
  readonly db: DatabaseSync;

  constructor(databasePath: string) {
    this.db = new DatabaseSync(databasePath);
    try {
      this.db.exec(`
        PRAGMA foreign_keys = ON;
        PRAGMA busy_timeout = 3000;
        CREATE TABLE IF NOT EXISTS tourism_record (
          id TEXT PRIMARY KEY, kind TEXT NOT NULL, UNIQUE(id, kind)
        );
        CREATE TABLE IF NOT EXISTS record_version (
          record_id TEXT NOT NULL REFERENCES tourism_record(id),
          version INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(record_id, version)
        );
        CREATE TABLE IF NOT EXISTS record_state (
          record_id TEXT PRIMARY KEY REFERENCES tourism_record(id), draft INTEGER NOT NULL, published INTEGER,
          FOREIGN KEY(record_id, draft) REFERENCES record_version(record_id, version),
          FOREIGN KEY(record_id, published) REFERENCES record_version(record_id, version)
        );
        CREATE TABLE IF NOT EXISTS version_destination (
          record_id TEXT NOT NULL, version INTEGER NOT NULL,
          destination_id TEXT NOT NULL REFERENCES tourism_record(id),
          PRIMARY KEY(record_id, version, destination_id),
          FOREIGN KEY(record_id, version) REFERENCES record_version(record_id, version)
        );
        CREATE TABLE IF NOT EXISTS itinerary (
          id TEXT PRIMARY KEY, guest_digest TEXT NOT NULL, date TEXT NOT NULL,
          provisional INTEGER NOT NULL CHECK(provisional IN (0,1)), revision INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS itinerary_entry (
          id TEXT PRIMARY KEY, itinerary_id TEXT NOT NULL REFERENCES itinerary(id) ON DELETE CASCADE,
          recordId TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('event','destination')),
          start TEXT NOT NULL, end TEXT NOT NULL, position INTEGER NOT NULL,
          FOREIGN KEY(recordId, kind) REFERENCES tourism_record(id, kind),
          CHECK((start = '' AND end = '') OR (start <> '' AND end <> '' AND start < end))
        );
        CREATE INDEX IF NOT EXISTS itinerary_entry_plan ON itinerary_entry(itinerary_id, position);
        CREATE TABLE IF NOT EXISTS staff_account (
          id TEXT PRIMARY KEY, salt TEXT NOT NULL, password_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE IF NOT EXISTS staff_session (
          token_digest TEXT PRIMARY KEY, staff_id TEXT NOT NULL REFERENCES staff_account(id), expires_at INTEGER NOT NULL
        );
      `);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  write<T>(operation: () => T): T {
    if (this.db.isTransaction) return operation();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

type StoredRecord = { id: string; kind: RecordKind; version: number; payload: string; published?: number | null };

function record(row: StoredRecord): TourismItem {
  return { id: row.id, kind: row.kind, version: row.version, fields: JSON.parse(row.payload) as Fields };
}

export class TourismRepository {
  constructor(private readonly storage: Storage) {}

  searchPublished(kind: RecordKind): TourismItem[] {
    return (this.storage.db.prepare(`
      SELECT r.id, r.kind, v.version, v.payload FROM tourism_record r
      JOIN record_state s ON s.record_id = r.id
      JOIN record_version v ON v.record_id = r.id AND v.version = s.published
      WHERE r.kind = ? ORDER BY json_extract(v.payload, '$.title') COLLATE NOCASE, r.id
    `).all(kind) as StoredRecord[]).map(record);
  }

  findPublished(id: string): TourismItem | undefined {
    const row = this.storage.db.prepare(`
      SELECT r.id, r.kind, v.version, v.payload FROM tourism_record r
      JOIN record_state s ON s.record_id = r.id
      JOIN record_version v ON v.record_id = r.id AND v.version = s.published WHERE r.id = ?
    `).get(id) as StoredRecord | undefined;
    return row && record(row);
  }

  listDrafts(): StaffRecord[] {
    return (this.storage.db.prepare(`
      SELECT r.id, r.kind, v.version, v.payload, s.published FROM tourism_record r
      JOIN record_state s ON s.record_id = r.id
      JOIN record_version v ON v.record_id = r.id AND v.version = s.draft
      ORDER BY r.kind, json_extract(v.payload, '$.title') COLLATE NOCASE
    `).all() as StoredRecord[]).map((row) => ({ ...record(row), publishedVersion: row.published ?? null }));
  }

  loadDraft(id: string): StaffRecord {
    const row = this.storage.db.prepare(`
      SELECT r.id, r.kind, v.version, v.payload, s.published FROM tourism_record r
      JOIN record_state s ON s.record_id = r.id
      JOIN record_version v ON v.record_id = r.id AND v.version = s.draft WHERE r.id = ?
    `).get(id) as StoredRecord | undefined;
    if (!row) throw new InputError("This draft is unavailable.", 404);
    return { ...record(row), publishedVersion: row.published ?? null };
  }

  saveDraft(id: string, kind: RecordKind, draft: TourismRecord, expected: number | null): StaffRecord {
    return this.storage.write(() => {
      const db = this.storage.db;
      const previous = expected === null ? null : this.loadDraft(id);
      if (previous && (previous.version !== expected || previous.kind !== kind))
        throw new InputError("This draft changed. Reload it before editing.", 409);
      if (!previous) db.prepare("INSERT INTO tourism_record VALUES (?, ?)").run(id, kind);
      const version = (previous?.version ?? 0) + 1;
      db.prepare("INSERT INTO record_version VALUES (?, ?, ?)").run(id, version, JSON.stringify(draft.fields));
      for (const target of draft.destinationIds) {
        const existing = db.prepare("SELECT kind FROM tourism_record WHERE id = ?").get(target);
        if (existing?.kind !== "destination")
          throw new InputError("Choose existing destinations.", 422, { destinationIds: "A selected destination is unavailable." });
        db.prepare("INSERT INTO version_destination VALUES (?, ?, ?)").run(id, version, target);
      }
      db.prepare(`
        INSERT INTO record_state(record_id, draft, published) VALUES (?, ?, NULL)
        ON CONFLICT(record_id) DO UPDATE SET draft = excluded.draft
      `).run(id, version);
      return this.loadDraft(id);
    });
  }

  commitPublication(draft: StaffRecord, destinations: string[]): StaffRecord {
    return this.storage.write(() => {
      const db = this.storage.db;
      for (const id of destinations) {
        if (this.findPublished(id)?.kind !== "destination")
          throw new InputError("Choose published destinations.", 422, { destinationIds: "Publish each related destination first." });
      }
      const result = db.prepare("UPDATE record_state SET published = ? WHERE record_id = ? AND draft = ?")
        .run(draft.version, draft.id, draft.version);
      if (!result.changes) throw new InputError("This draft changed. Reload it before publishing.", 409);
      return this.loadDraft(draft.id);
    });
  }

  withdraw(id: string): StaffRecord {
    return this.storage.write(() => {
      const db = this.storage.db;
      const linked = db.prepare(`
        SELECT 1 FROM version_destination d JOIN record_state s
          ON s.record_id = d.record_id AND s.published = d.version
        WHERE d.destination_id = ? LIMIT 1
      `).get(id);
      if (linked) throw new InputError("Update or withdraw the published records that refer to this destination first.", 409);
      db.prepare("UPDATE record_state SET published = NULL WHERE record_id = ?").run(id);
      return this.loadDraft(id);
    });
  }
}

export class ItineraryRepository {
  constructor(private readonly storage: Storage) {}

  createForGuest(plan: Plan, guest: string) {
    this.storage.db.prepare("INSERT INTO itinerary VALUES (?, ?, ?, ?, ?)")
      .run(plan.id, digest(guest), plan.date, Number(plan.provisional), plan.revision);
  }

  getForGuest(id: string, guest: string): Plan {
    const db = this.storage.db;
    const row = db.prepare("SELECT id, date, provisional, revision FROM itinerary WHERE id = ? AND guest_digest = ?")
      .get(id, digest(guest)) as unknown as Omit<Plan, "entries"> | undefined;
    if (!row) throw new InputError("This itinerary access link is invalid or the itinerary was removed.", 404);
    const entries = db.prepare("SELECT id, recordId, kind, start, end FROM itinerary_entry WHERE itinerary_id = ? ORDER BY position")
      .all(id) as unknown as Plan["entries"];
    return { ...row, provisional: Boolean(row.provisional), entries };
  }

  saveForGuest(plan: Plan, guest: string) {
    return this.storage.write(() => {
      const db = this.storage.db;
      const result = db.prepare(`
        UPDATE itinerary SET date = ?, provisional = ?, revision = revision + 1
        WHERE id = ? AND guest_digest = ? AND revision = ?
      `).run(plan.date, Number(plan.provisional), plan.id, digest(guest), plan.revision);
      if (!result.changes) throw new InputError("This itinerary changed. Reopen it before saving.", 409);
      db.prepare("DELETE FROM itinerary_entry WHERE itinerary_id = ?").run(plan.id);
      const add = db.prepare("INSERT INTO itinerary_entry VALUES (?, ?, ?, ?, ?, ?, ?)");
      plan.entries.forEach((e, i) => add.run(e.id, plan.id, e.recordId, e.kind, e.start, e.end, i));
      return this.getForGuest(plan.id, guest);
    });
  }

  deleteForGuest(id: string, guest: string) {
    const result = this.storage.db.prepare("DELETE FROM itinerary WHERE id = ? AND guest_digest = ?").run(id, digest(guest));
    if (!result.changes) throw new InputError("This itinerary access link is invalid or the itinerary was removed.", 404);
  }
}
