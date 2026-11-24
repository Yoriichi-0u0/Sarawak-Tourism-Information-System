import { useEffect, useState } from "react";
import { CalendarDays, MapPin, SearchX } from "lucide-react";

import { api, errorMessage, RequestError } from "../../lib/api";
import { fieldSpecs, optionLabel, splitTags } from "../../shared/catalogue";
import type { RecordKind, TourismItem } from "../../shared/contracts";
import { CompareToggle } from "../compare";
import { detailPath, sectionFor, sections } from "../kinds";
import { Link } from "../router";
import { AddButton } from "../trips";
import { Empty, formatWhen, Loading, Media, Notice, ProvenanceBadge, ProviderHandoff, SourceNote, StatusBadge, subtitle, useTitle } from "../ui";
import { ResultCard } from "./Discover";

const omitted = new Set(["title", "summary", "image", "provider", "destinationIds", "provenance", "sourceName", "sourceUrl", "reviewedOn", "startsAt", "endsAt", "status"]);
const relatedOrder: RecordKind[] = ["event", "accommodation", "transportation", "dining", "visitor"];

export function DetailPage({ kind, id }: { kind: RecordKind; id: string }) {
  const section = sectionFor(kind);
  const [item, setItem] = useState<TourismItem | null>();
  const [related, setRelated] = useState<Partial<Record<RecordKind, TourismItem[]>>>({});
  const [error, setError] = useState("");
  useTitle(item?.fields.title ?? section.label);

  useEffect(() => {
    let live = true;
    setItem(undefined); setError(""); setRelated({});
    api<TourismItem>(`catalog/${kind}/${encodeURIComponent(id)}`).then((record) => {
      if (!live) return;
      setItem(record);
      void api<Partial<Record<RecordKind, TourismItem[]>>>(`catalog/${kind}/${encodeURIComponent(id)}/related`).then((value) => live && setRelated(value)).catch(() => {});
    }).catch((cause) => { if (!live) return; if (cause instanceof RequestError && cause.status === 404) setItem(null); else setError(errorMessage(cause)); });
    return () => { live = false; };
  }, [kind, id]);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (item === undefined) return <Loading />;
  if (item === null) return <Empty page icon={SearchX} title="This information is unavailable">
    <p>It may have been withdrawn or the link may be wrong.</p><Link className="button primary" to={section.path}>Browse {section.plural}</Link></Empty>;

  const { fields } = item;
  const facts = fieldSpecs(kind).filter(({ key }) => !omitted.has(key));
  const display = (key: string) => {
    const spec = facts.find((entry) => entry.key === key)!;
    const value = fields[key];
    if (!value) return <span className="muted">Not provided</span>;
    if (spec.type === "tags") return splitTags(value).map((tag) => optionLabel(spec.options, tag) ?? tag).join(", ");
    if (spec.type === "select") return optionLabel(spec.options, value) ?? value;
    if (spec.type === "url") return <a href={value} target="_blank" rel="noopener noreferrer">{value}</a>;
    return value;
  };
  const destinations = related.destination ?? [];

  return <div>
    <nav className="breadcrumb" aria-label="Breadcrumb"><Link to={section.path}>{section.label}</Link> / <span aria-current="page">{fields.title}</span></nav>
    <div className="detail">
      <article>
        <Media item={item} large />
        <div className="tags"><ProvenanceBadge fields={fields} /><StatusBadge item={item} /></div>
        <h1 style={{ marginTop: 10 }}>{fields.title}</h1>
        <div className="meta" style={{ marginBottom: 14 }}>
          {subtitle(item) && <span><MapPin size={16} aria-hidden="true" />{subtitle(item)}</span>}
          {kind === "event" && <span><CalendarDays size={16} aria-hidden="true" />{formatWhen(fields.startsAt, fields.endsAt)}</span>}
        </div>
        {kind === "event" && fields.status === "postponed" && <Notice tone="warn" title="This event is postponed.">The date shown is the latest published date. Check with the organiser before travelling.</Notice>}
        {kind === "event" && fields.status === "cancelled" && <Notice tone="error" title="This event is cancelled.">Choose another event for your trip.</Notice>}
        <p style={{ fontSize: 18 }}>{fields.summary || <span className="muted">A description is not available yet.</span>}</p>
        {fields.details && <p>{fields.details}</p>}
        <h2 style={{ marginTop: 24 }}>Details</h2>
        <dl className="facts">{facts.filter(({ key }) => key !== "details").map(({ key, label }) => <div key={key} style={{ display: "contents" }}><dt>{label}</dt><dd>{display(key)}</dd></div>)}
          {destinations.length > 0 && <><dt>{kind === "event" ? "Hosted at" : "Destination"}</dt><dd>{destinations.map((destination, index) =>
            <span key={destination.id}>{index ? ", " : ""}<Link to={detailPath("destination", destination.id)}>{destination.fields.title}</Link></span>)}</dd></>}
        </dl>
      </article>
      <aside className="aside" aria-label="Plan and book">
        <div className="panel stack" style={{ gap: 12 }}>
          <h2 style={{ fontSize: 20, margin: 0 }}>Plan</h2>
          {kind === "visitor" ? <p className="small muted">Guidance cannot be added to a trip, but it appears on related destinations.</p>
            : <div className="row"><AddButton item={item} /><CompareToggle item={item} /></div>}
          <ProviderHandoff item={item} />
        </div>
        <div className="panel"><h2 style={{ fontSize: 16, margin: "0 0 6px" }}>About this information</h2><SourceNote fields={fields} /></div>
      </aside>
    </div>
    {kind === "destination" && <section style={{ marginTop: 40 }} aria-labelledby="related">
      <h2 id="related">Around {fields.title}</h2>
      {relatedOrder.every((other) => !related[other]?.length) && <p className="muted">No linked stays, transport, food, events or guidance are published for this destination yet.</p>}
      {relatedOrder.map((other) => related[other]?.length ? <div key={other} className="section">
        <h3>{sections.find((entry) => entry.kind === other)!.label}</h3>
        <div className="grid">{related[other]!.map((entry) => <ResultCard key={entry.id} item={entry} />)}</div></div> : null)}
    </section>}
  </div>;
}
