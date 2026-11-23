import { randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";

import type { Account, Role } from "../src/shared/contracts.ts";
import type { Db } from "./db.ts";
import { pgCode } from "./db.ts";
import { InputError, object } from "./domain.ts";
import { digest } from "./repositories.ts";

export type Clock = () => Date;
export type HashCost = { N: number; r: number; p: number };
export const defaultHashCost: HashCost = { N: 32768, r: 8, p: 1 };

const minute = 60_000;
const lifetimes: Record<Role, { idle: number; absolute: number }> = {
  tourist: { idle: 14 * 24 * 60 * minute, absolute: 30 * 24 * 60 * minute },
  staff: { idle: 30 * minute, absolute: 8 * 60 * minute },
  admin: { idle: 30 * minute, absolute: 8 * 60 * minute },
};
const limits = {
  loginEmail: { limit: 8, window: 15 * minute },
  loginClient: { limit: 30, window: 15 * minute },
  register: { limit: 10, window: 60 * minute },
  recoverEmail: { limit: 5, window: 15 * minute },
  recoverClient: { limit: 20, window: 15 * minute },
};
const codeAlphabet = "0123456789abcdefghjkmnpqrstvwxyz";

function derive(password: string, salt: Buffer, cost: HashCost, length = 32): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, length, { ...cost, maxmem: 160 * cost.N * cost.r }, (error, key) =>
    error ? reject(error) : resolve(key)));
}

export async function hashPassword(password: string, cost: HashCost = defaultHashCost): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, cost);
  return ["scrypt", cost.N, cost.r, cost.p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, N, r, p, salt, key] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !key) return false;
  const expected = Buffer.from(key, "base64url");
  const actual = await derive(password, Buffer.from(salt, "base64url"), { N: Number(N), r: Number(r), p: Number(p) }, expected.length);
  return timingSafeEqual(actual, expected);
}

export function newToken() {
  return randomBytes(32).toString("base64url");
}

export function newRecoveryCode() {
  const bytes = randomBytes(16);
  const chars = [...bytes].map((byte) => codeAlphabet[byte % 32]).join("");
  return chars.match(/.{4}/g)!.join("-");
}

export function normalizeRecoveryCode(value: string) {
  return value.toLowerCase().replace(/[^0-9a-z]/g, "").replace(/o/g, "0").replace(/[il]/g, "1").replace(/u/g, "v");
}

function readEmail(value: unknown) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (email.length < 3 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new InputError("Enter a valid email address.", 400, { email: "Enter a valid email address." });
  return email;
}

function readName(value: unknown) {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!name || name.length > 60 || /[\u0000-\u001f\u007f]/.test(name))
    throw new InputError("Enter a display name of up to 60 characters.", 400, { displayName: "Enter a display name of up to 60 characters." });
  return name;
}

function readNewPassword(value: unknown, email?: string) {
  if (typeof value !== "string" || value.length < 10 || value.length > 200)
    throw new InputError("Choose a password of 10 to 200 characters.", 400, { password: "Use 10 to 200 characters." });
  if (email && value.trim().toLowerCase() === email)
    throw new InputError("Choose a password that is different from your email address.", 400, { password: "Do not use your email address." });
  return value;
}

type AccountRow = { id: string; email: string; display_name: string; role: Role; password_hash: string; status: string; created_at: string };
const accountColumns = `id, email, display_name, role, password_hash, status,
  to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at`;
const view = (row: AccountRow): Account => ({ id: row.id, email: row.email, displayName: row.display_name, role: row.role, createdAt: row.created_at });

export type SignedIn = { account: Account; session: string };
export type SessionContext = { session?: string; client?: string };

export class AccountService {
  private readonly dummyHash: Promise<string>;

  constructor(private readonly db: Db, private readonly clock: Clock, private readonly cost: HashCost = defaultHashCost) {
    this.dummyHash = hashPassword("unused-dummy-password", cost);
  }

  async bootstrapAdmin(email: string, password: string, displayName = "Administrator") {
    if (password.length < 12 || password.length > 200) throw new Error("STIS_ADMIN_PASSWORD must contain 12 to 200 characters.");
    const address = readEmail(email);
    const [existing] = await this.db.query("select 1 from stis.account where email = $1", [address]);
    if (existing) return;
    await this.db.query(`insert into stis.account(id, email, display_name, role, password_hash)
      values ($1, $2, $3, 'admin', $4) on conflict (email) do nothing`, [randomUUID(), address, readName(displayName), await hashPassword(password, this.cost)]);
  }

