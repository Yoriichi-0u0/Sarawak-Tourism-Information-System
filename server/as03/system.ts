import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";

import type { Plan, RecordKind, ReviewedPlan, TourismItem } from "../../src/as03/contracts.ts";
import { InputError, Itinerary, ItineraryEntry, object, planSettings, TourismRecord, validDate } from "./domain.ts";
import { seedCatalogue } from "./seed.ts";
import { digest, ItineraryRepository, Storage, TourismRepository } from "./storage.ts";

function token() {
  return randomBytes(32).toString("base64url");
}

function filterText(value: unknown): string {
  if (typeof value !== "string" || value.length > 200) throw new InputError("Enter shorter search criteria.");
  return value.trim().toLowerCase();
}

export class TourismCatalog {
  constructor(private readonly repository: TourismRepository) {}

  findDestinations(filters: { query?: unknown; location?: unknown; interest?: unknown } = {}) {
    const query = filterText(filters.query ?? "");
    const location = filterText(filters.location ?? "");
    const interest = filterText(filters.interest ?? "");
    return this.repository.searchPublished("destination").filter(({ fields }) =>
      fields.title.toLowerCase().includes(query) &&
      fields.location.toLowerCase().includes(location) &&
      fields.interest.toLowerCase().includes(interest),
    );
  }

  findEvents(filters: { query?: unknown; location?: unknown; date?: unknown } = {}) {
    const query = filterText(filters.query ?? "");
    const location = filterText(filters.location ?? "");
    const date = filters.date ?? "";
    if (date !== "" && !validDate(date)) throw new InputError("Enter a valid date.");
    const destinations = new Map(this.findDestinations().map((item) => [item.id, item.fields.location]));
    return this.repository.searchPublished("event").filter(({ fields }) =>
      fields.title.toLowerCase().includes(query) &&
      `${fields.venue} ${destinations.get(fields.destinationIds) ?? ""}`.toLowerCase().includes(location) &&
      (!date || fields.startsAt.slice(0, 10) === date),
    );
  }

  getPublishedRecord(id: string) {
    return this.repository.findPublished(id);
  }

  listPublished(kind: RecordKind) {
    return this.repository.searchPublished(kind);
  }

  getPublishedEvent(id: string) {
    const record = this.getPublishedRecord(id);
    return record?.kind === "event" ? record : undefined;
  }
}

export class ManagementAccessControl {
  constructor(private readonly storage: Storage, initialPassword?: string) {
    if (!initialPassword || storage.db.prepare("SELECT id FROM staff_account WHERE id = 'staff'").get()) return;
    if (initialPassword.length < 12 || initialPassword.length > 200)
      throw new Error("AS03_STAFF_PASSWORD must contain 12 to 200 characters.");
    const salt = randomBytes(16).toString("hex");
    const hash = scryptSync(initialPassword, salt, 64).toString("hex");
    storage.db.prepare("INSERT OR IGNORE INTO staff_account(id, salt, password_hash) VALUES ('staff', ?, ?)")
      .run(salt, hash);
  }

  login(password: unknown): string {
    const db = this.storage.db;
    const account = db.prepare("SELECT salt, password_hash FROM staff_account WHERE id = 'staff' AND active = 1")
      .get() as { salt: string; password_hash: string } | undefined;
    if (typeof password !== "string" || password.length > 200 || !account ||
        !timingSafeEqual(scryptSync(password, account.salt, 64), Buffer.from(account.password_hash, "hex")))
      throw new InputError("The staff password is incorrect or staff access has not been configured.", 401);
    const session = token();
    const now = Date.now();
    db.prepare("DELETE FROM staff_session WHERE expires_at <= ?").run(now);
    db.prepare("INSERT INTO staff_session VALUES (?, 'staff', ?)").run(digest(session), now + 30 * 60_000);
    return session;
  }

  permits(session?: string): boolean {
    if (!session) return false;
    return Boolean(this.storage.db.prepare(`
      SELECT 1 FROM staff_session s JOIN staff_account a ON a.id = s.staff_id
      WHERE s.token_digest = ? AND s.expires_at > ? AND a.active = 1
    `).get(digest(session), Date.now()));
  }

  check(session?: string) {
    if (!this.permits(session)) throw new InputError("Sign in with staff access to continue.", 401);
  }

  logout(session?: string) {
    if (session) this.storage.db.prepare("DELETE FROM staff_session WHERE token_digest = ?").run(digest(session));
  }
}

export class TourismInformationManager {
  constructor(private readonly repository: TourismRepository, private readonly access: ManagementAccessControl) {}

  listDrafts(session?: string) {
    this.access.check(session);
    return this.repository.listDrafts();
  }

