import { BedDouble, CalendarDays, Compass, Info, Route, UtensilsCrossed, type LucideIcon } from "lucide-react";

import type { RecordKind } from "../shared/contracts";

export type Section = { kind: RecordKind; path: string; label: string; singular: string; plural: string; blurb: string; icon: LucideIcon };

export const sections: Section[] = [
  { kind: "destination", path: "/destinations", label: "Destinations", singular: "destination", plural: "destinations", blurb: "National parks, culture and cities", icon: Compass },
  { kind: "accommodation", path: "/stay", label: "Stay", singular: "place to stay", plural: "places to stay", blurb: "Hotels, homestays and park lodging", icon: BedDouble },
  { kind: "transportation", path: "/transport", label: "Getting around", singular: "transport option", plural: "transport options", blurb: "Plan journeys between places", icon: Route },
  { kind: "dining", path: "/food", label: "Food", singular: "place to eat", plural: "places to eat", blurb: "Local dishes and dietary needs", icon: UtensilsCrossed },
  { kind: "event", path: "/events", label: "Events", singular: "event", plural: "events", blurb: "Festivals and what's on", icon: CalendarDays },
  { kind: "visitor", path: "/visitor-info", label: "Visitor info", singular: "guidance", plural: "guidance items", blurb: "Safety, entry and accessibility", icon: Info },
];

export const sectionFor = (kind: RecordKind) => sections.find((section) => section.kind === kind)!;
export const sectionAt = (path: string) => sections.find((section) => section.path === path);
export const detailPath = (kind: RecordKind, id: string) => `${sectionFor(kind).path}/${encodeURIComponent(id)}`;
