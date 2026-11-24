import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";

import { openPGlite, openPostgres, type Db } from "./db.ts";

type After = { after: (fn: () => unknown) => void };
const server = process.env.STIS_TEST_DATABASE_URL;

async function createDatabase(): Promise<{ url: string; drop: () => Promise<void> }> {
  const name = `stis_test_${randomBytes(6).toString("hex")}`;
  const root = await openPostgres(server!);
  await root.exec(`create database ${name}`);
  await root.close();
  const url = new URL(server!);
  url.pathname = `/${name}`;
  return {
    url: url.toString(),
    drop: async () => {
      const admin = await openPostgres(server!);
      await admin.exec(`drop database if exists ${name} with (force)`);
      await admin.close();
    },
  };
}

/** A fresh, isolated database: PGlite in memory, or a throwaway database on STIS_TEST_DATABASE_URL. */
export async function freshDb(_t: After): Promise<Db> {
  if (!server) return openPGlite();
  const { url, drop } = await createDatabase();
  const db = await openPostgres(url);
  return { ...db, close: async () => { await db.close(); await drop(); } };
}

/** Storage that survives closing and reopening, to test restarts. */
export async function durableStorage(prefix: string): Promise<{ open: () => Promise<Db>; cleanup: () => Promise<void> }> {
  if (server) {
    const { url, drop } = await createDatabase();
    return { open: () => openPostgres(url), cleanup: drop };
  }
  mkdirSync("test-results", { recursive: true });
  const directory = mkdtempSync(`test-results/${prefix}-`);
  return { open: () => openPGlite(directory), cleanup: async () => rmSync(directory, { recursive: true }) };
}

export const testDriver = server ? "postgres.js" : "PGlite";
