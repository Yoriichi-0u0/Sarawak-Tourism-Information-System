// Provisioning for a hosted database: publishes curated content (only missing records unless --update-content) and bootstraps the first administrator.
// Usage: node --env-file=.env.local --import tsx scripts/provision.ts [--update-content] [--withdraw-fixtures]
import { openPostgres } from "../server/db.ts";
import { syncContent } from "../server/content/sync.ts";
import { Application } from "../server/services.ts";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("Set DATABASE_URL.");
const admin = process.env.STIS_ADMIN_EMAIL && process.env.STIS_ADMIN_PASSWORD
  ? { email: process.env.STIS_ADMIN_EMAIL, password: process.env.STIS_ADMIN_PASSWORD, displayName: process.env.STIS_ADMIN_NAME ?? "Administrator" }
  : undefined;
const app = await Application.open({ db: await openPostgres(url), migrate: false, seed: false, admin });
const synced = await syncContent(app.records, undefined, { update: process.argv.includes("--update-content") });
console.log(JSON.stringify({ created: synced.created.length, updated: synced.updated.length, unchanged: synced.unchanged.length }));
if (process.argv.includes("--withdraw-fixtures")) {
  const fixtures = (await app.records.listDrafts()).filter(({ id, publishedVersion }) => id.startsWith("sample-") && publishedVersion !== null);
  for (const { id } of fixtures) await app.records.withdraw(id, null);
  console.log(JSON.stringify({ withdrawnFixtures: fixtures.map(({ id }) => id) }));
}
const [counts] = await app.db.query<{ records: number; published: number; admins: number }>(`select
  (select count(*)::int from stis.tourism_record) as records,
  (select count(*)::int from stis.record_state where published is not null) as published,
  (select count(*)::int from stis.account where role = 'admin') as admins`);
console.log(JSON.stringify(counts));
await app.close();