  async register(input: unknown, context: SessionContext = {}): Promise<SignedIn & { recoveryCodes: string[] }> {
    const body = object(input);
    const email = readEmail(body.email);
    const displayName = readName(body.displayName);
    const password = readNewPassword(body.password, email);
    await this.throttle(`register:client:${context.client ?? "unknown"}`, limits.register, true);
    const id = randomUUID();
    const hash = await hashPassword(password, this.cost);
    const codes = Array.from({ length: 10 }, newRecoveryCode);
    try {
      return await this.db.transaction(async (tx) => {
        await tx.query(`insert into stis.account(id, email, display_name, role, password_hash) values ($1, $2, $3, 'tourist', $4)`,
          [id, email, displayName, hash]);
        for (const code of codes)
          await tx.query("insert into stis.recovery_code(account_id, code_digest) values ($1, $2)", [id, digest(normalizeRecoveryCode(code))]);
        const signedIn = await this.startSession(tx, id);
        return { ...signedIn, recoveryCodes: codes };
      });
    } catch (error) {
      if (pgCode(error) === "23505")
        throw new InputError("An account with this email address already exists. Sign in or recover the account.", 409, { email: "Already registered." });
      throw error;
    }
  }

  async signIn(input: unknown, context: SessionContext = {}): Promise<SignedIn> {
    const body = object(input);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase().slice(0, 254) : "";
    const password = typeof body.password === "string" && body.password.length <= 200 ? body.password : "";
    const emailKey = `login:email:${digest(email)}`;
    const clientKey = `login:client:${context.client ?? "unknown"}`;
    await this.throttle(emailKey, limits.loginEmail);
    await this.throttle(clientKey, limits.loginClient);
    const [row] = email ? await this.db.query<AccountRow>(`select ${accountColumns} from stis.account where email = $1`, [email]) : [];
    const valid = await verifyPassword(password, row?.password_hash ?? await this.dummyHash);
    if (!row || !valid || row.status !== "active" || !password) {
      await this.fail(emailKey, limits.loginEmail);
      await this.fail(clientKey, limits.loginClient);
      throw new InputError("The email address or password is incorrect.", 401);
    }
    await this.reset(emailKey);
    if (context.session) await this.signOut(context.session);
    return this.db.transaction((tx) => this.startSession(tx, row.id));
  }

  async resolve(session?: string): Promise<Account | undefined> {
    if (!session || !/^[\w-]{43}$/.test(session)) return undefined;
    const now = this.clock();
    const [row] = await this.db.query<AccountRow & { last_seen_at: Date; absolute_expires_at: Date }>(`
      select a.id, a.email, a.display_name, a.role, a.status,
        to_char(a.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at, s.last_seen_at, s.absolute_expires_at
      from stis.account_session s join stis.account a on a.id = s.account_id
      where s.token_digest = $1 and s.expires_at > $2 and s.absolute_expires_at > $2 and a.status = 'active'`, [digest(session), now.toISOString()]);
    if (!row) return undefined;
    if (now.getTime() - new Date(row.last_seen_at).getTime() > minute) {
      const idle = new Date(Math.min(now.getTime() + lifetimes[row.role].idle, new Date(row.absolute_expires_at).getTime()));
      await this.db.query("update stis.account_session set last_seen_at = $2, expires_at = $3 where token_digest = $1",
        [digest(session), now.toISOString(), idle.toISOString()]);
    }
    return view(row);
  }

  async signOut(session?: string) {
    if (session && /^[\w-]{43}$/.test(session))
      await this.db.query("delete from stis.account_session where token_digest = $1", [digest(session)]);
  }

