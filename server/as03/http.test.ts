import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, request as send, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { test, type TestContext } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

import { startAS03, type FailureLog } from "./http.ts";

const password = "synthetic-http-credential";
const json = "application/json";

type Reply = { status: number; headers: IncomingMessage["headers"]; text: string; body: any };
type Call = { method?: string; path: string; headers?: Record<string, string>; body?: string };

async function serve(t: TestContext, options: { log?: boolean } = {}) {
  mkdirSync("test-results", { recursive: true });
  const root = mkdtempSync("test-results/as03-http-");
  const saved = { profile: process.env.AS03_DATA_PROFILE, password: process.env.AS03_STAFF_PASSWORD };
  process.env.AS03_DATA_PROFILE = "http_test";
  process.env.AS03_STAFF_PASSWORD = password;
  const logs: FailureLog[] = [];
  const service = options.log === false ? startAS03(root) : startAS03(root, (entry) => logs.push(entry));
  const server = createServer((request, response) => service.middleware(request, response, () => {
    response.statusCode = 299;
    response.end("next");
  }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    service.close();
    for (const [key, value] of [["AS03_DATA_PROFILE", saved.profile], ["AS03_STAFF_PASSWORD", saved.password]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true });
  });
  const origin = `http://127.0.0.1:${port}`;
  const call = ({ method = "GET", path, headers = {}, body }: Call) => new Promise<Reply>((resolve, reject) => {
    const outgoing = send({ host: "127.0.0.1", port, method, path, headers: { host: `127.0.0.1:${port}`, ...headers } }, (incoming) => {
      let text = "";
      incoming.setEncoding("utf8");
      incoming.on("data", (chunk) => { text += chunk; });
      incoming.on("end", () => {
        let parsed: unknown;
        try { parsed = JSON.parse(text); } catch { parsed = undefined; }
        resolve({ status: incoming.statusCode ?? 0, headers: incoming.headers, text, body: parsed });
      });
    });
    outgoing.on("error", reject);
    outgoing.end(body);
  });
  const post = (path: string, payload: unknown, headers: Record<string, string> = {}) =>
    call({ method: "POST", path, body: JSON.stringify(payload), headers: { "content-type": json, ...headers } });
  const login = async () => {
    const reply = await post("/api/as03/staff/session", { password });
    assert.equal(reply.status, 200);
    const cookie = String(reply.headers["set-cookie"]?.[0]).split(";")[0];
    return { reply, cookie };
  };
  return { call, post, login, origin, port, logs, database: join(root, ".as03-data", "http_test.sqlite") };
}

test("requests outside the AS03 prefix pass to the next middleware", async (t) => {
  const { call } = await serve(t);
  const reply = await call({ path: "/index.html" });
  assert.equal(reply.status, 299);
});

test("only loopback host names are accepted", async (t) => {
  const { call, port } = await serve(t);
  for (const host of ["evil.example", `evil.example:${port}`, "127.0.0.1.evil.example", "localhost.evil.example"]) {
    const reply = await call({ path: "/api/as03/destinations", headers: { host } });
    assert.equal(reply.status, 403, host);
    assert.match(reply.body.message, /local requests only/);
  }
  for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, "localhost"]) {
    assert.equal((await call({ path: "/api/as03/destinations", headers: { host } })).status, 200, host);
  }
});

