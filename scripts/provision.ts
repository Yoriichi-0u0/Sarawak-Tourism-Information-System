// One-off provisioning for a hosted database: seeds the catalogue if empty and bootstraps the first administrator.
// Usage: node --env-file=.env.local --import tsx scripts/provision.ts
import { openPostgres } from "../server/db.ts";
import { Application } from "../server/services.ts";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("Set DATABASE_URL.");
const admin = process.env.STIS_ADMIN_EMAIL && process.env.STIS_ADMIN_PASSWORD
  ? { email: process.env.STIS_ADMIN_EMAIL, password: process.env.STIS_ADMIN_PASSWORD, displayName: process.env.STIS_ADMIN_NAME ?? "Administrator" }
  : undefined;
const app = await Application.open({ db: await openPostgres(url), migrate: false, seed: true, admin });
const [counts] = await app.db.query<{ records: number; published: number; admins: number }>(`select
  (select count(*)::int from stis.tourism_record) as records,
  (select count(*)::int from stis.record_state where published is not null) as published,
  (select count(*)::int from stis.account where role = 'admin') as admins`);
console.log(JSON.stringify(counts));
await app.close();
