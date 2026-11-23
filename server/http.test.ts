import assert from "node:assert/strict";
import { createServer, request as send } from "node:http";
import type { AddressInfo } from "node:net";
import { test, type TestContext } from "node:test";

import { createHandler, type FailureLog, type HandlerOptions } from "./http.ts";
import { nodeMiddleware, type Runtime } from "./runtime.ts";
import { Application } from "./services.ts";
import { freshDb } from "./testing.ts";

const password = "synthetic-http-credential";
const staffEmail = "staff@example.test";
const json = "application/json";
const origin = "http://127.0.0.1:4173";

type Reply = { status: number; headers: Headers; body: any; text: string };
type Call = { method?: string; path: string; headers?: Record<string, string>; body?: string; client?: string; base?: string };

async function serve(t: TestContext, options: Omit<HandlerOptions, "log"> & { log?: false } = {}) {
  const app = await Application.open({ db: await freshDb(t), hashCost: { N: 1024, r: 8, p: 1 }, admin: { email: staffEmail, password } });
  t.after(() => app.close());
  const logs: FailureLog[] = [];
  const handle = createHandler(app, { ...options, log: options.log === false ? undefined : (entry) => logs.push(entry) });
  const call = async ({ method = "GET", path, headers = {}, body, client = "203.0.113.5", base = origin }: Call): Promise<Reply> => {
    const response = await handle(new Request(`${base}${path}`, { method, headers: { host: new URL(base).host, ...headers }, body }), { clientAddress: client });
    const text = await response.text();
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { parsed = undefined; }
    return { status: response.status, headers: response.headers, body: parsed, text };
  };
  const post = (path: string, payload: unknown, headers: Record<string, string> = {}, extra: Partial<Call> = {}) =>
    call({ method: "POST", path, body: JSON.stringify(payload), headers: { "content-type": json, ...headers }, ...extra });
  const signIn = async (email = staffEmail, secret = password) => {
    const reply = await post("/api/v1/auth/login", { email, password: secret });
    assert.equal(reply.status, 200, reply.text);
    return { reply, cookie: String(reply.headers.getSetCookie()[0]).split(";")[0] };
  };
  const register = async (email: string) => {
    const reply = await post("/api/v1/auth/register", { email, displayName: "Synthetic Tourist", password: "synthetic-tourist-pass" });
    assert.equal(reply.status, 201, reply.text);
    return { reply, cookie: String(reply.headers.getSetCookie()[0]).split(";")[0] };
  };
  return { app, call, post, signIn, register, logs };
}

