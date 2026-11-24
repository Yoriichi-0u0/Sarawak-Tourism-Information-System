import { useId, useEffect, useMemo, useState, type FormEvent } from "react";
import { CalendarDays, MapPin, SearchX, SlidersHorizontal, Tag, Wallet } from "lucide-react";

import { api, errorMessage } from "../../lib/api";
import { options, type Option } from "../../shared/catalogue";
import type { RecordKind, TourismItem } from "../../shared/contracts";
import { CompareToggle, CompareTray } from "../compare";
import { detailPath, sectionFor } from "../kinds";
import { Link, navigate, useLocation } from "../router";
import { AddButton } from "../trips";
import { Empty, formatWhen, label, Loading, Media, Notice, ProvenanceBadge, StatusBadge, subtitle, useTitle } from "../ui";

type Filter = { key: string; label: string; type: "text" | "select" | "tags" | "date"; options?: readonly Option[]; placeholder?: string };
const query: Filter = { key: "query", label: "Name", type: "text", placeholder: "Search by name" };
const location: Filter = { key: "location", label: "Location", type: "text", placeholder: "e.g. Kuching" };
export const filters: Partial<Record<RecordKind, Filter[]>> = {
  destination: [query, location, { key: "interest", label: "Interest", type: "text", placeholder: "e.g. Nature, Culture, Adventure" }],
  accommodation: [query, location, { key: "type", label: "Type", type: "select", options: options.accommodationType },
    { key: "price", label: "Price level (indicative)", type: "select", options: options.priceGuide },
    { key: "accessibility", label: "Accessibility needs", type: "tags", options: options.accessibility },
    { key: "amenities", label: "Amenities", type: "tags", options: options.amenities }],
  dining: [query, location, { key: "cuisine", label: "Cuisine", type: "text", placeholder: "e.g. Laksa, Seafood" },
    { key: "dietary", label: "Dietary requirements", type: "tags", options: options.dietary }],
  event: [query, location, { key: "from", label: "From", type: "date" }, { key: "to", label: "To", type: "date" }],
};

export function ResultCard({ item }: { item: TourismItem }) {
  const { fields } = item;
  return <article className="card" aria-labelledby={`title-${item.id}`}>
    <Media item={item} />
    <div className="card-body">
      <div className="tags"><ProvenanceBadge fields={fields} /><StatusBadge item={item} />
        {fields.priceGuide && <span className="badge neutral"><Wallet size={14} aria-hidden="true" />{label("priceGuide", fields.priceGuide)}</span>}
        {fields.interest && <span className="badge gold"><Tag size={14} aria-hidden="true" />{fields.interest}</span>}
        {fields.cuisine && <span className="badge gold">{fields.cuisine}</span>}
        {fields.mode && <span className="badge gold">{label("mode", fields.mode)}</span>}</div>
      <h3 id={`title-${item.id}`}><Link to={detailPath(item.kind, item.id)}>{fields.title}</Link></h3>
      <div className="meta">
        {subtitle(item) && <span><MapPin size={14} aria-hidden="true" />{subtitle(item)}</span>}
        {item.kind === "event" && <span><CalendarDays size={14} aria-hidden="true" />{formatWhen(fields.startsAt, fields.endsAt)}</span>}
      </div>
      {fields.summary && <p>{fields.summary.length > 160 ? `${fields.summary.slice(0, 157)}…` : fields.summary}</p>}
      <div className="card-actions"><AddButton item={item} compact /><CompareToggle item={item} /></div>
    </div>
  </article>;
}

export function DiscoverPage({ kind }: { kind: RecordKind }) {
  const section = sectionFor(kind);
  const { search } = useLocation();
  const params = search.toString();
  const [items, setItems] = useState<TourismItem[]>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const definitions = filters[kind] ?? [query];
  const collapsible = definitions.length > 3;
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterId = useId();
  useTitle(section.label);

  useEffect(() => {
    let live = true;
    setBusy(true); setError("");
    api<TourismItem[]>(`catalog/${kind}${params ? `?${params}` : ""}`)
      .then((result) => { if (live) setItems(result); })
      .catch((cause) => { if (live) { setItems(undefined); setError(errorMessage(cause)); } })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [kind, params]);

  const active = useMemo(() => [...new URLSearchParams(params).entries()].filter(([, value]) => value), [params]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = new URLSearchParams();
    const form = new FormData(event.currentTarget);
    for (const definition of definitions) {
      const value = definition.type === "tags" ? form.getAll(definition.key).join(",") : String(form.get(definition.key) ?? "").trim();
      if (value) next.set(definition.key, value);
    }
    setFiltersOpen(false);
    navigate(`${section.path}${next.size ? `?${next}` : ""}`);
  }

  const Icon = section.icon;
  return <div className="stack">
    <div><p className="eyebrow"><Icon size={16} aria-hidden="true" />{section.label}</p>
      <h1>{kind === "accommodation" ? "Find a place to stay" : kind === "dining" ? "Find food you'll love" : kind === "event" ? "Find events" : "Explore destinations"}</h1>
      <p className="muted">{section.blurb}. Every listing shows where its information comes from.</p></div>
    <div className="discover">
      <div className="filter-column">
      {collapsible && <button type="button" className="button secondary filter-toggle" aria-expanded={filtersOpen} aria-controls={filterId}
        onClick={() => setFiltersOpen(!filtersOpen)}><SlidersHorizontal size={16} aria-hidden="true" />{filtersOpen ? "Hide filters" : "Show filters"}
        {active.length > 0 && <span className="badge neutral">{active.length} active</span>}</button>}
      <form id={filterId} className="panel filters" data-collapsible={collapsible} data-open={filtersOpen} onSubmit={submit} aria-label={`Filter ${section.plural}`} key={params}>
        {definitions.map((definition) => {
          const current = new URLSearchParams(params).get(definition.key) ?? "";
          if (definition.type === "tags") return <fieldset key={definition.key}><legend>{definition.label}</legend>
            {definition.options!.map(([value, text]) => <label className="checkbox" key={value}>
              <input type="checkbox" name={definition.key} value={value} defaultChecked={current.split(",").includes(value)} />{text}</label>)}
          </fieldset>;
          if (definition.type === "select") return <label className="field" key={definition.key}>{definition.label}
            <select name={definition.key} defaultValue={current}><option value="">Any</option>
              {definition.options!.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>;
          return <label className="field" key={definition.key}>{definition.label}
            <input type={definition.type === "date" ? "date" : "search"} name={definition.key} defaultValue={current} placeholder={definition.placeholder} maxLength={200} /></label>;
        })}
        <div className="filter-actions"><button className="button primary">Search</button>
          {active.length > 0 && <button type="button" className="button ghost" onClick={() => navigate(section.path)}>Clear</button>}</div>
      </form>
      </div>
      <div>
        <div className="results-bar">
          <p role="status" style={{ margin: 0 }}>{busy ? "Searching…" : items ? `${items.length} ${items.length === 1 ? section.singular : section.plural} found` : ""}</p>
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        {busy && !items && <Loading />}
        {!busy && items?.length === 0 && <Empty icon={SearchX} title={`No ${section.plural} match these filters`}>
          <p>Try fewer filters or a different spelling.</p>
          <button className="button secondary" onClick={() => navigate(section.path)}>Clear all filters</button>
        </Empty>}
        {items && items.length > 0 && <h2 className="sr-only">Results</h2>}
        <div className="grid">{items?.map((item) => <ResultCard key={item.id} item={item} />)}</div>
        <CompareTray kind={kind} />
      </div>
    </div>
  </div>;
}
