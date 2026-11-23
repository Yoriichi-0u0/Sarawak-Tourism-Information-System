import type { Fields, RecordKind, StaffRecord } from "./contracts";

export type Editor = { id?: string; kind: RecordKind; version?: number; fields: Fields };
export type Retained = { editor: Editor; base?: StaffRecord };
export type RestorePlan =
  | { action: "open"; editor: Editor }
  | { action: "conflict"; editor: Editor; conflict: { base: StaffRecord; latest: StaffRecord } }
  | { action: "unavailable" };

export function retainDraft(editor: Editor | undefined, dirty: boolean, records: StaffRecord[]): Retained | undefined {
  if (!editor || !dirty) return;
  const copy = { ...editor, fields: { ...editor.fields } };
  return { editor: copy, base: editor.id ? records.find(({ id }) => id === editor.id) : undefined };
}

export function planRestore({ editor, base }: Retained, latestRecords: StaffRecord[]): RestorePlan {
  const restored = { ...editor, fields: { ...editor.fields } };
  if (!editor.id) return { action: "open", editor: restored };
  const latest = latestRecords.find(({ id }) => id === editor.id);
  if (!latest || !base || latest.kind !== editor.kind) return { action: "unavailable" };
  if (latest.version === editor.version) return { action: "open", editor: restored };
  return { action: "conflict", editor: restored, conflict: { base, latest } };
}
