import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";

import { hashPassword, newRecoveryCode, normalizeRecoveryCode, verifyPassword } from "./accounts.ts";
import { InputError } from "./domain.ts";
import { digest } from "./repositories.ts";
import { Application } from "./services.ts";
import { freshDb } from "./testing.ts";

const cost = { N: 1024, r: 8, p: 1 };
const adminEmail = "admin@example.test";
const adminPassword = "synthetic-admin-credential";
const tourist = { email: "Tourist@Example.test ", displayName: "  Ana   Tourist ", password: "synthetic-tourist-pass" };

async function open(t: TestContext, clock?: () => Date) {
  const app = await Application.open({ db: await freshDb(t), hashCost: cost, clock, admin: { email: adminEmail, password: adminPassword } });
  t.after(() => app.close());
  return app;
}

const status = (code: number, pattern?: RegExp) => (error: unknown) =>
  error instanceof InputError && error.status === code && (!pattern || pattern.test(error.message));

test("passwords are stored as salted scrypt hashes that record their parameters", async () => {
  const stored = await hashPassword("synthetic-pass-1", cost);
  assert.match(stored, /^scrypt\$1024\$8\$1\$[\w-]{22}\$[\w-]{43}$/);
  assert.notEqual(stored, await hashPassword("synthetic-pass-1", cost), "a fresh salt each time");
  assert.equal(await verifyPassword("synthetic-pass-1", stored), true);
  assert.equal(await verifyPassword("synthetic-pass-2", stored), false);
  assert.equal(await verifyPassword("synthetic-pass-1", "plain-text"), false);
});

test("recovery codes carry 80 bits and tolerate case, spacing and look-alike characters", () => {
  const code = newRecoveryCode();
  assert.match(code, /^[0-9a-hjkmnp-tv-z]{4}(-[0-9a-hjkmnp-tv-z]{4}){3}$/);
  assert.equal(new Set(Array.from({ length: 200 }, newRecoveryCode)).size, 200);
  assert.equal(normalizeRecoveryCode(" AB0O-1IL1-uv22-3333 "), "ab001111vv223333");
});

test("a tourist registers, receives ten single-use recovery codes and is signed in", async (t) => {
  const app = await open(t);
  const registered = await app.accounts.register(tourist);
  assert.deepEqual([registered.account.email, registered.account.displayName, registered.account.role], ["tourist@example.test", "Ana Tourist", "tourist"]);
  assert.equal(registered.recoveryCodes.length, 10);
  assert.equal(new Set(registered.recoveryCodes).size, 10);
  assert.equal((await app.accounts.resolve(registered.session))?.id, registered.account.id);
  assert.equal((await app.accounts.profile(registered.session)).recoveryCodesRemaining, 10);
  const stored = JSON.stringify(await app.db.query("select * from stis.account a join stis.recovery_code c on c.account_id = a.id"));
  for (const code of registered.recoveryCodes) assert.ok(!stored.includes(code), "codes are stored only as digests");
  assert.ok(!stored.includes(tourist.password));
  const [{ count }] = await app.db.query<{ count: number }>("select count(*)::int as count from stis.account_session where token_digest = $1", [digest(registered.session)]);
  assert.equal(count, 1, "the session token is stored only as a digest");
  await assert.rejects(app.accounts.register(tourist), status(409, /already exists/));
});

test("registration validates email, name and password", async (t) => {
  const app = await open(t);
  for (const [input, field] of [
    [{ ...tourist, email: "not-an-email" }, "email"],
    [{ ...tourist, email: `${"x".repeat(250)}@example.test` }, "email"],
    [{ ...tourist, displayName: " " }, "displayName"],
    [{ ...tourist, displayName: "x".repeat(61) }, "displayName"],
    [{ ...tourist, password: "short" }, "password"],
    [{ ...tourist, password: "x".repeat(201) }, "password"],
    [{ ...tourist, email: "same@example.test", password: "same@example.test" }, "password"],
  ] as const) {
    await assert.rejects(app.accounts.register(input), (error) => error instanceof InputError && error.status === 400 && Boolean(error.issues?.[field]), field);
  }
});

test("sign-in gives one message for unknown accounts and wrong passwords, and replaces the previous session", async (t) => {
  const app = await open(t);
  const { session: first } = await app.accounts.register(tourist);
  const unknown = await app.accounts.signIn({ email: "nobody@example.test", password: tourist.password }).catch((error) => error);
  const wrong = await app.accounts.signIn({ email: tourist.email, password: "incorrect-guess-1" }).catch((error) => error);
  assert.equal(unknown.message, wrong.message);
  assert.equal(unknown.status, 401);
  const { session: second } = await app.accounts.signIn({ email: "  TOURIST@example.test", password: tourist.password }, { session: first });
  assert.equal(await app.accounts.resolve(first), undefined, "signing in again ends the earlier session in this browser");
  assert.ok(await app.accounts.resolve(second));
});

