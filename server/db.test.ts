import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { test } from "node:test";

import { migrate, migrationsDirectory, rollback, rollbackDirectory } from "./db.ts";
import { freshDb } from "./testing.ts";

test("every migration has a rollback, and up → down → up leaves an identical schema", async (t) => {
  const migrations = readdirSync(migrationsDirectory).filter((name) => name.endsWith(".sql")).map((name) => name.slice(0, -4));
  const rollbacks = new Set(readdirSync(rollbackDirectory).map((name) => name.replace(/\.down\.sql$/, "")));
  for (const version of migrations) assert.ok(rollbacks.has(version), `rollback for ${version}`);
  const db = await freshDb(t);
  t.after(() => db.close());
  const shape = async () => JSON.stringify(await db.query(`select table_name, column_name, data_type, is_nullable from information_schema.columns
    where table_schema = 'stis' order by table_name, ordinal_position`));
  assert.deepEqual(await migrate(db), migrations);
  assert.deepEqual(await migrate(db), [], "re-running applies nothing");
  const first = await shape();
  for (const version of [...migrations].reverse()) await rollback(db, version);
  assert.equal(await shape(), "[]");
  assert.deepEqual(await migrate(db), migrations);
  assert.equal(await shape(), first);
});

test("every STIS table has row level security enabled and nothing is created in the public schema", async (t) => {
  const db = await freshDb(t);
  t.after(() => db.close());
  await migrate(db);
  const tables = await db.query<{ relname: string; relrowsecurity: boolean; nspname: string }>(`select c.relname, c.relrowsecurity, n.nspname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind = 'r' and n.nspname in ('stis', 'public') order by 1`);
  const stis = tables.filter(({ nspname }) => nspname === "stis");
  assert.equal(stis.length, 12);
  for (const table of stis) assert.equal(table.relrowsecurity, true, table.relname);
  assert.deepEqual(tables.filter(({ nspname }) => nspname === "public").map(({ relname }) => relname), []);
});
