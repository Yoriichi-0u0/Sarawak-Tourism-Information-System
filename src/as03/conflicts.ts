import type { ReviewedPlan } from "./contracts";

export type ConflictingEntry = { id: string; title: string; interval: string };
export type ConflictPair = { first: ConflictingEntry; second: ConflictingEntry };

export function conflictDetails(plan?: ReviewedPlan) {
  const entries = new Map((plan?.entries ?? []).map(({ id, title, start, end }): [string, ConflictingEntry] =>
    [id, { id, title, interval: start ? `${start}–${end} MYT` : "time undecided" }]));
  const pairs: ConflictPair[] = [];
  const partners = new Map<string, ConflictingEntry[]>();
  for (const [firstId, secondId] of plan?.conflicts ?? []) {
    const first = entries.get(firstId);
    const second = entries.get(secondId);
    if (!first || !second) continue;
    pairs.push({ first, second });
    partners.set(first.id, [...partners.get(first.id) ?? [], second]);
    partners.set(second.id, [...partners.get(second.id) ?? [], first]);
  }
  return { pairs, partners };
}