test("requests from a non-loopback socket are rejected", async () => {
  const service = { middleware: undefined as unknown as ReturnType<typeof startAS03>["middleware"] };
  mkdirSync("test-results", { recursive: true });
  const root = mkdtempSync("test-results/as03-http-");
  const saved = process.env.AS03_DATA_PROFILE;
  process.env.AS03_DATA_PROFILE = "http_remote";
  const logs: FailureLog[] = [];
  const started = startAS03(root, (entry) => logs.push(entry));
  service.middleware = started.middleware;
  try {
    const result = await new Promise<{ status: number; body: string }>((resolve) => {
      const request = {
        url: "/api/as03/destinations", method: "GET",
        headers: { host: "127.0.0.1:4183" }, socket: { remoteAddress: "192.0.2.10" },
      } as unknown as IncomingMessage;
      let status = 0;
      const response = {
        destroyed: false, headersSent: false,
        writeHead(code: number) { status = code; return this; },
        end(body: string) { resolve({ status, body }); },
      } as unknown as ServerResponse;
      service.middleware(request, response, () => resolve({ status: -1, body: "" }));
    });
    assert.equal(result.status, 403);
    assert.match(result.body, /local requests only/);
    assert.deepEqual(logs.map(({ method, route, status }) => ({ method, route, status })),
      [{ method: "GET", route: "/api/as03/destinations", status: 403 }]);
  } finally {
    started.close();
    if (saved === undefined) delete process.env.AS03_DATA_PROFILE;
    else process.env.AS03_DATA_PROFILE = saved;
    rmSync(root, { recursive: true });
  }
});

test("cross-origin writes are rejected while same-origin and origin-less writes are accepted", async (t) => {
  const { post, call, origin } = await serve(t);
  const settings = { date: "2026-11-27", provisional: true };
  for (const foreign of ["http://evil.example", "http://localhost:1", "null"]) {
    const reply = await post("/api/as03/itineraries", settings, { origin: foreign });
    assert.equal(reply.status, 403, foreign);
  }
  assert.equal((await post("/api/as03/itineraries", settings, { origin })).status, 201);
  assert.equal((await post("/api/as03/itineraries", settings)).status, 201);
  assert.equal((await call({ path: "/api/as03/destinations", headers: { origin: "http://evil.example" } })).status, 200);
});

test("write requests require a JSON object body", async (t) => {
  const { call } = await serve(t);
  const path = "/api/as03/itineraries";
  const valid = JSON.stringify({ date: "2026-11-27", provisional: true });
  assert.equal((await call({ method: "POST", path, body: valid })).status, 415);
  assert.equal((await call({ method: "POST", path, body: valid, headers: { "content-type": "text/plain" } })).status, 415);
  assert.equal((await call({ method: "POST", path, body: valid, headers: { "content-type": "application/json; charset=utf-8" } })).status, 201);
  for (const body of ["{", "[]", "null", "\"text\""]) {
    const reply = await call({ method: "POST", path, body, headers: { "content-type": json } });
    assert.equal(reply.status, 400, body);
  }
});

test("request bodies above 32 KiB are rejected", async (t) => {
  const { call } = await serve(t);
  const body = JSON.stringify({ date: "2026-11-27", provisional: true, padding: "x".repeat(33_000) });
  const reply = await call({ method: "POST", path: "/api/as03/itineraries", body, headers: { "content-type": json } });
  assert.equal(reply.status, 413);
  const accepted = JSON.stringify({ date: "2026-11-27", provisional: true, padding: "x".repeat(30_000) });
  assert.equal((await call({ method: "POST", path: "/api/as03/itineraries", body: accepted, headers: { "content-type": json } })).status, 201);
});

test("staff sign-in is limited to eight attempts per minute", async (t) => {
  const { post } = await serve(t);
  for (let attempt = 1; attempt <= 8; attempt += 1)
    assert.equal((await post("/api/as03/staff/session", { password: "incorrect-synthetic-guess" })).status, 401, `attempt ${attempt}`);
  const limited = await post("/api/as03/staff/session", { password: "incorrect-synthetic-guess" });
  assert.equal(limited.status, 429);
  assert.match(limited.body.message, /Wait a minute/);
  assert.equal((await post("/api/as03/staff/session", { password })).status, 429, "the limit is global (audit item D10)");
});