test("a recovery code resets the password once, ends every session and signs the tourist in", async (t) => {
  const app = await open(t);
  const { session, recoveryCodes } = await app.accounts.register(tourist);
  const other = (await app.accounts.signIn({ email: tourist.email, password: tourist.password })).session;
  await assert.rejects(app.accounts.recover({ email: tourist.email, code: "0000-0000-0000-0000", newPassword: "synthetic-new-pass" }), status(400, /incorrect/));
  const recovered = await app.accounts.recover({ email: tourist.email, code: recoveryCodes[3].toUpperCase().replace(/-/g, " "), newPassword: "synthetic-new-pass" });
  assert.equal(recovered.recoveryCodesRemaining, 9);
  assert.equal(await app.accounts.resolve(session), undefined);
  assert.equal(await app.accounts.resolve(other), undefined);
  assert.ok(await app.accounts.resolve(recovered.session));
  await assert.rejects(app.accounts.recover({ email: tourist.email, code: recoveryCodes[3], newPassword: "synthetic-third-pass" }), status(400), "codes are single-use");
  await assert.rejects(app.accounts.signIn({ email: tourist.email, password: tourist.password }), status(401));
  assert.ok(await app.accounts.signIn({ email: tourist.email, password: "synthetic-new-pass" }));
  await assert.rejects(app.accounts.recover({ email: tourist.email, code: recoveryCodes[4], newPassword: "short" }), status(400, /10 to 200/));
});

test("recovery attempts are throttled per email", async (t) => {
  const app = await open(t);
  const { recoveryCodes } = await app.accounts.register(tourist);
  for (let attempt = 0; attempt < 5; attempt += 1)
    await assert.rejects(app.accounts.recover({ email: tourist.email, code: "zzzz-zzzz-zzzz-zzzz", newPassword: "synthetic-new-pass" }), status(400));
  await assert.rejects(app.accounts.recover({ email: tourist.email, code: recoveryCodes[0], newPassword: "synthetic-new-pass" }), status(429));
});

test("profile, password change, code regeneration and account deletion require the right credentials", async (t) => {
  const app = await open(t);
  const { session, account } = await app.accounts.register(tourist);
  const elsewhere = (await app.accounts.signIn({ email: tourist.email, password: tourist.password })).session;
  assert.equal((await app.accounts.updateProfile(session, { displayName: "Ana T." })).displayName, "Ana T.");
  await assert.rejects(app.accounts.changePassword(session, { currentPassword: "incorrect-guess-1", newPassword: "synthetic-next-pass" }), status(401));
  await app.accounts.changePassword(session, { currentPassword: tourist.password, newPassword: "synthetic-next-pass" });
  assert.ok(await app.accounts.resolve(session), "the current session stays");
  assert.equal(await app.accounts.resolve(elsewhere), undefined, "other sessions end");
  await assert.rejects(app.accounts.regenerateRecoveryCodes(session, { password: tourist.password }), status(401));
  const codes = await app.accounts.regenerateRecoveryCodes(session, { password: "synthetic-next-pass" });
  assert.equal(codes.length, 10);
  const { plan } = await app.coordinator.createItinerary({ date: "2026-11-27", provisional: true, title: "Owned trip" }, session);
  assert.equal(plan.owned, true);
  await assert.rejects(app.accounts.deleteAccount(session, { password: "incorrect-guess-1" }), status(401));
  await app.accounts.deleteAccount(session, { password: "synthetic-next-pass" });
  assert.equal(await app.accounts.resolve(session), undefined);
  const leftovers = await app.db.query("select 1 from stis.itinerary where owner_id = $1 union all select 1 from stis.recovery_code where account_id = $1", [account.id]);
  assert.deepEqual(leftovers, [], "personal data and owned plans are removed with the account");
});

test("tourist sessions last fourteen idle days, sliding with use", async (t) => {
  let now = Date.parse("2026-11-01T00:00:00Z");
  const app = await open(t, () => new Date(now));
  const { session } = await app.accounts.register(tourist);
  now += 13 * 24 * 3600_000;
  assert.ok(await app.accounts.resolve(session));
  now += 13 * 24 * 3600_000;
  assert.ok(await app.accounts.resolve(session), "use within the window extends it");
  now += 15 * 24 * 3600_000;
  assert.equal(await app.accounts.resolve(session), undefined);
});

