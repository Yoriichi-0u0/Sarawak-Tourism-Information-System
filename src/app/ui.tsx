import { useEffect, useRef, type ReactNode } from "react";
import {
  AlertTriangle, ArrowUpRight, CalendarCheck, CalendarClock, CalendarX, CheckCircle2, FlaskConical, Info, Loader2,
  PenLine, ShieldCheck, type LucideIcon,
} from "lucide-react";

import { optionLabel, options } from "../shared/catalogue";
import type { Fields, RecordKind, TourismItem } from "../shared/contracts";
import { mediaAsset, mediaRole, srcSet, type MediaAsset } from "../shared/media";
import { sectionFor } from "./kinds";
import { Link } from "./router";

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function useTitle(title: string) {
  useEffect(() => { document.title = title ? `${title} · sarawak.` : "sarawak. — Sarawak Tourism Information System"; }, [title]);
}

export function formatDay(date: string, withWeekday = true): string {
  const parsed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!parsed) return date;
  const value = new Date(Date.UTC(Number(parsed[1]), Number(parsed[2]) - 1, Number(parsed[3])));
  return `${withWeekday ? `${weekdays[value.getUTCDay()]} ` : ""}${value.getUTCDate()} ${months[value.getUTCMonth()]} ${value.getUTCFullYear()}`;
}

/** Event timing in Kuching time, without inventing a time for all-day events. */
export function formatWhen(startsAt = "", endsAt = ""): string {
  if (!startsAt) return "Date to be confirmed";
  const [startDay, startTime] = startsAt.split("T");
  const [endDay, endTime] = endsAt ? endsAt.split("T") : [];
  const start = `${formatDay(startDay)}${startTime ? `, ${startTime}` : ""}`;
  if (!endDay) return `${start}${startTime ? " MYT" : ""}`;
  if (endDay === startDay) return `${start}${endTime ? `–${endTime}` : ""}${startTime ? " MYT" : ""}`;
  return `${start} – ${formatDay(endDay)}${endTime ? `, ${endTime}` : ""}${startTime ? " MYT" : ""}`;
}

export const today = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

export function isPast(item: TourismItem) {
  const end = (item.fields.endsAt || item.fields.startsAt || "").slice(0, 10);
  return Boolean(end) && end < today();
}

export function subtitle(item: TourismItem): string {
  const { fields } = item;
  switch (item.kind) {
    case "event": return fields.venue ?? "";
    case "transportation": return `${fields.from ?? "?"} → ${fields.to ?? "?"}`;
    case "visitor": return fields.area === "sarawak" ? "Across Sarawak" : "Destination-specific";
    default: return fields.location ?? "";
  }
}

export function label(field: keyof typeof options, value: string | undefined) {
  return value ? optionLabel(options[field], value) ?? value : "";
}

const provenance: Record<string, { text: string; tone: string; icon: LucideIcon }> = {
  verified: { text: "Verified", tone: "ok", icon: ShieldCheck },
  reported: { text: "Reported, check locally", tone: "info", icon: Info },
  staff: { text: "STIS guidance", tone: "neutral", icon: PenLine },
  illustrative: { text: "Illustrative", tone: "warn", icon: FlaskConical },
};

export function ProvenanceBadge({ fields }: { fields: Fields }) {
  const entry = provenance[fields.provenance] ?? provenance.illustrative;
  const Icon = entry.icon;
  return <span className={`badge ${entry.tone}`}><Icon size={14} aria-hidden="true" />{entry.text}</span>;
}

export function SourceNote({ fields }: { fields: Fields }) {
  const kind = fields.provenance || "illustrative";
  if (kind === "illustrative") return <p className="small muted">Illustrative demonstration record. It does not describe a real business, service or listing.</p>;
  return <p className="small muted">
    {kind === "staff" ? "Guidance written by the STIS team" : "Source: "}
    {fields.sourceName && fields.sourceUrl ? <a href={fields.sourceUrl} target="_blank" rel="noopener noreferrer">{fields.sourceName}<span className="sr-only"> (opens an external site)</span></a> : fields.sourceName}
    {fields.reviewedOn ? ` · checked ${formatDay(fields.reviewedOn, false)}` : ""}
  </p>;
}

const statuses: Record<string, { text: string; tone: string; icon: LucideIcon }> = {
  scheduled: { text: "Scheduled", tone: "ok", icon: CalendarCheck },
  postponed: { text: "Postponed", tone: "warn", icon: CalendarClock },
  cancelled: { text: "Cancelled", tone: "danger", icon: CalendarX },
};

export function StatusBadge({ item }: { item: TourismItem }) {
  if (item.kind !== "event") return null;
  if (isPast(item) && item.fields.status !== "cancelled") return <span className="badge neutral"><CalendarCheck size={14} aria-hidden="true" />Past event</span>;
  const status = statuses[item.fields.status] ?? statuses.scheduled;
  const Icon = status.icon;
  return <span className={`badge ${status.tone}`}><Icon size={14} aria-hidden="true" />{status.text}</span>;
}

