import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, Bus, Car, Clock, Plane, Route, Sailboat, SearchX } from "lucide-react";

import { api, errorMessage } from "../../lib/api";
import { legDirections } from "../../lib/directions";
import { options } from "../../shared/catalogue";
import type { TourismItem } from "../../shared/contracts";
import { CompareTray } from "../compare";
import { detailPath } from "../kinds";
import { Link, navigate, useLocation } from "../router";
import { AddButton } from "../trips";
import { Empty, ExternalLink, label, Loading, Notice, ProvenanceBadge, useTitle } from "../ui";
import { ResultCard } from "./Discover";

type Leg = { record: TourismItem; from: string; to: string; reversed: boolean };
type Journeys = { direct: Leg[]; connections: [Leg, Leg][]; alternatives: Leg[] };
const modeIcon = (mode: string) => mode === "flight" ? Plane : mode === "boat" ? Sailboat : mode === "ride-hailing" || mode === "taxi" ? Car : Bus;

function LegView({ leg }: { leg: Leg }) {
  const { fields } = leg.record;
  const Icon = modeIcon(fields.mode);
  const directions = legDirections(fields.mode, leg.from, leg.to);
  return <div className="leg">
    <span className="leg-icon"><Icon size={20} aria-hidden="true" /></span>
    <div>
      <p style={{ margin: 0 }}><strong>{leg.from}</strong> <ArrowRight size={14} aria-hidden="true" /><span className="sr-only">to</span> <strong>{leg.to}</strong></p>
      <p className="small" style={{ margin: "2px 0" }}><Link to={detailPath("transportation", leg.record.id)}>{fields.title}</Link> · {label("mode", fields.mode)} · {fields.operator}</p>
      <div className="tags">
        <ProvenanceBadge fields={fields} />
        {fields.scheduleStatus && <span className="badge neutral"><Clock size={14} aria-hidden="true" />{label("scheduleStatus", fields.scheduleStatus)}</span>}
        {fields.duration && <span className="badge neutral">{fields.duration}</span>}
      </div>
      {fields.schedule && <p className="small muted" style={{ margin: "6px 0 0" }}>{fields.schedule}</p>}
      <div className="card-actions"><AddButton item={leg.record} compact />
        {directions && <ExternalLink href={directions} className="button secondary small">Directions in Google Maps</ExternalLink>}</div>
    </div>
  </div>;
}

export function TransportPage() {
  const { search } = useLocation();
  const from = search.get("from") ?? "";
  const to = search.get("to") ?? "";
  const mode = search.get("mode") ?? "";
  const [places, setPlaces] = useState<string[]>([]);
  const [journeys, setJourneys] = useState<Journeys>();
  const [all, setAll] = useState<TourismItem[]>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useTitle("Getting around");

  useEffect(() => { void api<string[]>("places").then(setPlaces).catch(() => setPlaces([])); }, []);
  useEffect(() => {
    let live = true;
    void api<TourismItem[]>(`catalog/transportation${mode ? `?mode=${encodeURIComponent(mode)}` : ""}`).then((items) => live && setAll(items)).catch((cause) => live && setError(errorMessage(cause)));
    return () => { live = false; };
  }, [mode]);
  useEffect(() => {
    if (!from || !to) { setJourneys(undefined); return; }
    let live = true;
    setBusy(true); setError("");
    void api<Journeys>(`journeys?${new URLSearchParams({ from, to })}`).then((result) => live && setJourneys(result))
      .catch((cause) => live && setError(errorMessage(cause))).finally(() => live && setBusy(false));
    return () => { live = false; };
  }, [from, to]);

  function plan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next = new URLSearchParams({ from: String(form.get("from") ?? "").trim(), to: String(form.get("to") ?? "").trim() });
    if (mode) next.set("mode", mode);
    navigate(`/transport?${next}`);
  }

  const nothing = journeys && !journeys.direct.length && !journeys.connections.length;
  return <div className="stack">
    <div><p className="eyebrow"><Route size={16} aria-hidden="true" />Getting around</p><h1>Plan a journey</h1>
      <p className="muted">Enter where you start and where you want to go. STIS lists transport options from operators and travel sources; it does not show live timetables or sell tickets.</p></div>
    <form className="panel" onSubmit={plan} aria-label="Plan a journey" key={`${from}|${to}`}>
      <datalist id="places">{places.map((place) => <option key={place} value={place} />)}</datalist>
      <div className="editor-grid" style={{ gridTemplateColumns: "1fr 1fr auto", alignItems: "end" }}>
        <label className="field">From<input type="search" name="from" list="places" defaultValue={from} required maxLength={100} placeholder="e.g. Kuching city centre" /></label>
        <label className="field">To<input type="search" name="to" list="places" defaultValue={to} required maxLength={100} placeholder="e.g. Bako National Park" /></label>
        <button className="button primary">Find options</button>
      </div>
    </form>
    {error && <Notice tone="error">{error}</Notice>}
    {busy && <Loading text="Finding transport options…" />}
    {journeys && <section className="stack" aria-labelledby="journey-results">
      <h2 id="journey-results">Options from {from} to {to}</h2>
      {journeys.direct.length > 0 && <div className="panel journey"><h3>Direct</h3>{journeys.direct.map((leg) => <LegView key={`${leg.record.id}${leg.reversed}`} leg={leg} />)}</div>}
      {journeys.connections.map(([first, second], index) => <div className="panel journey" key={`${first.record.id}-${second.record.id}`}>
        <h3>Option {journeys.direct.length + index + 1}: two stages via {first.to}</h3>
        <LegView leg={first} /><LegView leg={second} /></div>)}
      {nothing && <Notice tone="warn" title="No direct or two-stage route is listed for this journey.">
        {journeys.alternatives.length ? <p>Other services reach places matching “{to}”. They may help as part of your journey.</p> : <p>Try a nearby town or a different spelling, or ask a local operator.</p>}
      </Notice>}
      {journeys.alternatives.length > 0 && <div className="panel journey"><h3>Other options toward {to}</h3>
        {journeys.alternatives.map((leg) => <LegView key={leg.record.id} leg={leg} />)}</div>}
    </section>}
    <section className="stack" aria-labelledby="all-transport">
      <div className="spread"><h2 id="all-transport">All transport options</h2>
        <label className="field" style={{ minWidth: 200 }}>Type
          <select value={mode} onChange={(event) => navigate(`/transport?${new URLSearchParams({ ...(from && to ? { from, to } : {}), ...(event.target.value ? { mode: event.target.value } : {}) })}`)}>
            <option value="">All types</option>{options.mode.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label></div>
      {all?.length === 0 && <Empty icon={SearchX} title="No transport options of this type"><p>Choose another type.</p></Empty>}
      <div className="grid">{all?.map((item) => <ResultCard key={item.id} item={item} />)}</div>
      <CompareTray kind="transportation" />
    </section>
  </div>;
}
