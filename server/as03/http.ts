import { mkdirSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";

import { isRecordKind } from "../../src/as03/contracts.ts";
import { InputError, object } from "./domain.ts";
import { Application } from "./system.ts";

const prefix = "/api/as03/";
const staffCookie = "as03_staff";

async function readJson(request: IncomingMessage) {
  if (request.headers["content-type"]?.split(";")[0] !== "application/json")
    throw new InputError("Send a JSON request.", 415);
  const buffers: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > 32_768) throw new InputError("The request is too large.", 413);
    buffers.push(buffer);
  }
  try {
    return object(JSON.parse(Buffer.concat(buffers).toString("utf8")));
  } catch {
    throw new InputError("Enter a valid JSON request.");
  }
}

function send(response: ServerResponse, status: number, payload: unknown) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

function readStaff(request: IncomingMessage) {
  return request.headers.cookie?.match(/(?:^|;\s*)as03_staff=([\w-]{43})(?:;|$)/)?.[1];
}

function readGuest(request: IncomingMessage) {
  return request.headers.authorization?.match(/^Guest ([\w-]{43})$/)?.[1] ?? "";
}

function writeStaff(response: ServerResponse, token: string, age: number) {
  response.setHeader("Set-Cookie", `${staffCookie}=${token}; Path=${prefix}; Max-Age=${age}; HttpOnly; SameSite=Strict`);
}

export function startAS03(root: string) {
  const profile = process.env.AS03_DATA_PROFILE ?? "local";
  if (!/^[a-zA-Z0-9_-]{1,40}$/.test(profile)) throw new Error("Choose a valid AS03 data profile name.");
  const directory = join(root, ".as03-data");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const app = new Application(join(directory, `${profile}.sqlite`), process.env.AS03_STAFF_PASSWORD);
  let attempts = 0;
  let resetAt = 0;

  return {
    close: () => app.close(),
    middleware(request: IncomingMessage, response: ServerResponse, next: () => void) {
      if (!request.url?.startsWith(prefix)) return next();
      void (async () => {
        const host = request.headers.host;
        const remote = request.socket.remoteAddress;
        if (!host || !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ||
            (remote !== "127.0.0.1" && remote !== "::1" && remote !== "::ffff:127.0.0.1"))
          throw new InputError("The assessment app accepts local requests only.", 403);
        if (request.method !== "GET" && request.headers.origin && request.headers.origin !== `http://${host}`)
          throw new InputError("Open the assessment app to make changes.", 403);

        const url = new URL(request.url!, `http://${host}`);
        const path = url.pathname.slice(prefix.length);
        const filters = Object.fromEntries(url.searchParams);
        const method = request.method;
        const staff = readStaff(request);

        if (method === "GET" && path === "destinations") return send(response, 200, app.catalog.findDestinations(filters));
        if (method === "GET" && path === "events") return send(response, 200, app.catalog.findEvents(filters));
        if (method === "GET" && path === "records") {
          if (!isRecordKind(filters.kind)) throw new InputError("Choose a record category.");
          return send(response, 200, app.catalog.listPublished(filters.kind));
        }
        if (method === "GET" && path === "staff/session") return send(response, 200, { active: app.access.permits(staff) });
        if (method === "POST" && path === "staff/session") {
          const now = Date.now();
          if (now >= resetAt) { attempts = 0; resetAt = now + 60_000; }
          if (++attempts > 8) throw new InputError("Wait a minute before trying again.", 429);
          const body = await readJson(request);
          const session = app.access.login(body.password);
          app.access.logout(staff);
          attempts = 0;
          writeStaff(response, session, 1800);
          return send(response, 200, { active: true });
        }
        if (method === "DELETE" && path === "staff/session") {
          app.access.logout(staff);
          writeStaff(response, "", 0);
          return send(response, 200, { active: false });
        }
        if (method === "GET" && path === "staff/records") return send(response, 200, app.manager.listDrafts(staff));
        if (method === "POST" && path === "staff/records") {
          app.access.check(staff);
          const body = await readJson(request);
          if (!isRecordKind(body.kind)) throw new InputError("Choose a record category.");
          return send(response, 201, app.manager.saveDraft(staff, null, body.kind, body.fields, null));
        }

        const record = /^staff\/records\/([\w-]{1,100})(?:\/(publish|withdraw))?$/.exec(path);
        if (record) {
          const [, id, command] = record;
          app.access.check(staff);
          if (method === "PUT" && !command) {
            const body = await readJson(request);
            if (!isRecordKind(body.kind)) throw new InputError("Choose a record category.");
            return send(response, 200, app.manager.saveDraft(staff, id, body.kind, body.fields, body.version));
          }
          if (method === "POST" && command === "publish") {
            const body = await readJson(request);
            return send(response, 200, app.manager.publish(staff, id, body.version));
          }
          if (method === "POST" && command === "withdraw")
            return send(response, 200, app.manager.withdraw(staff, id));
        }

        if (method === "POST" && path === "itineraries")
          return send(response, 201, app.coordinator.createItinerary(await readJson(request)));
        const itinerary = /^itineraries\/([\w-]{1,100})$/.exec(path);
        if (itinerary) {
          const [, id] = itinerary;
          const guest = readGuest(request);
          if (method === "GET") return send(response, 200, app.coordinator.reviewItinerary(id, guest));
          if (method === "PUT") {
            const body = await readJson(request);
            return send(response, 200, app.coordinator.updateItinerary(id, guest, body.revision, body.change));
          }
          if (method === "DELETE") {
            app.coordinator.deleteItinerary(id, guest);
            return send(response, 200, { removed: true });
          }
        }
        throw new InputError("This operation is unavailable.", 404);
      })().catch((error: unknown) => {
        if (response.destroyed || response.headersSent) return;
        if (error instanceof InputError) return send(response, error.status, { message: error.message, issues: error.issues });
        console.error("AS03 request failed.");
        return send(response, 500, { message: "The system could not complete the request. Try again." });
      });
    },
  };
}