test("a successful sign-in resets the attempt counter", async (t) => {
  const { post, login } = await serve(t);
  for (let attempt = 1; attempt <= 7; attempt += 1)
    await post("/api/as03/staff/session", { password: "incorrect-synthetic-guess" });
  await login();
  for (let attempt = 1; attempt <= 8; attempt += 1)
    assert.equal((await post("/api/as03/staff/session", { password: "incorrect-synthetic-guess" })).status, 401);
});

test("the staff cookie is HttpOnly, SameSite=Strict, scoped to the API and cleared on sign-out", async (t) => {
  const { call, login } = await serve(t);
  const { reply, cookie } = await login();
  const header = String(reply.headers["set-cookie"]?.[0]);
  assert.match(cookie, /^as03_staff=[\w-]{43}$/);
  for (const attribute of ["Path=/api/as03/", "Max-Age=1800", "HttpOnly", "SameSite=Strict"])
    assert.ok(header.split("; ").includes(attribute), attribute);
  assert.doesNotMatch(header, /Domain=/i);
  assert.deepEqual((await call({ path: "/api/as03/staff/session", headers: { cookie } })).body, { active: true });
  const out = await call({ method: "DELETE", path: "/api/as03/staff/session", headers: { cookie } });
  assert.equal(out.status, 200);
  assert.match(String(out.headers["set-cookie"]?.[0]), /^as03_staff=; Path=\/api\/as03\/; Max-Age=0; HttpOnly; SameSite=Strict$/);
  assert.deepEqual((await call({ path: "/api/as03/staff/session", headers: { cookie } })).body, { active: false });
  assert.equal((await call({ path: "/api/as03/staff/records", headers: { cookie } })).status, 401);
});

test("staff routes reject missing and malformed sessions", async (t) => {
  const { call, post } = await serve(t);
  const fields = { title: "Synthetic" };
  const attempts: Call[] = [
    { path: "/api/as03/staff/records" },
    { method: "POST", path: "/api/as03/staff/records", body: JSON.stringify({ kind: "event", fields }) },
    { method: "PUT", path: "/api/as03/staff/records/sample-event", body: JSON.stringify({ kind: "event", fields, version: 1 }) },
    { method: "POST", path: "/api/as03/staff/records/sample-event/publish", body: JSON.stringify({ version: 1 }) },
    { method: "POST", path: "/api/as03/staff/records/sample-event/withdraw" },
  ];
  for (const cookie of [undefined, "as03_staff=short", `as03_staff=${"A".repeat(43)}`]) {
    for (const attempt of attempts) {
      const headers = { "content-type": json, ...(cookie ? { cookie } : {}) };
      const reply = await call({ ...attempt, headers });
      assert.equal(reply.status, 401, `${attempt.method ?? "GET"} ${attempt.path} ${cookie ?? "no cookie"}`);
    }
  }
  assert.equal((await call({ path: "/api/as03/events?query=showcase" })).body[0].fields.status, "scheduled");
  assert.equal((await post("/api/as03/staff/session", { password: 42 })).status, 401);
});

test("guest itineraries require the matching guest credential", async (t) => {
  const { call, post } = await serve(t);
  const created = await post("/api/as03/itineraries", { date: "2026-11-27", provisional: false });
  const { plan, guest } = created.body;
  const path = `/api/as03/itineraries/${plan.id}`;
  assert.match(guest, /^[\w-]{43}$/);
  for (const authorization of [undefined, `Guest ${"A".repeat(43)}`, `Bearer ${guest}`, `Guest ${guest}x`]) {
    const reply = await call({ path, headers: authorization ? { authorization } : {} });
    assert.equal(reply.status, 404, authorization ?? "no credential");
  }
  const opened = await call({ path, headers: { authorization: `Guest ${guest}` } });
  assert.equal(opened.status, 200);
  assert.equal(opened.body.id, plan.id);
  const stale = await call({
    method: "PUT", path, headers: { authorization: `Guest ${guest}`, "content-type": json },
    body: JSON.stringify({ revision: plan.revision + 1, change: { action: "date", date: "2026-11-28", provisional: false } }),
  });
  assert.equal(stale.status, 409);
  const removed = await call({ method: "DELETE", path, headers: { authorization: `Guest ${guest}` } });
  assert.deepEqual(removed.body, { removed: true });
  assert.equal((await call({ path, headers: { authorization: `Guest ${guest}` } })).status, 404);
});

