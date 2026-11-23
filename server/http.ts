import { isRecordKind } from "../src/as03/contracts.ts";
import type { Account } from "../src/as03/contracts.ts";
import { toCalendar } from "./calendar.ts";
import { InputError, object } from "./domain.ts";
import type { Application } from "./services.ts";

export const prefix = "/api/v1/";
const sessionCookie = "stis_session";

export type FailureLog = {
  event: "stis.request_failed";
  time: string;
  method: string;
  route: string;
  status: number;
  recordId?: string;
  fields?: string[];
  code?: string;
};

export function writeFailure(entry: FailureLog) {
  console.error(JSON.stringify(entry));
}

const fixedRoutes = new Set([
  "auth/session", "auth/register", "auth/login", "auth/logout", "auth/recover",
  "account", "account/password", "account/recovery-codes", "account/delete",
  "staff/records", "admin/staff", "itineraries", "journeys", "places",
]);

export function describeRoute(path: string): { route: string; recordId?: string } {
  if (fixedRoutes.has(path)) return { route: `${prefix}${path}` };
  const catalog = /^catalog\/([a-z]{1,20})(\/[\w-]{1,100})?(\/related)?$/.exec(path);
  if (catalog && isRecordKind(catalog[1])) return { route: `${prefix}catalog/${catalog[1]}${catalog[2] ? "/:id" : ""}${catalog[3] ?? ""}` };
  const record = /^staff\/records\/([\w-]{1,100})(\/publish|\/withdraw|\/history)?$/.exec(path);
  if (record) return { route: `${prefix}staff/records/:id${record[2] ?? ""}`, recordId: record[1] };
  if (/^admin\/staff\/[\w-]{1,100}$/.test(path)) return { route: `${prefix}admin/staff/:id` };
  const plan = /^itineraries\/[\w-]{1,100}(\/claim|\/calendar)?$/.exec(path);
  if (plan) return { route: `${prefix}itineraries/:id${plan[1] ?? ""}` };
  return { route: `${prefix}:unmatched` };
}