  async recover(input: unknown, context: SessionContext = {}): Promise<SignedIn & { recoveryCodesRemaining: number }> {
    const body = object(input);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase().slice(0, 254) : "";
    const code = typeof body.code === "string" && body.code.length <= 64 ? normalizeRecoveryCode(body.code) : "";
    const emailKey = `recover:email:${digest(email)}`;
    const clientKey = `recover:client:${context.client ?? "unknown"}`;
    await this.throttle(emailKey, limits.recoverEmail);
    await this.throttle(clientKey, limits.recoverClient);
    const password = readNewPassword(body.newPassword, email);
    const [row] = email && code.length === 16 ? await this.db.query<{ id: string }>(`
      select a.id from stis.account a join stis.recovery_code c on c.account_id = a.id
      where a.email = $1 and a.status = 'active' and c.code_digest = $2 and c.used_at is null`, [email, digest(code)]) : [];
    if (!row) {
      await this.fail(emailKey, limits.recoverEmail);
      await this.fail(clientKey, limits.recoverClient);
      throw new InputError("The email address or recovery code is incorrect, or the code was already used.", 400);
    }
    const hash = await hashPassword(password, this.cost);
    return this.db.transaction(async (tx) => {
      const used = await tx.query(`update stis.recovery_code set used_at = $3 where account_id = $1 and code_digest = $2 and used_at is null
        returning account_id`, [row.id, digest(code), this.clock().toISOString()]);
      if (!used.length) throw new InputError("The email address or recovery code is incorrect, or the code was already used.", 400);
      await tx.query("update stis.account set password_hash = $2, password_changed_at = now(), updated_at = now() where id = $1", [row.id, hash]);
      await tx.query("delete from stis.account_session where account_id = $1", [row.id]);
      await this.reset(emailKey, tx);
      const signedIn = await this.startSession(tx, row.id);
      return { ...signedIn, recoveryCodesRemaining: await this.remainingCodes(row.id, tx) };
    });
  }

  async profile(session?: string) {
    const account = await this.require(session);
    return { ...account, recoveryCodesRemaining: await this.remainingCodes(account.id) };
  }

  async updateProfile(session: string | undefined, input: unknown) {
    const account = await this.require(session);
    const displayName = readName(object(input).displayName);
    await this.db.query("update stis.account set display_name = $2, updated_at = now() where id = $1", [account.id, displayName]);
    return this.profile(session);
  }

  async changePassword(session: string | undefined, input: unknown) {
    const account = await this.require(session);
    const body = object(input);
    await this.confirmPassword(account.id, body.currentPassword);
    const hash = await hashPassword(readNewPassword(body.newPassword, account.email), this.cost);
    await this.db.transaction(async (tx) => {
      await tx.query("update stis.account set password_hash = $2, password_changed_at = now(), updated_at = now() where id = $1", [account.id, hash]);
      await tx.query("delete from stis.account_session where account_id = $1 and token_digest <> $2", [account.id, digest(session!)]);
    });
  }

  async regenerateRecoveryCodes(session: string | undefined, input: unknown) {
    const account = await this.require(session);
    await this.confirmPassword(account.id, object(input).password);
    const codes = Array.from({ length: 10 }, newRecoveryCode);
    await this.db.transaction(async (tx) => {
      await tx.query("delete from stis.recovery_code where account_id = $1", [account.id]);
      for (const code of codes)
        await tx.query("insert into stis.recovery_code(account_id, code_digest) values ($1, $2)", [account.id, digest(normalizeRecoveryCode(code))]);
    });
    return codes;
  }

  async deleteAccount(session: string | undefined, input: unknown) {
    const account = await this.require(session);
    await this.confirmPassword(account.id, object(input).password);
    await this.db.transaction(async (tx) => {
      if (account.role === "admin") {
        const [{ admins }] = await tx.query<{ admins: number }>("select count(*)::int as admins from stis.account where role = 'admin' and status = 'active'");
        if (admins <= 1) throw new InputError("Add another administrator before deleting the last administrator account.", 409);
      }
      await tx.query("delete from stis.account where id = $1", [account.id]);
    });
  }

  async require(session?: string): Promise<Account> {
    const account = await this.resolve(session);
    if (!account) throw new InputError("Sign in to continue.", 401);
    return account;
  }

  async listStaff(session?: string) {
    await this.requireRole(session, ["admin"]);
    const rows = await this.db.query<AccountRow>(`select ${accountColumns} from stis.account where role in ('staff', 'admin') order by role, email`);
    return rows.map((row) => ({ ...view(row), status: row.status }));
  }

  async createStaff(session: string | undefined, input: unknown) {
    await this.requireRole(session, ["admin"]);
    const body = object(input);
    const email = readEmail(body.email);
    const role = body.role === "admin" ? "admin" : body.role === "staff" ? "staff" : undefined;
    if (!role) throw new InputError("Choose a staff role.", 400, { role: "Choose staff or administrator." });
    const id = randomUUID();
    try {
      await this.db.query(`insert into stis.account(id, email, display_name, role, password_hash) values ($1, $2, $3, $4, $5)`,
        [id, email, readName(body.displayName), role, await hashPassword(readNewPassword(body.password, email), this.cost)]);
    } catch (error) {
      if (pgCode(error) === "23505") throw new InputError("An account with this email address already exists.", 409, { email: "Already registered." });
      throw error;
    }
    return (await this.listStaff(session)).find((account) => account.id === id)!;
  }

