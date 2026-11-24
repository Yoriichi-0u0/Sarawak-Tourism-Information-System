import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type Row = Record<string, unknown>;

export interface Db {
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  transaction<T>(work: (tx: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

type PGliteLike = {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<unknown>;
};

export async function openPGlite(dataDir?: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite(dataDir);
  await pg.waitReady;
  const wrap = (target: PGliteLike, inside: boolean): Db => {
    const db: Db = {
      query: async <T extends Row>(sql: string, params: unknown[] = []) => (await target.query<T>(sql, params)).rows,
      exec: async (sql) => { await target.exec(sql); },
      transaction: (work) => inside ? work(db) : pg.transaction((tx) => work(wrap(tx, true))),
      close: () => pg.close(),
    };
    return db;
  };
  return wrap(pg, false);
}

export async function openPostgres(url: string): Promise<Db> {
  const { default: postgres } = await import("postgres");
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  const sql = postgres(url, { prepare: false, max: 3, idle_timeout: 20, connect_timeout: 10, ssl: local ? false : "require", onnotice: () => {} });
  type Runner = { unsafe: (query: string, params?: never[]) => Promise<unknown> };
  const wrap = (target: Runner, inside: boolean): Db => {
    const db: Db = {
      query: async <T extends Row>(query: string, params: unknown[] = []) =>
        [...(await target.unsafe(query, params as never[]) as Iterable<T>)],
      exec: async (query) => { await target.unsafe(query); },
      transaction: async <T>(work: (tx: Db) => Promise<T>) => inside
        ? work(db)
        : await sql.begin((tx) => work(wrap(tx as unknown as Runner, true))) as T,
      close: () => sql.end({ timeout: 5 }),
    };
    return db;
  };
  return wrap(sql as unknown as Runner, false);
}

export const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations");
export const rollbackDirectory = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "rollback");

export async function migrate(db: Db, directory = migrationsDirectory): Promise<string[]> {
  await db.exec(`create schema if not exists stis;
    create table if not exists stis.schema_migration (version text primary key, applied_at timestamptz not null default now());
    alter table stis.schema_migration enable row level security;`);
  const applied = new Set((await db.query<{ version: string }>("select version from stis.schema_migration")).map(({ version }) => version));
  const added: string[] = [];
  for (const file of readdirSync(directory).filter((name) => name.endsWith(".sql")).sort()) {
    const version = file.slice(0, -4);
    if (applied.has(version)) continue;
    await db.transaction(async (tx) => {
      await tx.exec(readFileSync(join(directory, file), "utf8"));
      await tx.query("insert into stis.schema_migration(version) values ($1)", [version]);
    });
    added.push(version);
  }
  return added;
}

export async function rollback(db: Db, version: string, directory = rollbackDirectory) {
  await db.transaction(async (tx) => {
    await tx.query("delete from stis.schema_migration where version = $1", [version]);
    await tx.exec(readFileSync(join(directory, `${version}.down.sql`), "utf8"));
  });
}

export function pgCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | undefined)?.code;
  return typeof code === "string" ? code : undefined;
}
