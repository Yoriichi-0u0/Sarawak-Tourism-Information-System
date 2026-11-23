import { useEffect, useState } from "react";
import { Info, PhoneCall, SearchX } from "lucide-react";

import { api, errorMessage } from "../../lib/api";
import { options } from "../../shared/catalogue";
import type { TourismItem } from "../../shared/contracts";
import { detailPath } from "../kinds";
import { Link, navigate, useLocation } from "../router";
import { Empty, ExternalLink, label, Loading, Notice, ProvenanceBadge, SourceNote, useTitle } from "../ui";

export function VisitorInfoPage() {
  const { search } = useLocation();
  const category = search.get("category") ?? "";
  const destination = search.get("destination") ?? "";
  const [items, setItems] = useState<TourismItem[]>();
  const [urgent, setUrgent] = useState<TourismItem[]>([]);
  const [destinations, setDestinations] = useState<TourismItem[]>([]);
  const [error, setError] = useState("");
  useTitle("Visitor information");

  useEffect(() => {
    void api<TourismItem[]>("catalog/visitor?category=emergency").then(setUrgent).catch(() => setUrgent([]));
    void api<TourismItem[]>("catalog/destination").then(setDestinations).catch(() => setDestinations([]));
  }, []);
  useEffect(() => {
    let live = true;
    setItems(undefined);
    const query = new URLSearchParams({ ...(category ? { category } : {}), ...(destination ? { destination } : {}) });
    void api<TourismItem[]>(`catalog/visitor${query.size ? `?${query}` : ""}`).then((result) => live && setItems(result)).catch((cause) => live && setError(errorMessage(cause)));
    return () => { live = false; };
  }, [category, destination]);
  const go = (next: Record<string, string>) => {
    const query = new URLSearchParams(Object.entries({ category, destination, ...next }).filter(([, value]) => value));
    navigate(`/visitor-info${query.size ? `?${query}` : ""}`);
  };
  const place = destinations.find(({ id }) => id === destination)?.fields.title;

  return <div className="stack">
    <div><p className="eyebrow"><Info size={16} aria-hidden="true" />Visitor info</p><h1>Travel safely in Sarawak</h1>
      <p className="muted">Practical guidance on safety, entry, health, accessibility and local customs, with links to the authorities who issue it.</p></div>
    {urgent.map((item) => <div className="notice error" key={item.id} role="region" aria-label="Emergency">
      <PhoneCall size={22} aria-hidden="true" /><div><strong style={{ fontSize: 18 }}>{item.fields.title}</strong><p style={{ margin: 0 }}>{item.fields.summary}</p></div></div>)}
    <div className="panel stack" style={{ gap: 12 }}>
      <fieldset><legend>Topic</legend><div className="row" role="group">
        <button className={`button small ${!category ? "primary" : "secondary"}`} aria-pressed={!category} onClick={() => go({ category: "" })}>All topics</button>
        {options.guidanceCategory.map(([value, text]) => <button key={value} className={`button small ${category === value ? "primary" : "secondary"}`}
          aria-pressed={category === value} onClick={() => go({ category: value })}>{text}</button>)}
      </div></fieldset>
      <label className="field" style={{ maxWidth: 360 }}>For a destination
        <select value={destination} onChange={(event) => go({ destination: event.target.value })}>
          <option value="">Anywhere in Sarawak</option>{destinations.map(({ id, fields }) => <option key={id} value={id}>{fields.title}</option>)}</select></label>
    </div>
    {error && <Notice tone="error">{error}</Notice>}
    {!items && !error && <Loading />}
    {items?.length === 0 && <Empty icon={SearchX} title="Information unavailable">
      <p>STIS does not hold {category ? `${label("guidanceCategory", category).toLowerCase()} ` : ""}guidance{place ? ` for ${place}` : ""} yet. Check with the destination operator or the relevant authority.</p>
      <button className="button secondary" onClick={() => navigate("/visitor-info")}>Show all guidance</button></Empty>}
    <div className="grid">{items?.map((item) => <article className="card" key={item.id} aria-labelledby={`guidance-${item.id}`}>
      <div className="card-body">
        <div className="tags"><span className="badge gold">{label("guidanceCategory", item.fields.guidanceCategory)}</span>
          {item.fields.priority === "urgent" && <span className="badge danger">Urgent</span>}<ProvenanceBadge fields={item.fields} /></div>
        <h3 id={`guidance-${item.id}`}><Link to={detailPath("visitor", item.id)}>{item.fields.title}</Link></h3>
        <p style={{ color: "var(--ink)" }}>{item.fields.summary}</p>
        {item.fields.details && <p>{item.fields.details}</p>}
        <SourceNote fields={item.fields} />
        {item.fields.provider && <div className="card-actions"><ExternalLink href={item.fields.provider} className="button secondary small">{item.fields.authority || "Authority guidance"}</ExternalLink></div>}
      </div></article>)}</div>
  </div>;
}