  async updateStaff(session: string | undefined, id: string, input: unknown) {
    const admin = await this.requireRole(session, ["admin"]);
    const body = object(input);
    if (id === admin.id) throw new InputError("Ask another administrator to change your own role or status.", 409);
    const [target] = await this.db.query<AccountRow>(`select ${accountColumns} from stis.account where id::text = $1 and role in ('staff', 'admin')`, [id]);
    if (!target) throw new InputError("This staff account is unavailable.", 404);
    const role = body.role === undefined ? target.role : body.role === "admin" || body.role === "staff" ? body.role : undefined;
    const status = body.status === undefined ? target.status : body.status === "active" || body.status === "disabled" ? body.status : undefined;
    if (!role || !status) throw new InputError("Choose a valid role and status.", 400);
    await this.db.transaction(async (tx) => {
      await tx.query("update stis.account set role = $2, status = $3, updated_at = now() where id = $1", [target.id, role, status]);
      if (status === "disabled" || role !== target.role) await tx.query("delete from stis.account_session where account_id = $1", [target.id]);
    });
    return (await this.listStaff(session)).find((account) => account.id === target.id)!;
  }

  async requireRole(session: string | undefined, roles: Role[]): Promise<Account> {
    const account = await this.require(session);
    if (!roles.includes(account.role)) throw new InputError("Your account does not have permission for this action.", 403);
    return account;
  }

  private async confirmPassword(id: string, password: unknown) {
    const [row] = await this.db.query<{ password_hash: string }>("select password_hash from stis.account where id = $1", [id]);
    if (typeof password !== "string" || password.length > 200 || !row || !await verifyPassword(password, row.password_hash))
      throw new InputError("Your current password is incorrect.", 401, { password: "Incorrect password." });
  }

  private async remainingCodes(id: string, db: Db = this.db) {
    const [{ count }] = await db.query<{ count: number }>("select count(*)::int as count from stis.recovery_code where account_id = $1 and used_at is null", [id]);
    return count;
  }

  private async startSession(tx: Db, accountId: string): Promise<SignedIn> {
    const [row] = await tx.query<AccountRow>(`select ${accountColumns} from stis.account where id = $1`, [accountId]);
    const now = this.clock();
    const life = lifetimes[row.role];
    const session = newToken();
    await tx.query(`delete from stis.account_session where account_id = $1 and (expires_at <= $2 or absolute_expires_at <= $2)`, [accountId, now.toISOString()]);
    await tx.query(`insert into stis.account_session(token_digest, account_id, created_at, last_seen_at, expires_at, absolute_expires_at)
      values ($1, $2, $3, $3, $4, $5)`, [digest(session), accountId, now.toISOString(),
      new Date(now.getTime() + life.idle).toISOString(), new Date(now.getTime() + life.absolute).toISOString()]);
    return { account: view(row), session };
  }

  private async throttle(key: string, rule: { limit: number; window: number }, count = false) {
    const now = this.clock();
    const [row] = await this.db.query<{ failures: number; window_started_at: Date }>(
      "select failures, window_started_at from stis.auth_throttle where key = $1", [digest(key)]);
    const active = row && now.getTime() - new Date(row.window_started_at).getTime() < rule.window;
    if (active && row.failures >= rule.limit) throw new InputError("Too many attempts. Wait a few minutes before trying again.", 429);
    if (count) await this.fail(key, rule);
  }

  private async fail(key: string, rule: { window: number }) {
    const now = this.clock().toISOString();
    await this.db.query(`insert into stis.auth_throttle(key, window_started_at, failures) values ($1, $2, 1)
      on conflict (key) do update set
        failures = case when stis.auth_throttle.window_started_at <= $2::timestamptz - make_interval(secs => $3) then 1 else stis.auth_throttle.failures + 1 end,
        window_started_at = case when stis.auth_throttle.window_started_at <= $2::timestamptz - make_interval(secs => $3) then $2::timestamptz else stis.auth_throttle.window_started_at end`,
    [digest(key), now, rule.window / 1000]);
  }

  private async reset(key: string, db: Db = this.db) {
    await db.query("delete from stis.auth_throttle where key = $1", [digest(key)]);
  }
}