  getDraft(session: string | undefined, id: string) {
    this.access.check(session);
    return this.repository.loadDraft(id);
  }

  saveDraft(session: string | undefined, id: string | null, kind: RecordKind, fields: unknown, expected: unknown) {
    this.access.check(session);
    if (id && (typeof expected !== "number" || !Number.isSafeInteger(expected) || expected < 1))
      throw new InputError("Reload the draft before saving.");
    return this.repository.saveDraft(id ?? randomUUID(), kind, TourismRecord.parse(kind, fields), id ? Number(expected) : null);
  }

  publish(session: string | undefined, id: string, expected: unknown) {
    this.access.check(session);
    const draft = this.repository.loadDraft(id);
    if (draft.version !== expected) throw new InputError("This draft changed. Reload it before publishing.", 409);
    const domain = TourismRecord.parse(draft.kind, draft.fields);
    const issues = domain.validateForPublication();
    if (Object.keys(issues).length) throw new InputError("Complete the required fields before publishing.", 422, issues);
    return this.repository.commitPublication(draft, domain.destinationIds);
  }

  withdraw(session: string | undefined, id: string) {
    this.access.check(session);
    return this.repository.withdraw(id);
  }
}

export class ItineraryCoordinator {
  constructor(private readonly repository: ItineraryRepository, private readonly catalog: TourismCatalog) {}

  createItinerary(settings: unknown) {
    const guest = token();
    const plan: Plan = { id: randomUUID(), ...planSettings(settings), revision: 1, entries: [] };
    this.repository.createForGuest(plan, guest);
    return { plan: this.review(plan), guest };
  }

  reviewItinerary(id: string, guest: string) {
    return this.review(this.repository.getForGuest(id, guest));
  }

  updateItinerary(id: string, guest: string, revision: unknown, edit: unknown) {
    const plan = this.repository.getForGuest(id, guest);
    if (plan.revision !== revision) throw new InputError("This itinerary changed. Reopen it before saving.", 409);
    const command = object(edit);
    const itinerary = new Itinerary(plan);
    switch (command.action) {
      case "add": {
        const record = typeof command.recordId === "string" && this.catalog.getPublishedRecord(command.recordId);
        if (!record) throw new InputError("This selection is unavailable.", 404);
        itinerary.addEntry(record, command.start, command.end);
        break;
      }
      case "update":
        itinerary.updateEntryTime(command.entryId, command.start, command.end);
        break;
      case "remove":
        itinerary.removeEntry(command.entryId);
        break;
      case "move":
        itinerary.moveEntry(command.entryId, command.position);
        break;
      case "date":
        itinerary.updateTravelDate(command);
        break;
      default:
        throw new InputError("Choose a valid itinerary edit.");
    }
    return this.review(this.repository.saveForGuest(plan, guest));
  }

  deleteItinerary(id: string, guest: string) {
    this.repository.deleteForGuest(id, guest);
  }

  private review(plan: Plan): ReviewedPlan {
    const recordCache = new Map<string, TourismItem | undefined>();
    const entries = plan.entries.map((entry) => {
      if (!recordCache.has(entry.recordId))
        recordCache.set(entry.recordId, this.catalog.getPublishedRecord(entry.recordId));
      const record = recordCache.get(entry.recordId);
      const location = entry.kind === "event" ? record?.fields.venue : record?.fields.location;
      const assessed = new ItineraryEntry(entry);
      return { ...entry, title: record?.fields.title ?? (entry.kind === "event" ? "Unavailable event" : "Unavailable destination"),
        location: location || undefined,
        notice: assessed.assessEvent(record),
        eventStartsAt: assessed.publishedStart(record),
        dateNotice: assessed.assessEventDate(record, plan.date) };
    });
    return { ...plan, entries, conflicts: new Itinerary(plan).detectConflicts() };
  }
}

export class Application {
  private readonly storage: Storage;
  readonly catalog: TourismCatalog;
  readonly manager: TourismInformationManager;
  readonly coordinator: ItineraryCoordinator;
  readonly access: ManagementAccessControl;

  constructor(databasePath: string, staffPassword?: string) {
    const storage = new Storage(databasePath);
    this.storage = storage;
    try {
      const records = new TourismRepository(storage);
      const itineraries = new ItineraryRepository(storage);
      this.access = new ManagementAccessControl(storage, staffPassword);
      this.catalog = new TourismCatalog(records);
      this.manager = new TourismInformationManager(records, this.access);
      this.coordinator = new ItineraryCoordinator(itineraries, this.catalog);
      seedCatalogue(storage, records);
    } catch (error) {
      storage.db.close();
      throw error;
    }
  }

  close() {
    this.storage.db.close();
  }
}