test("the Node middleware passes non-API requests on and forwards every Set-Cookie header", async (t) => {
  const app = await Application.open({ db: await freshDb(t), hashCost: { N: 1024, r: 8, p: 1 }, admin: { email: staffEmail, password } });
  t.after(() => app.close());
  const runtime: Runtime = { handle: createHandler(app, { log: () => {} }), close: async () => {} };
  const middleware = nodeMiddleware(Promise.resolve(runtime));
  const server = createServer((request, response) => middleware(request, response, () => { response.statusCode = 299; response.end("next"); }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address() as AddressInfo;
  const fetchRaw = (method: string, path: string, body?: string) => new Promise<{ status: number; cookies: string[]; text: string }>((resolve, reject) => {
    const outgoing = send({ host: "127.0.0.1", port, method, path, headers: body ? { "content-type": json } : {} }, (incoming) => {
      let text = "";
      incoming.setEncoding("utf8");
      incoming.on("data", (chunk) => { text += chunk; });
      incoming.on("end", () => resolve({ status: incoming.statusCode ?? 0, cookies: incoming.headers["set-cookie"] ?? [], text }));
    });
    outgoing.on("error", reject);
    outgoing.end(body);
  });
  assert.equal((await fetchRaw("GET", "/index.html")).status, 299);
  const login = await fetchRaw("POST", "/api/v1/auth/login", JSON.stringify({ email: staffEmail, password }));
  assert.equal(login.status, 200, login.text);
  assert.equal(login.cookies.length, 1);
  assert.match(login.cookies[0], /^stis_session=[\w-]{43}; /);
});

test("hosts outside a configured allow-list are rejected", async (t) => {
  const { call } = await serve(t, { allowedHosts: ["localhost", "127.0.0.1"] });
  for (const host of ["evil.example", "evil.example:4173", "127.0.0.1.evil.example", "localhost.evil.example"]) {
    const reply = await call({ path: "/api/v1/catalog/destination", headers: { host } });
    assert.equal(reply.status, 403, host);
  }
  for (const host of ["127.0.0.1:4173", "localhost:4173", "localhost"])
    assert.equal((await call({ path: "/api/v1/catalog/destination", headers: { host } })).status, 200, host);
});

test("cross-origin writes are rejected while same-origin and origin-less writes are accepted", async (t) => {
  const { post, call } = await serve(t);
  const settings = { date: "2026-11-27", provisional: true };
  for (const foreign of ["http://evil.example", "http://127.0.0.1:1", "https://127.0.0.1:4173", "null"])
    assert.equal((await post("/api/v1/itineraries", settings, { origin: foreign })).status, 403, foreign);
  assert.equal((await post("/api/v1/itineraries", settings, { origin })).status, 201);
  assert.equal((await post("/api/v1/itineraries", settings)).status, 201);
  assert.equal((await call({ path: "/api/v1/catalog/destination", headers: { origin: "http://evil.example" } })).status, 200);
});

test("write requests require a JSON object body", async (t) => {
  const { call } = await serve(t);
  const path = "/api/v1/itineraries";
  const valid = JSON.stringify({ date: "2026-11-27", provisional: true });
  assert.equal((await call({ method: "POST", path, body: valid })).status, 415);
  assert.equal((await call({ method: "POST", path, body: valid, headers: { "content-type": "text/plain" } })).status, 415);
  assert.equal((await call({ method: "POST", path, body: valid, headers: { "content-type": "application/json; charset=utf-8" } })).status, 201);
  for (const body of ["{", "[]", "null", "\"text\""])
    assert.equal((await call({ method: "POST", path, body, headers: { "content-type": json } })).status, 400, body);
});

test("request bodies above 32 KiB are rejected", async (t) => {
  const { call } = await serve(t);
  const body = JSON.stringify({ date: "2026-11-27", provisional: true, padding: "x".repeat(33_000) });
  assert.equal((await call({ method: "POST", path: "/api/v1/itineraries", body, headers: { "content-type": json } })).status, 413);
  const accepted = JSON.stringify({ date: "2026-11-27", provisional: true, padding: "x".repeat(30_000) });
  assert.equal((await call({ method: "POST", path: "/api/v1/itineraries", body: accepted, headers: { "content-type": json } })).status, 201);
});

test("sign-in throttling is per account and per client, so one attacked account does not lock out others (fixes D10)", async (t) => {
  const { post, register } = await serve(t);
  await register("tourist@example.test");
  for (let attempt = 1; attempt <= 8; attempt += 1)
    assert.equal((await post("/api/v1/auth/login", { email: staffEmail, password: "incorrect-synthetic-guess" })).status, 401, `attempt ${attempt}`);
  const limited = await post("/api/v1/auth/login", { email: staffEmail, password: "incorrect-synthetic-guess" });
  assert.equal(limited.status, 429);
  assert.match(limited.body.message, /Too many attempts/);
  assert.equal((await post("/api/v1/auth/login", { email: staffEmail, password })).status, 429, "the attacked account waits out the window");
  assert.equal((await post("/api/v1/auth/login", { email: "tourist@example.test", password: "synthetic-tourist-pass" })).status, 200,
    "another account on the same client still signs in");
  for (let attempt = 1; attempt <= 22; attempt += 1)
    await post("/api/v1/auth/login", { email: `nobody${attempt}@example.test`, password: "incorrect-synthetic-guess" });
  assert.equal((await post("/api/v1/auth/login", { email: "tourist@example.test", password: "synthetic-tourist-pass" })).status, 429,
    "thirty failures from one client block that client");
  assert.equal((await post("/api/v1/auth/login", { email: "tourist@example.test", password: "synthetic-tourist-pass" }, {}, { client: "198.51.100.7" })).status, 200,
    "other clients are unaffected");
});

test("a successful sign-in resets the account's attempt counter", async (t) => {
  const { post, signIn } = await serve(t);
  for (let attempt = 1; attempt <= 7; attempt += 1)
    await post("/api/v1/auth/login", { email: staffEmail, password: "incorrect-synthetic-guess" });
  await signIn();
  for (let attempt = 1; attempt <= 8; attempt += 1)
    assert.equal((await post("/api/v1/auth/login", { email: staffEmail, password: "incorrect-synthetic-guess" })).status, 401);
});

test("the session cookie is HttpOnly, SameSite=Lax, API-scoped, Secure over HTTPS and cleared on sign-out", async (t) => {
  const { call, post, signIn } = await serve(t);
  const { reply, cookie } = await signIn();
  const header = reply.headers.getSetCookie()[0];
  assert.match(cookie, /^stis_session=[\w-]{43}$/);
  for (const attribute of ["Path=/api/", "Max-Age=1800", "HttpOnly", "SameSite=Lax"])
    assert.ok(header.split("; ").includes(attribute), attribute);
  assert.doesNotMatch(header, /Domain=|Secure/i);
  const secure = await post("/api/v1/auth/login", { email: staffEmail, password }, {}, { base: "https://stis.example" });
  assert.ok(secure.headers.getSetCookie()[0].split("; ").includes("Secure"));
  assert.equal((await call({ path: "/api/v1/auth/session", headers: { cookie } })).body.account.role, "admin");
  const out = await call({ method: "POST", path: "/api/v1/auth/logout", headers: { cookie } });
  assert.equal(out.status, 200);
  assert.equal(out.headers.getSetCookie()[0], "stis_session=; Path=/api/; Max-Age=0; HttpOnly; SameSite=Lax");
  assert.deepEqual((await call({ path: "/api/v1/auth/session", headers: { cookie } })).body, { account: null });
  assert.equal((await call({ path: "/api/v1/staff/records", headers: { cookie } })).status, 401);
});

test("staff routes reject missing and malformed sessions with 401 and tourist sessions with 403", async (t) => {
  const { call, register } = await serve(t);
  const fields = { title: "Synthetic" };
  const attempts: Call[] = [
    { path: "/api/v1/staff/records" },
    { method: "POST", path: "/api/v1/staff/records", body: JSON.stringify({ kind: "event", fields }) },
    { method: "PUT", path: "/api/v1/staff/records/sample-event", body: JSON.stringify({ kind: "event", fields, version: 1 }) },
    { method: "POST", path: "/api/v1/staff/records/sample-event/publish", body: JSON.stringify({ version: 1 }) },
    { method: "POST", path: "/api/v1/staff/records/sample-event/withdraw" },
    { path: "/api/v1/staff/records/sample-event/history" },
  ];
  for (const cookie of [undefined, "stis_session=short", `stis_session=${"A".repeat(43)}`])
    for (const attempt of attempts) {
      const reply = await call({ ...attempt, headers: { "content-type": json, ...(cookie ? { cookie } : {}) } });
      assert.equal(reply.status, 401, `${attempt.method ?? "GET"} ${attempt.path} ${cookie ?? "no cookie"}`);
    }
  const { cookie } = await register("tourist@example.test");
  for (const attempt of attempts)
    assert.equal((await call({ ...attempt, headers: { "content-type": json, cookie } })).status, 403, `tourist ${attempt.path}`);
  assert.equal((await call({ path: "/api/v1/admin/staff", headers: { cookie } })).status, 403);
  assert.equal((await call({ path: "/api/v1/catalog/event?query=showcase" })).body[0].fields.status, "scheduled");
});

test("guest itineraries require the matching guest credential", async (t) => {
  const { call, post } = await serve(t);
  const created = await post("/api/v1/itineraries", { date: "2026-11-27", provisional: false });
  const { plan, guest } = created.body;
  const path = `/api/v1/itineraries/${plan.id}`;
  assert.match(guest, /^[\w-]{43}$/);
  for (const authorization of [undefined, `Guest ${"A".repeat(43)}`, `Bearer ${guest}`, `Guest ${guest}x`])
    assert.equal((await call({ path, headers: authorization ? { authorization } : {} })).status, 404, authorization ?? "no credential");
  const opened = await call({ path, headers: { authorization: `Guest ${guest}` } });
  assert.equal(opened.status, 200);
  assert.equal(opened.body.id, plan.id);
  const stale = await call({ method: "PUT", path, headers: { authorization: `Guest ${guest}`, "content-type": json },
    body: JSON.stringify({ revision: plan.revision + 1, change: { action: "date", date: "2026-11-28", provisional: false } }) });
  assert.equal(stale.status, 409);
  assert.deepEqual((await call({ method: "DELETE", path, headers: { authorization: `Guest ${guest}` } })).body, { removed: true });
  assert.equal((await call({ path, headers: { authorization: `Guest ${guest}` } })).status, 404);
});

test("API responses are JSON, uncached and not content-sniffed", async (t) => {
  const { call } = await serve(t);
  for (const path of ["/api/v1/catalog/destination", "/api/v1/unknown", "/api/v1/catalog/bogus", "/api/v1/catalog/destination/missing"]) {
    const reply = await call({ path });
    assert.equal(reply.headers.get("content-type"), "application/json; charset=utf-8", path);
    assert.equal(reply.headers.get("cache-control"), "no-store", path);
    assert.equal(reply.headers.get("x-content-type-options"), "nosniff", path);
  }
  assert.equal((await call({ path: "/api/v1/unknown" })).status, 404);
  assert.equal((await call({ path: "/api/v1/catalog/bogus" })).status, 400);
  assert.equal((await call({ path: "/api/v1/catalog/destination/missing" })).status, 404);
  assert.equal((await call({ path: "/api/v1/catalog/event/bako" })).status, 404, "a record is found only under its own category");
  assert.equal((await call({ path: "/api/v1/catalog/destination/bako" })).body.fields.title, "Bako National Park");
  assert.equal((await call({ path: "/api/v1/catalog/event?date=2026-02-30" })).status, 400);
  assert.equal((await call({ path: `/api/v1/catalog/destination?query=${"x".repeat(201)}` })).status, 400);
});

test("failed staff operations are logged with method, normalized route, status and record id", async (t) => {
  const { call, post, signIn, logs } = await serve(t);
  await post("/api/v1/staff/records/sample-event/publish", { version: 1 });
  await post("/api/v1/auth/login", { email: staffEmail, password: "incorrect-synthetic-guess" });
  const { cookie } = await signIn();
  const headers = { cookie, "content-type": json };
  const draft = await call({ method: "PUT", path: "/api/v1/staff/records/sample-workshop", headers,
    body: JSON.stringify({ kind: "event", version: 1, fields: { title: "", venue: "", status: "scheduled", startsAt: "2026-11-28T14:00", destinationIds: "culture" } }) });
  assert.equal(draft.status, 200);
  await call({ method: "POST", path: "/api/v1/staff/records/sample-workshop/publish", headers, body: JSON.stringify({ version: 2 }) });
  await call({ method: "PUT", path: "/api/v1/staff/records/sample-workshop", headers, body: JSON.stringify({ kind: "event", version: 1, fields: { title: "Stale" } }) });
  await call({ method: "POST", path: "/api/v1/staff/records/culture/withdraw", headers });
  await call({ method: "POST", path: "/api/v1/staff/records/missing-record/withdraw", headers });
  const simplified = logs.map(({ time, ...rest }) => {
    assert.ok(!Number.isNaN(Date.parse(time)) && time.endsWith("Z"), time);
    return rest;
  });
  assert.deepEqual(simplified, [
    { event: "stis.request_failed", method: "POST", route: "/api/v1/staff/records/:id/publish", status: 401, recordId: "sample-event" },
    { event: "stis.request_failed", method: "POST", route: "/api/v1/auth/login", status: 401 },
    { event: "stis.request_failed", method: "POST", route: "/api/v1/staff/records/:id/publish", status: 422, recordId: "sample-workshop", fields: ["title", "venue"] },
    { event: "stis.request_failed", method: "PUT", route: "/api/v1/staff/records/:id", status: 409, recordId: "sample-workshop" },
    { event: "stis.request_failed", method: "POST", route: "/api/v1/staff/records/:id/withdraw", status: 409, recordId: "culture" },
    { event: "stis.request_failed", method: "POST", route: "/api/v1/staff/records/:id/withdraw", status: 404, recordId: "missing-record" },
  ]);
});

test("failure logs never contain credentials, recovery codes, guest access, request bodies, hosts or search text", async (t) => {
  const { app, call, post, logs } = await serve(t, { allowedHosts: ["127.0.0.1"] });
  const secret = "synthetic-secret-password-7f3a";
  const cookie = `stis_session=${"S".repeat(43)}`;
  const guestToken = "G".repeat(43);
  const recoveryCode = "abcd-efgh-jkmn-pqrs";
  const created = await post("/api/v1/itineraries", { date: "2026-11-27", provisional: true });
  const planId = created.body.plan.id as string;
  const realGuest = created.body.guest as string;
  await post("/api/v1/auth/login", { email: "private-person@example.test", password: secret });
  await post("/api/v1/auth/recover", { email: "private-person@example.test", code: recoveryCode, newPassword: `${secret}-next` });
  await post("/api/v1/auth/register", { email: "bad-address", displayName: "Private Person", password: secret });
  await call({ path: "/api/v1/staff/records", headers: { cookie } });
  await call({ path: `/api/v1/itineraries/${planId}`, headers: { authorization: `Guest ${guestToken}` } });
  await call({ method: "PUT", path: `/api/v1/itineraries/${planId}`, headers: { authorization: `Guest ${realGuest}`, "content-type": json },
    body: JSON.stringify({ revision: 99, change: { action: "date", date: "2031-05-17", provisional: false, note: secret } }) });
  await call({ path: `/api/v1/catalog/destination?query=${"private-search-text".padEnd(205, "x")}` });
  await call({ path: "/api/v1/catalog/destination", headers: { host: "private-host.example" } });
  await call({ path: `/api/v1/${secret}/unknown?token=${secret}` });
  await post("/api/v1/itineraries", { date: "2026-11-27", provisional: true }, { origin: "http://private-origin.example" });
  assert.equal(logs.length, 10);
  const text = JSON.stringify(logs);
  for (const value of [secret, cookie, "S".repeat(43), guestToken, realGuest, planId, recoveryCode, "private-person", "Private Person",
    "private-search-text", "private-host.example", "private-origin.example", "2031-05-17"])
    assert.ok(!text.includes(value), `log contains ${value.slice(0, 24)}`);
  assert.deepEqual(logs.map(({ route, status }) => `${status} ${route}`), [
    "401 /api/v1/auth/login",
    "400 /api/v1/auth/recover",
    "400 /api/v1/auth/register",
    "401 /api/v1/staff/records",
    "404 /api/v1/itineraries/:id",
    "409 /api/v1/itineraries/:id",
    "400 /api/v1/catalog/destination",
    "403 /api/v1/catalog/destination",
    "404 /api/v1/:unmatched",
    "403 /api/v1/itineraries",
  ]);
  const allowed = new Set(["event", "time", "method", "route", "status", "recordId", "fields", "code"]);
  for (const entry of logs) for (const key of Object.keys(entry)) assert.ok(allowed.has(key), key);
  const stored = JSON.stringify(await app.db.query("select * from stis.auth_throttle"));
  assert.ok(!stored.includes("private-person") && !stored.includes("203.0.113.5"), "throttle keys are digests, not emails or addresses");
});

test("successful requests are not logged", async (t) => {
  const { call, post, signIn, logs } = await serve(t);
  await call({ path: "/api/v1/catalog/destination?query=bako" });
  await post("/api/v1/itineraries", { date: "2026-11-27", provisional: true });
  const { cookie } = await signIn();
  await call({ path: "/api/v1/staff/records", headers: { cookie } });
  assert.deepEqual(logs, []);
});

test("server faults are logged with an error code but without the internal message", async (t) => {
  const { app, post, logs } = await serve(t);
  await app.db.exec(`create function stis.fixture_fault() returns trigger language plpgsql as $$ begin raise exception 'internal fixture detail'; end $$;
    create trigger fixture_fault before insert on stis.itinerary for each row execute function stis.fixture_fault();`);
  const reply = await post("/api/v1/itineraries", { date: "2026-11-27", provisional: true });
  assert.equal(reply.status, 500);
  assert.deepEqual(reply.body, { message: "The system could not complete the request. Try again." });
  assert.equal(logs.length, 1);
  const { time: _time, ...entry } = logs[0];
  assert.deepEqual(entry, { event: "stis.request_failed", method: "POST", route: "/api/v1/itineraries", status: 500, code: "P0001" });
  assert.ok(!JSON.stringify(logs).includes("internal fixture detail"));
});

test("the default logger writes one JSON line per failure to standard error", async (t) => {
  const lines: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => { lines.push(args); });
  const { call } = await serve(t, { log: false });
  await call({ path: "/api/v1/staff/records" });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].length, 1);
  const parsed = JSON.parse(String(lines[0][0]));
  assert.equal(parsed.event, "stis.request_failed");
  assert.equal(parsed.route, "/api/v1/staff/records");
  assert.equal(parsed.status, 401);
});