test("a signed-in tourist owns new plans, lists them, and can claim a guest plan which revokes the guest link", async (t) => {
  const app = await open(t);
  const guestPlan = await app.coordinator.createItinerary({ date: "2026-11-27", provisional: true });
  assert.ok(guestPlan.guest);
  const added = await app.coordinator.updateItinerary(guestPlan.plan.id, guestPlan.guest, 1, { action: "add", recordId: "bako", start: "09:00", end: "10:00" });
  const { session } = await app.accounts.register(tourist);
  const owned = await app.coordinator.createItinerary({ date: "2026-12-01", provisional: false, title: "Kuching weekend" }, session);
  assert.equal(owned.guest, undefined);
  await assert.rejects(app.coordinator.claimItinerary(guestPlan.plan.id, "A".repeat(43), session), status(404));
  await assert.rejects(app.coordinator.claimItinerary(guestPlan.plan.id, guestPlan.guest, undefined), status(401));
  const claimed = await app.coordinator.claimItinerary(guestPlan.plan.id, guestPlan.guest, session);
  assert.equal(claimed.owned, true);
  assert.deepEqual(claimed.entries.map(({ recordId, start }) => `${recordId}@${start}`), ["bako@09:00"]);
  assert.equal(claimed.revision, added.revision + 1);
  await assert.rejects(app.coordinator.reviewItinerary(guestPlan.plan.id, guestPlan.guest), status(404), "the guest link no longer opens it");
  assert.ok(await app.coordinator.reviewItinerary(guestPlan.plan.id, "", session));
  const list = await app.coordinator.listItineraries(session);
  assert.deepEqual(list.map(({ title, entryCount }) => `${title}:${entryCount}`).sort(), ["Kuching weekend:0", "My Sarawak trip:1"]);
  await assert.rejects(app.coordinator.listItineraries(undefined), status(401));
  const renamed = await app.coordinator.updateItinerary(owned.plan.id, "", owned.plan.revision, { action: "rename", title: "  Kuching long weekend " }, session);
  assert.equal(renamed.title, "Kuching long weekend");
  const intruder = (await app.accounts.register({ ...tourist, email: "other@example.test" })).session;
  await assert.rejects(app.coordinator.reviewItinerary(owned.plan.id, "", intruder), status(404), "another account cannot open it");
  await assert.rejects(app.coordinator.deleteItinerary(owned.plan.id, "", intruder), status(404));
});

test("administrators manage staff accounts; staff cannot, and admins cannot lock themselves out", async (t) => {
  const app = await open(t);
  const admin = (await app.accounts.signIn({ email: adminEmail, password: adminPassword })).session;
  const created = await app.accounts.createStaff(admin, { email: "editor@example.test", displayName: "Synthetic Editor", role: "staff", password: "synthetic-editor-pass" });
  assert.deepEqual([created.role, created.status], ["staff", "active"]);
  await assert.rejects(app.accounts.createStaff(admin, { email: "editor@example.test", displayName: "Dup", role: "staff", password: "synthetic-editor-pass" }), status(409));
  await assert.rejects(app.accounts.createStaff(admin, { email: "x@example.test", displayName: "X", role: "tourist", password: "synthetic-editor-pass" }), status(400));
  const editor = (await app.accounts.signIn({ email: "editor@example.test", password: "synthetic-editor-pass" })).session;
  assert.equal(await app.access.permits(editor), true);
  await assert.rejects(app.accounts.listStaff(editor), status(403));
  await assert.rejects(app.accounts.updateStaff(admin, (await app.accounts.resolve(admin))!.id, { role: "staff" }), status(409));
  const touristSession = (await app.accounts.register(tourist)).session;
  await assert.rejects(app.accounts.listStaff(touristSession), status(403));
  await assert.rejects(app.accounts.updateStaff(admin, (await app.accounts.resolve(touristSession))!.id, { role: "admin" }), status(404), "tourists are not promoted here");
  const disabled = await app.accounts.updateStaff(admin, created.id, { status: "disabled" });
  assert.equal(disabled.status, "disabled");
  assert.equal(await app.access.permits(editor), false, "disabling ends the session");
  await assert.rejects(app.accounts.signIn({ email: "editor@example.test", password: "synthetic-editor-pass" }), status(401));
  await assert.rejects(app.accounts.deleteAccount(admin, { password: adminPassword }), status(409, /last administrator/));
  const list = await app.accounts.listStaff(admin);
  assert.deepEqual(list.map(({ email, role, status: state }) => `${email}:${role}:${state}`), ["admin@example.test:admin:active", "editor@example.test:staff:disabled"]);
});

test("record history names the staff member for each change", async (t) => {
  const app = await open(t);
  const admin = (await app.accounts.signIn({ email: adminEmail, password: adminPassword })).session;
  const draft = await app.manager.getDraft(admin, "sample-event");
  const saved = await app.manager.saveDraft(admin, draft.id, "event", { ...draft.fields, venue: "Synthetic hall" }, draft.version);
  await app.manager.publish(admin, saved.id, saved.version);
  const history = await app.manager.history(admin, "sample-event");
  assert.deepEqual(history.slice(0, 3).map(({ action, version, actor }) => `${action}:${version}:${actor}`),
    ["publish:2:Administrator", "save:2:Administrator", "publish:1:null"]);
  assert.match(history[0].at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
});