test("API responses are JSON, uncached and not content-sniffed", async (t) => {
  const { call } = await serve(t);
  for (const path of ["/api/as03/destinations", "/api/as03/unknown", "/api/as03/records?kind=bogus"]) {
    const reply = await call({ path });
    assert.equal(reply.headers["content-type"], "application/json; charset=utf-8", path);
    assert.equal(reply.headers["cache-control"], "no-store", path);
    assert.equal(reply.headers["x-content-type-options"], "nosniff", path);
  }
  assert.equal((await call({ path: "/api/as03/unknown" })).status, 404);
  assert.equal((await call({ path: "/api/as03/records?kind=bogus" })).status, 400);
  assert.equal((await call({ path: "/api/as03/events?date=2026-02-30" })).status, 400);
  assert.equal((await call({ path: `/api/as03/destinations?query=${"x".repeat(201)}` })).status, 400);
});

test("failed staff operations are logged with method, normalized route, status and record id", async (t) => {
  const { call, post, login, logs } = await serve(t);
  await post("/api/as03/staff/records/sample-event/publish", { version: 1 });
  await post("/api/as03/staff/session", { password: "incorrect-synthetic-guess" });
  const { cookie } = await login();
  const headers = { cookie, "content-type": json };
  const draft = await call({ method: "PUT", path: "/api/as03/staff/records/sample-workshop", headers,
    body: JSON.stringify({ kind: "event", version: 1, fields: { title: "", venue: "", status: "scheduled", startsAt: "2026-11-28T14:00", destinationIds: "culture" } }) });
  assert.equal(draft.status, 200);
  await call({ method: "POST", path: "/api/as03/staff/records/sample-workshop/publish", headers, body: JSON.stringify({ version: 2 }) });
  await call({ method: "PUT", path: "/api/as03/staff/records/sample-workshop", headers,
    body: JSON.stringify({ kind: "event", version: 1, fields: { title: "Stale" } }) });
  await call({ method: "POST", path: "/api/as03/staff/records/culture/withdraw", headers });
  await call({ method: "POST", path: "/api/as03/staff/records/missing-record/withdraw", headers });
  const simplified = logs.map(({ time, ...rest }) => {
    assert.ok(!Number.isNaN(Date.parse(time)) && time.endsWith("Z"), time);
    return rest;
  });
  assert.deepEqual(simplified, [
    { event: "as03.request_failed", method: "POST", route: "/api/as03/staff/records/:id/publish", status: 401, recordId: "sample-event" },
    { event: "as03.request_failed", method: "POST", route: "/api/as03/staff/session", status: 401 },
    { event: "as03.request_failed", method: "POST", route: "/api/as03/staff/records/:id/publish", status: 422, recordId: "sample-workshop", fields: ["title", "venue"] },
    { event: "as03.request_failed", method: "PUT", route: "/api/as03/staff/records/:id", status: 409, recordId: "sample-workshop" },
    { event: "as03.request_failed", method: "POST", route: "/api/as03/staff/records/:id/withdraw", status: 409, recordId: "culture" },
    { event: "as03.request_failed", method: "POST", route: "/api/as03/staff/records/:id/withdraw", status: 404, recordId: "missing-record" },
  ]);
});

