import { randomUUID } from "node:crypto";

import type { Plan, RecordKind, ReviewedPlan, TourismItem } from "../src/as03/contracts.ts";

export { TourismCatalog };
import { AccountService, defaultHashCost, newToken, type Clock, type HashCost } from "./accounts.ts";
import { migrate, type Db } from "./db.ts";
import { TourismCatalog } from "./catalog.ts";
import { InputError, Itinerary, ItineraryEntry, object, planSettings, TourismRecord } from "./domain.ts";
import { syncContent } from "./content/sync.ts";
import { seedCatalogue } from "./seed.ts";
import { ItineraryRepository, TourismRepository, type PlanAccess } from "./repositories.ts";

export class ManagementAccessControl {
  constructor(private readonly accounts: AccountService) {}

  async check(session?: string) {
    const account = await this.accounts.resolve(session);
    if (!account) throw new InputError("Sign in with staff access to continue.", 401);
    if (account.role !== "staff" && account.role !== "admin")
      throw new InputError("Your account does not have staff access.", 403);
    return account;
  }

  async permits(session?: string) {
    const account = await this.accounts.resolve(session);
    return account?.role === "staff" || account?.role === "admin";
  }
}

export class TourismInformationManager {
  constructor(private readonly repository: TourismRepository, private readonly access: ManagementAccessControl) {}

  async listDrafts(session?: string) {
    await this.access.check(session);
    return this.repository.listDrafts();
  }

  async getDraft(session: string | undefined, id: string) {
    await this.access.check(session);
    return this.repository.loadDraft(id);
  }

  async history(session: string | undefined, id: string) {
    await this.access.check(session);
    return this.repository.history(id);
  }

  async saveDraft(session: string | undefined, id: string | null, kind: RecordKind, fields: unknown, expected: unknown) {
    const staff = await this.access.check(session);
    if (id && (typeof expected !== "number" || !Number.isSafeInteger(expected) || expected < 1))
      throw new InputError("Reload the draft before saving.");
    return this.repository.saveDraft(id ?? randomUUID(), kind, TourismRecord.parse(kind, fields), id ? Number(expected) : null, staff.id);
  }

  async publish(session: string | undefined, id: string, expected: unknown) {
    const staff = await this.access.check(session);
    const draft = await this.repository.loadDraft(id);
    if (draft.version !== expected) throw new InputError("This draft changed. Reload it before publishing.", 409);
    const domain = TourismRecord.parse(draft.kind, draft.fields);
    const issues = domain.validateForPublication();
    if (Object.keys(issues).length) throw new InputError("Complete the required fields before publishing.", 422, issues);
    return this.repository.commitPublication(draft, domain.destinationIds, staff.id);
  }

  async withdraw(session: string | undefined, id: string) {
    const staff = await this.access.check(session);
    return this.repository.withdraw(id, staff.id);
  }
}

function readTitle(value: unknown, fallback: string) {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !value.trim() || value.trim().length > 120)
    throw new InputError("Enter a trip name of up to 120 characters.");
  return value.trim();
}

export class ItineraryCoordinator {
  constructor(private readonly repository: ItineraryRepository, private readonly catalog: TourismCatalog, private readonly accounts: AccountService) {}

  async createItinerary(settings: unknown, session?: string) {
    const account = await this.accounts.resolve(session);
    const body = object(settings);
    const plan: Plan = { id: randomUUID(), title: readTitle(body.title, "My Sarawak trip"), ...planSettings(body), revision: 1, entries: [] };
    if (account) {
      await this.repository.create(plan, { accountId: account.id });
      return { plan: await this.review({ ...plan, owned: true }) };
    }
    const guest = newToken();
    await this.repository.create(plan, { guest });
    return { plan: await this.review({ ...plan, owned: false }), guest };
  }

  async listItineraries(session?: string) {
    const account = await this.accounts.require(session);
    return this.repository.listOwned(account.id);
  }

  async reviewItinerary(id: string, guest: string, session?: string) {
    return this.review(await this.repository.load(id, await this.access(guest, session)));
  }

  async updateItinerary(id: string, guest: string, revision: unknown, edit: unknown, session?: string) {
    const access = await this.access(guest, session);
    const plan = await this.repository.load(id, access);
    if (plan.revision !== revision) throw new InputError("This itinerary changed. Reopen it before saving.", 409);
    const command = object(edit);
    const itinerary = new Itinerary(plan);
    switch (command.action) {
      case "add": {
        const record = typeof command.recordId === "string" ? await this.catalog.getPublishedRecord(command.recordId) : undefined;
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
      case "rename":
        plan.title = readTitle(command.title ?? "", plan.title);
        break;
      default:
        throw new InputError("Choose a valid itinerary edit.");
    }
    return this.review(await this.repository.save(plan, access));
  }

  async deleteItinerary(id: string, guest: string, session?: string) {
    await this.repository.delete(id, await this.access(guest, session));
  }

  async claimItinerary(id: string, guest: string, session?: string) {
    const account = await this.accounts.require(session);
    if (!guest) throw new InputError("Open the guest link for the itinerary you want to keep.", 400);
    return this.review(await this.repository.claim(id, guest, account.id));
  }

  private async access(guest: string, session?: string): Promise<PlanAccess> {
    const account = await this.accounts.resolve(session);
    return { accountId: account?.id, guest: guest || undefined };
  }

  private async review(plan: Plan & { owned: boolean }): Promise<ReviewedPlan> {
    const records = new Map<string, TourismItem | undefined>();
    for (const { recordId } of plan.entries)
      if (!records.has(recordId)) records.set(recordId, await this.catalog.getPublishedRecord(recordId));
    const entries = plan.entries.map((entry) => {
      const record = records.get(entry.recordId);
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

export type ApplicationOptions = {
  db: Db;
  clock?: Clock;
  hashCost?: HashCost;
  admin?: { email: string; password: string; displayName?: string };
  seed?: boolean | "fixture" | "content";
  migrate?: boolean;
};

export class Application {
  readonly catalog: TourismCatalog;
  readonly manager: TourismInformationManager;
  readonly coordinator: ItineraryCoordinator;
  readonly access: ManagementAccessControl;
  readonly accounts: AccountService;
  readonly records: TourismRepository;

  private constructor(readonly db: Db, clock: Clock, cost: HashCost) {
    this.records = new TourismRepository(db);
    this.accounts = new AccountService(db, clock, cost);
    this.access = new ManagementAccessControl(this.accounts);
    this.catalog = new TourismCatalog(this.records);
    this.manager = new TourismInformationManager(this.records, this.access);
    this.coordinator = new ItineraryCoordinator(new ItineraryRepository(db), this.catalog, this.accounts);
  }

  static async open(options: ApplicationOptions) {
    const app = new Application(options.db, options.clock ?? (() => new Date()), options.hashCost ?? defaultHashCost);
    if (options.migrate !== false) await migrate(options.db);
    if (options.admin) await app.accounts.bootstrapAdmin(options.admin.email, options.admin.password, options.admin.displayName);
    if (options.seed === "content") {
      if (!(await app.db.query("select 1 from stis.tourism_record limit 1")).length) await syncContent(app.records);
    } else if (options.seed !== false) await seedCatalogue(app.db, app.records);
    return app;
  }

  close() {
    return this.db.close();
  }
}
