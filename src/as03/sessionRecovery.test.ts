import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import type { StaffRecord } from "./contracts.ts";
import { compareDraft } from "./recovery.ts";
import { planRestore, retainDraft } from "./sessionRecovery.ts";

const record = (version: number, fields: Record<string, string>, publishedVersion: number | null = 1): StaffRecord =>
  ({ id: "cafe", kind: "dining", version, fields: { title: "Riverfront Cafe", cuisine: "Sarawakian", ...fields }, publishedVersion });

test("only an editor with unsaved changes is retained", () => {
  const records = [record(1, {})];
  const editor = { id: "cafe", kind: "dining" as const, version: 1, fields: { ...records[0].fields, cuisine: "Fusion" } };
  assert.equal(retainDraft(undefined, true, records), undefined);
  assert.equal(retainDraft(editor, false, records), undefined);
  const retained = retainDraft(editor, true, records);
  assert.deepEqual(retained, { editor, base: records[0] });
  editor.fields.cuisine = "Changed after expiry";
  assert.equal(retained?.editor.fields.cuisine, "Fusion", "the retained copy is independent of later edits");
});

test("an unchanged existing draft is restored as unsaved edits on the same version", () => {
  const base = record(1, {});
  const retained = retainDraft({ id: "cafe", kind: "dining", version: 1, fields: { ...base.fields, cuisine: "Fusion" } }, true, [base])!;
  assert.deepEqual(planRestore(retained, [record(1, {})]), {
    action: "open", editor: { id: "cafe", kind: "dining", version: 1, fields: { ...base.fields, cuisine: "Fusion" } },
  });
});

test("a draft saved elsewhere during expiry goes through stale-revision recovery", () => {
  const base = record(1, {});
  const retained = retainDraft({ id: "cafe", kind: "dining", version: 1, fields: { ...base.fields, cuisine: "Fusion" } }, true, [base])!;
  const latest = record(2, { hours: "08:00–17:00" }, 2);
  const plan = planRestore(retained, [latest]);
  assert.equal(plan.action, "conflict");
  if (plan.action !== "conflict") return;
  assert.deepEqual(plan.conflict, { base, latest });
  assert.equal(plan.editor.version, 1, "the editor keeps the version it started from until staff choose");
  assert.deepEqual(compareDraft(plan.conflict.base.fields, plan.editor.fields, plan.conflict.latest.fields), {
    changedHere: ["cuisine"], changedElsewhere: ["hours"], overlapping: [],
  });
});

test("a new unsaved record is restored as a new record", () => {
  const editor = { kind: "event" as const, fields: { title: "Synthetic new event" } };
  const retained = retainDraft(editor, true, [record(1, {})])!;
  assert.deepEqual(retained, { editor, base: undefined });
  assert.deepEqual(planRestore(retained, []), { action: "open", editor });
});

test("edits are not restored when the record cannot be matched safely", () => {
  const base = record(1, {});
  const retained = retainDraft({ id: "cafe", kind: "dining", version: 1, fields: { ...base.fields, cuisine: "Fusion" } }, true, [base])!;
  assert.deepEqual(planRestore(retained, []), { action: "unavailable" });
  assert.deepEqual(planRestore(retained, [{ ...record(1, {}), kind: "event" }]), { action: "unavailable" });
  const orphan = retainDraft({ id: "cafe", kind: "dining", version: 1, fields: { cuisine: "Fusion" } }, true, [])!;
  assert.deepEqual(planRestore(orphan, [record(2, {})]), { action: "unavailable" });
});

test("the AS03 client never writes to browser storage", () => {
  const directory = fileURLToPath(new URL(".", import.meta.url));
  const sources = readdirSync(directory).filter((file) => /\.tsx?$/.test(file) && !file.endsWith(".test.ts"));
  assert.ok(sources.includes("Staff.tsx") && sources.length >= 10, sources.join());
  for (const name of readdirSync(directory).filter((file) => /\.tsx?$/.test(file) && !file.endsWith(".test.ts"))) {
    const source = readFileSync(join(directory, name), "utf8");
    assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|caches\.|document\.cookie/, name);
  }
});