test("failure logs never contain credentials, guest access, request bodies, hosts or search text", async (t) => {
  const { call, post, logs } = await serve(t);
  const secret = "synthetic-secret-password-7f3a";
  const cookie = `as03_staff=${"S".repeat(43)}`;
  const guestToken = "G".repeat(43);
  const created = await post("/api/as03/itineraries", { date: "2026-11-27", provisional: true });
  const planId = created.body.plan.id as string;
  const realGuest = created.body.guest as string;
  await post("/api/as03/staff/session", { password: secret });
  await call({ path: "/api/as03/staff/records", headers: { cookie } });
  await call({ path: `/api/as03/itineraries/${planId}`, headers: { authorization: `Guest ${guestToken}` } });
  await call({ method: "PUT", path: `/api/as03/itineraries/${planId}`, headers: { authorization: `Guest ${realGuest}`, "content-type": json },
    body: JSON.stringify({ revision: 99, change: { action: "date", date: "2031-05-17", provisional: false, note: secret } }) });
  await call({ path: `/api/as03/destinations?query=${"private-search-text".padEnd(205, "x")}` });
  await call({ path: "/api/as03/destinations", headers: { host: "private-host.example" } });
  await call({ path: `/api/as03/${secret}/unknown?token=${secret}` });
  await post("/api/as03/itineraries", { date: "2026-11-27", provisional: true }, { origin: "http://private-origin.example" });
  assert.equal(logs.length, 8);
  const text = JSON.stringify(logs);
  for (const value of [secret, cookie, "S".repeat(43), guestToken, realGuest, planId, "private-search-text", "private-host.example", "private-origin.example", "2031-05-17"])
    assert.ok(!text.includes(value), `log contains ${value.slice(0, 24)}`);
  assert.deepEqual(logs.map(({ route, status }) => `${status} ${route}`), [
    "401 /api/as03/staff/session",
    "401 /api/as03/staff/records",
    "404 /api/as03/itineraries/:id",
    "409 /api/as03/itineraries/:id",
    "400 /api/as03/destinations",
    "403 /api/as03/destinations",
    "404 /api/as03/:unmatched",
    "403 /api/as03/itineraries",
  ]);
  const allowed = new Set(["event", "time", "method", "route", "status", "recordId", "fields", "code"]);
  for (const entry of logs) for (const key of Object.keys(entry)) assert.ok(allowed.has(key), key);
});

test("successful requests are not logged", async (t) => {
  const { call, post, login, logs } = await serve(t);
  await call({ path: "/api/as03/destinations?query=bako" });
  await post("/api/as03/itineraries", { date: "2026-11-27", provisional: true });
  const { cookie } = await login();
  await call({ path: "/api/as03/staff/records", headers: { cookie } });
  assert.deepEqual(logs, []);
});

test("server faults are logged with an error code but without the internal message", async (t) => {
  const { post, logs, database } = await serve(t);
  const fixture = new DatabaseSync(database);
  try {
    fixture.exec("CREATE TRIGGER fixture_fault BEFORE INSERT ON itinerary BEGIN SELECT RAISE(ABORT, 'internal fixture detail'); END;");
  } finally { fixture.close(); }
  const reply = await post("/api/as03/itineraries", { date: "2026-11-27", provisional: true });
  assert.equal(reply.status, 500);
  assert.deepEqual(reply.body, { message: "The system could not complete the request. Try again." });
  assert.equal(logs.length, 1);
  const { time: _time, ...entry } = logs[0];
  assert.deepEqual(entry, { event: "as03.request_failed", method: "POST", route: "/api/as03/itineraries", status: 500, code: "ERR_SQLITE_ERROR" });
  assert.ok(!JSON.stringify(logs).includes("internal fixture detail"));
});

test("the default logger writes one JSON line per failure to standard error", async (t) => {
  const lines: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => { lines.push(args); });
  const { call } = await serve(t, { log: false });
  await call({ path: "/api/as03/staff/records" });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].length, 1);
  const parsed = JSON.parse(String(lines[0][0]));
  assert.equal(parsed.event, "as03.request_failed");
  assert.equal(parsed.route, "/api/as03/staff/records");
  assert.equal(parsed.status, 401);
});