test("withdrawal and category errors use distinct HTTP statuses", async (t) => {
  const { call, signIn, logs } = await serve(t);
  const { cookie } = await signIn();
  const headers = { cookie, "content-type": json };
  const created = await call({ method: "POST", path: "/api/v1/staff/records", headers, body: JSON.stringify({ kind: "dining", fields: { title: "Synthetic HTTP cafe" } }) });
  assert.equal(created.status, 201);
  const id = created.body.id as string;
  const unpublished = await call({ method: "POST", path: `/api/v1/staff/records/${id}/withdraw`, headers });
  assert.equal(unpublished.status, 409);
  assert.match(unpublished.body.message, /not published/);
  assert.equal((await call({ method: "POST", path: "/api/v1/staff/records/missing-record/withdraw", headers })).status, 404);
  const category = await call({ method: "PUT", path: `/api/v1/staff/records/${id}`, headers, body: JSON.stringify({ kind: "event", version: 1, fields: { title: "Synthetic HTTP cafe" } }) });
  assert.equal(category.status, 422);
  assert.match(category.body.message, /category/);
  assert.equal((await call({ method: "PUT", path: `/api/v1/staff/records/${id}`, headers, body: JSON.stringify({ kind: "dining", version: 9, fields: { title: "Synthetic HTTP cafe" } }) })).status, 409);
  const withdrawn = await call({ method: "POST", path: "/api/v1/staff/records/sample-dining/withdraw", headers });
  assert.equal(withdrawn.status, 200);
  assert.equal(withdrawn.body.publishedVersion, null);
  assert.equal((await call({ method: "POST", path: "/api/v1/staff/records/sample-dining/withdraw", headers })).status, 409);
  const history = await call({ path: "/api/v1/staff/records/sample-dining/history", headers: { cookie } });
  assert.deepEqual(history.body.map(({ action, version }: { action: string; version: number }) => `${action}:${version}`), ["withdraw:1", "publish:1", "create:1"]);
  assert.deepEqual(logs.map(({ route, status, recordId }) => `${status} ${route} ${recordId}`), [
    `409 /api/v1/staff/records/:id/withdraw ${id}`,
    "404 /api/v1/staff/records/:id/withdraw missing-record",
    `422 /api/v1/staff/records/:id ${id}`,
    `409 /api/v1/staff/records/:id ${id}`,
    "409 /api/v1/staff/records/:id/withdraw sample-dining",
  ]);
});
