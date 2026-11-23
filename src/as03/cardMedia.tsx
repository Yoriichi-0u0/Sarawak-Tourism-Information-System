import { CalendarDays, MapPinned } from "lucide-react";

export const cardPhotos: ReadonlySet<string> = new Set(["bako", "culture", "wildlife", "cave", "museum", "waterfront", "kolo"]);

export type CardMediaKind = { kind: "photo"; src: string } | { kind: "destination" } | { kind: "event" };

export function cardMedia(mode: "destinations" | "events", image?: string): CardMediaKind {
  if (image && cardPhotos.has(image)) return { kind: "photo", src: `/images/${image}.webp` };
  return { kind: mode === "destinations" ? "destination" : "event" };
}

export function CardMedia({ mode, image }: { mode: "destinations" | "events"; image?: string }) {
  const media = cardMedia(mode, image);
  if (media.kind === "photo") return <img src={media.src} alt="" loading="lazy" />;
  const Icon = media.kind === "destination" ? MapPinned : CalendarDays;
  return <div className="as03-card-banner"><Icon size={38} /></div>;
}