export function ExternalLink({ href, children, className = "button secondary" }: { href: string; children: ReactNode; className?: string }) {
  let host = "";
  try { host = new URL(href).hostname.replace(/^www\./, ""); } catch { return null; }
  return <a className={className} href={href} target="_blank" rel="noopener noreferrer">
    {children}<ArrowUpRight size={16} aria-hidden="true" /><span className="sr-only"> (opens {host}, an external provider)</span>
  </a>;
}

export function ProviderHandoff({ item }: { item: TourismItem }) {
  const href = item.fields.provider;
  if (!href || item.fields.provenance === "illustrative") return <p className="small muted">No external booking or information link is listed for this record.</p>;
  const host = (() => { try { return new URL(href).hostname.replace(/^www\./, ""); } catch { return ""; } })();
  const action = item.kind === "accommodation" ? "Check availability and book" : item.kind === "event" ? "Tickets and registration"
    : item.kind === "transportation" ? "Operator information" : item.kind === "visitor" ? "Read the official guidance" : "Official information";
  return <div className="stack" style={{ gap: 8 }}>
    <ExternalLink href={href} className="button primary">{action}</ExternalLink>
    <p className="small muted">You will leave STIS for <strong>{host}</strong>. Bookings, tickets and payments are handled by that provider, not by STIS.</p>
  </div>;
}

/** A responsive, lazily loaded library image (AVIF, then WebP) with intrinsic size to avoid layout shift. */
export function Picture({ asset, sizes, eager = false }: { asset: MediaAsset; sizes: string; eager?: boolean }) {
  const fallback = asset.widths.includes(960) ? 960 : asset.widths[asset.widths.length - 1];
  return <picture>
    <source type="image/avif" srcSet={srcSet(asset, "avif")} sizes={sizes} />
    <source type="image/webp" srcSet={srcSet(asset, "webp")} sizes={sizes} />
    <img src={`/media/${asset.id}-${fallback}.webp`} alt={asset.alt} width={asset.width} height={asset.height}
      loading={eager ? "eager" : "lazy"} decoding="async" fetchPriority={eager ? "high" : undefined} style={{ objectPosition: asset.focus }} />
  </picture>;
}

const roleLabel = { exact: "Photo", representative: "Representative photo", illustration: "AI illustration" } as const;

export function MediaCredit({ asset }: { asset: MediaAsset }) {
  if (asset.kind === "illustration") return <>AI-generated illustration, not a photograph of a real place or business.</>;
  return <>Photo: {asset.author}, <a href={asset.licenceUrl || asset.sourceUrl} target="_blank" rel="noopener noreferrer">{asset.licence}<span className="sr-only"> licence (opens an external site)</span></a>, via <a href={asset.sourceUrl} target="_blank" rel="noopener noreferrer">{asset.source}<span className="sr-only"> (opens an external site)</span></a></>;
}

export function Media({ item, large = false }: { item: TourismItem; large?: boolean }) {
  const Icon = sectionFor(item.kind).icon;
  const asset = mediaAsset(item.fields.image);
  if (!asset) return <div className={large ? "detail-media" : "card-media"}><Icon size={large ? 56 : 40} aria-hidden="true" /></div>;
  const role = mediaRole(asset, item.id);
  if (!large) return <div className="card-media">
    <Picture asset={asset} sizes="(max-width: 640px) 100vw, (max-width: 1100px) 50vw, 380px" />
    <span className="media-chip" data-role={role}>{roleLabel[role]}</span>
  </div>;
  return <figure className="detail-figure">
    <div className="detail-media"><Picture asset={asset} sizes="(max-width: 960px) 100vw, 820px" eager /></div>
    <figcaption className="small muted">
      {role === "representative" && <strong>Representative photo: {asset.subject}. Not a photo of this listing. </strong>}
      {role === "exact" && <>{asset.subject}. </>}
      <MediaCredit asset={asset} /> · <Link to="/credits">All image credits</Link>
    </figcaption>
  </figure>;
}

export function Notice({ tone, children, title, focus }: { tone: "info" | "ok" | "warn" | "error"; children?: ReactNode; title?: string; focus?: boolean }) {
  const Icon = tone === "ok" ? CheckCircle2 : tone === "info" ? Info : AlertTriangle;
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => { if (focus) element.current?.focus({ preventScroll: false }); }, [focus]);
  return <div className={`notice ${tone}`} role={tone === "error" || tone === "warn" ? "alert" : "status"} tabIndex={focus ? -1 : undefined} ref={element}>
    <Icon size={20} aria-hidden="true" />
    <div>{title && <strong style={{ display: "block", marginBottom: 2 }}>{title}</strong>}{children}</div>
  </div>;
}

export function Loading({ text = "Loading…" }: { text?: string }) {
  return <p role="status" className="row muted"><Loader2 size={18} aria-hidden="true" />{text}</p>;
}

export function Empty({ icon: Icon, title, children, page = false }: { icon: LucideIcon; title: string; children?: ReactNode; page?: boolean }) {
  const Heading = page ? "h1" : "h2";
  return <div className="empty"><Icon size={36} aria-hidden="true" /><Heading className={page ? "h2-size" : undefined}>{title}</Heading>{children}</div>;
}

export const kindLabel = (kind: RecordKind) => sectionFor(kind).singular;
export const kindTitle = (kind: RecordKind) => { const label = kindLabel(kind); return label.charAt(0).toUpperCase() + label.slice(1); };