function failure(method: string, path: string, status: number, error: unknown): FailureLog {
  const entry: FailureLog = {
    event: "stis.request_failed", time: new Date().toISOString(),
    method: /^[A-Z]{1,10}$/.test(method) ? method : "OTHER", ...describeRoute(path), status,
  };
  if (error instanceof InputError && error.issues) entry.fields = Object.keys(error.issues).sort();
  if (!(error instanceof InputError) && error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    entry.code = typeof code === "string" && /^[A-Z0-9_]{1,40}$/.test(code) ? code : error.name.replace(/[^\w]/g, "").slice(0, 40) || "Error";
  }
  return entry;
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json")
    throw new InputError("Send a JSON request.", 415);
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > 32_768) throw new InputError("The request is too large.", 413);
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  if (request.body) {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 32_768) { await reader.cancel(); throw new InputError("The request is too large.", 413); }
      chunks.push(value);
    }
  }
  try {
    return object(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch {
    throw new InputError("Enter a valid JSON request.");
  }
}

function json(status: number, payload: unknown, headers: Headers = new Headers()) {
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(JSON.stringify(payload), { status, headers });
}

function readSession(request: Request) {
  return request.headers.get("cookie")?.match(/(?:^|;\s*)stis_session=([\w-]{43})(?:;|$)/)?.[1];
}

function readGuest(request: Request) {
  return request.headers.get("authorization")?.match(/^Guest ([\w-]{43})$/)?.[1] ?? "";
}

const maxAge = (account: Account) => account.role === "tourist" ? 14 * 24 * 3600 : 1800;

function cookie(token: string, age: number, secure: boolean) {
  return `${sessionCookie}=${token}; Path=/api/; Max-Age=${age}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export type HandlerOptions = {
  log?: (entry: FailureLog) => void;
  allowedHosts?: string[];
};
export type RequestContext = { clientAddress?: string };

export function createHandler(app: Application, options: HandlerOptions = {}) {
  const log = options.log ?? writeFailure;
  const allowed = options.allowedHosts?.map((host) => host.toLowerCase());

  return async function handle(request: Request, context: RequestContext = {}): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : "";
    const method = request.method.toUpperCase();
    try {
      if (!url.pathname.startsWith(prefix)) throw new InputError("This operation is unavailable.", 404);
      const host = (request.headers.get("host") ?? url.host).toLowerCase();
      if (allowed && !allowed.some((entry) => host === entry || host.startsWith(`${entry}:`)))
        throw new InputError("This host is not allowed to use the service.", 403);
      const origin = request.headers.get("origin");
      const secure = url.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
      if (method !== "GET" && method !== "HEAD" && origin !== null && origin !== `${secure ? "https" : url.protocol.slice(0, -1)}://${host}`)
        throw new InputError("Open the application to make changes.", 403);

      const session = readSession(request);
      const filters = Object.fromEntries(url.searchParams);
      const client = { session, client: context.clientAddress };
      const signedIn = (result: { account: Account; session: string }, status = 200, extra: Record<string, unknown> = {}) =>
        json(status, { account: result.account, ...extra }, new Headers({ "Set-Cookie": cookie(result.session, maxAge(result.account), secure) }));
      const cleared = (payload: unknown) => json(200, payload, new Headers({ "Set-Cookie": cookie("", 0, secure) }));

      const catalog = /^catalog\/([a-z]{1,20})(?:\/([\w-]{1,100}))?(\/related)?$/.exec(path);
      if (method === "GET" && catalog) {
        const [, kind, id, related] = catalog;
        if (!isRecordKind(kind)) throw new InputError("Choose a record category.");
        if (id && related) return json(200, await app.catalog.related(kind, id));
        if (id) {
          const record = await app.catalog.getPublishedRecord(id);
          if (!record || record.kind !== kind) throw new InputError("This information is unavailable.", 404);
          return json(200, record);
        }
        if (related) throw new InputError("This operation is unavailable.", 404);
        return json(200, await app.catalog.search(kind, filters));
      }
      if (method === "GET" && path === "journeys") return json(200, await app.catalog.journeys(filters));
      if (method === "GET" && path === "places") return json(200, await app.catalog.places());

      if (method === "GET" && path === "auth/session") {
        const account = await app.accounts.resolve(session);
        return json(200, { account: account ?? null });
      }
      if (method === "POST" && path === "auth/register") {
        const result = await app.accounts.register(await readJson(request), client);
        return signedIn(result, 201, { recoveryCodes: result.recoveryCodes });
      }
      if (method === "POST" && path === "auth/login") return signedIn(await app.accounts.signIn(await readJson(request), client));
      if (method === "POST" && path === "auth/logout") {
        await app.accounts.signOut(session);
        return cleared({ account: null });
      }
      if (method === "POST" && path === "auth/recover") {
        const result = await app.accounts.recover(await readJson(request), client);
        return signedIn(result, 200, { recoveryCodesRemaining: result.recoveryCodesRemaining });
      }

      if (method === "GET" && path === "account") return json(200, await app.accounts.profile(session));
      if (method === "PATCH" && path === "account") return json(200, await app.accounts.updateProfile(session, await readJson(request)));
      if (method === "POST" && path === "account/password") {
        await app.accounts.changePassword(session, await readJson(request));
        return json(200, { changed: true });
      }
      if (method === "POST" && path === "account/recovery-codes")
        return json(200, { recoveryCodes: await app.accounts.regenerateRecoveryCodes(session, await readJson(request)) });
      if (method === "POST" && path === "account/delete") {
        await app.accounts.deleteAccount(session, await readJson(request));
        return cleared({ deleted: true });
      }

      if (method === "GET" && path === "staff/records") return json(200, await app.manager.listDrafts(session));
      if (method === "POST" && path === "staff/records") {
        await app.access.check(session);
        const body = await readJson(request);
        if (!isRecordKind(body.kind)) throw new InputError("Choose a record category.");
        return json(201, await app.manager.saveDraft(session, null, body.kind, body.fields, null));
      }
      const record = /^staff\/records\/([\w-]{1,100})(?:\/(publish|withdraw|history))?$/.exec(path);
      if (record) {
        const [, id, command] = record;
        await app.access.check(session);
        if (method === "GET" && !command) return json(200, await app.manager.getDraft(session, id));
        if (method === "GET" && command === "history") return json(200, await app.manager.history(session, id));
        if (method === "PUT" && !command) {
          const body = await readJson(request);
          if (!isRecordKind(body.kind)) throw new InputError("Choose a record category.");
          return json(200, await app.manager.saveDraft(session, id, body.kind, body.fields, body.version));
        }
        if (method === "POST" && command === "publish")
          return json(200, await app.manager.publish(session, id, (await readJson(request)).version));
        if (method === "POST" && command === "withdraw") return json(200, await app.manager.withdraw(session, id));
      }

      if (method === "GET" && path === "admin/staff") return json(200, await app.accounts.listStaff(session));
      if (method === "POST" && path === "admin/staff") return json(201, await app.accounts.createStaff(session, await readJson(request)));
      const staffAccount = /^admin\/staff\/([\w-]{1,100})$/.exec(path);
      if (method === "PATCH" && staffAccount)
        return json(200, await app.accounts.updateStaff(session, staffAccount[1], await readJson(request)));

      if (method === "GET" && path === "itineraries") return json(200, await app.coordinator.listItineraries(session));
      if (method === "POST" && path === "itineraries")
        return json(201, await app.coordinator.createItinerary(await readJson(request), session));
      const itinerary = /^itineraries\/([\w-]{1,100})(\/claim|\/calendar)?$/.exec(path);
      if (itinerary) {
        const [, id, command] = itinerary;
        const claim = command === "/claim";
        const guest = readGuest(request);
        if (method === "GET" && command === "/calendar") {
          const plan = await app.coordinator.reviewItinerary(id, guest, session);
          return new Response(toCalendar(plan), { status: 200, headers: {
            "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
            "Content-Disposition": `attachment; filename="sarawak-trip-${plan.date}.ics"`,
          } });
        }
        if (method === "POST" && claim) return json(200, await app.coordinator.claimItinerary(id, guest, session));
        if (method === "GET" && !command) return json(200, await app.coordinator.reviewItinerary(id, guest, session));
        if (method === "PUT" && !command) {
          const body = await readJson(request);
          return json(200, await app.coordinator.updateItinerary(id, guest, body.revision, body.change, session));
        }
        if (method === "DELETE" && !command) {
          await app.coordinator.deleteItinerary(id, guest, session);
          return json(200, { removed: true });
        }
      }
      throw new InputError("This operation is unavailable.", 404);
    } catch (error) {
      const status = error instanceof InputError ? error.status : 500;
      log(failure(method, path, status, error));
      if (error instanceof InputError) return json(status, { message: error.message, issues: error.issues });
      return json(500, { message: "The system could not complete the request. Try again." });
    }
  };
}
