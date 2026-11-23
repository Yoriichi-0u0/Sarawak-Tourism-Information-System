import { RequestError } from "./api";
import type { Fields, ReviewedPlan } from "../shared/contracts";

export function isStale(error: unknown): boolean {
  return error instanceof RequestError && error.status === 409;
}

function differs(first: Fields, second: Fields, key: string) {
  return (first[key] ?? "").trim() !== (second[key] ?? "").trim();
}

export function compareDraft(base: Fields, local: Fields, latest: Fields) {
  const keys = [...new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(latest)])].sort();
  const changedHere = keys.filter((key) => differs(base, local, key));
  const changedElsewhere = keys.filter((key) => differs(base, latest, key));
  const overlapping = changedHere.filter((key) => changedElsewhere.includes(key) && differs(local, latest, key));
  return { changedHere, changedElsewhere, overlapping };
}

export function rebaseDraft(base: Fields, local: Fields, latest: Fields): Fields {
  const rebased = { ...latest };
  for (const key of compareDraft(base, local, latest).changedHere) rebased[key] = local[key] ?? "";
  return rebased;
}

function interval({ start, end }: { start: string; end: string }) {
  return start ? `${start}–${end}` : "time undecided";
}

export function describePlanChanges(current: ReviewedPlan, latest: ReviewedPlan): string[] {
  const changes: string[] = [];
  if (current.date !== latest.date) changes.push(`Travel date is now ${latest.date} (was ${current.date}).`);
  if (current.provisional !== latest.provisional)
    changes.push(`The travel date is now ${latest.provisional ? "provisional" : "confirmed"}.`);
  const before = new Map(current.entries.map((entry) => [entry.id, entry]));
  const after = new Map(latest.entries.map((entry) => [entry.id, entry]));
  const added = latest.entries.filter(({ id }) => !before.has(id)).map(({ title }) => title);
  const removed = current.entries.filter(({ id }) => !after.has(id)).map(({ title }) => title);
  if (added.length) changes.push(`Added: ${added.join(", ")}.`);
  if (removed.length) changes.push(`Removed: ${removed.join(", ")}.`);
  for (const entry of latest.entries) {
    const previous = before.get(entry.id);
    if (previous && interval(previous) !== interval(entry))
      changes.push(`${entry.title} is now ${interval(entry)} (was ${interval(previous)}).`);
  }
  const kept = (plan: ReviewedPlan) => plan.entries.map(({ id }) => id).filter((id) => before.has(id) && after.has(id)).join();
  if (kept(current) !== kept(latest)) changes.push("The order of stops changed.");
  return changes.length ? changes : ["Saved details changed."];
}
