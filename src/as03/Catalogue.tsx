import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { ArrowUpRight, MapPin, Plus, Search } from "lucide-react";

import Modal from "../components/Modal";
import { safeProvider } from "../domain";
import { CardMedia } from "./cardMedia";
import { api, errorMessage } from "./client";
import { destinationInterests } from "./contracts";
import type { TourismItem } from "./contracts";
import { displayValue } from "./fieldPresentation";

export function Catalogue({ mode, select }: {
  mode: "destinations" | "events";
  select: (item: TourismItem) => void;
}) {
  const [items, setItems] = useState<TourismItem[]>();
  const [interests, setInterests] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [detail, setDetail] = useState<TourismItem>();
  const [compared, setCompared] = useState<TourismItem[]>([]);
  const [showComparison, setShowComparison] = useState(false);
  const destinations = mode === "destinations";
  const interestListId = useId();

  const search = useCallback(async (query = "") => {
    setError("");
    setBusy(true);
    try {
      const results = await api<TourismItem[]>(`${mode}${query ? `?${query}` : ""}`);
      setItems(results);
      if (destinations && !query) setInterests(destinationInterests(results));
    } catch (cause) {
      setItems(undefined);
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }, [destinations, mode]);

  useEffect(() => { void search(); }, [search]);
  const closeDetail = useCallback(() => setDetail(undefined), []);
  const closeComparison = useCallback(() => setShowComparison(false), []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const filters = new URLSearchParams();
    for (const [field, value] of new FormData(event.currentTarget)) {
      if (typeof value === "string" && value.trim()) filters.set(field, value.trim());
    }
    void search(filters.toString());
  }

  function toggle(item: TourismItem) {
    setCompared((current) => current.some((record) => record.id === item.id)
      ? current.filter((record) => record.id !== item.id)
      : [...current.slice(-2), item]);
  }

  return <>
    <form className="as03-filters as03-panel" onSubmit={submit} aria-label={`Search ${mode}`}>
      <label>Name<input name="query" placeholder={destinations ? "e.g. Bako" : "e.g. showcase"} maxLength={200} /></label>
      <label>Location<input name="location" placeholder="e.g. Kuching" maxLength={200} /></label>
      {destinations
        ? <>
          <label>Interest<input name="interest" list={interestListId} placeholder="e.g. Culture" maxLength={200} /></label>
          <datalist id={interestListId}>
            {interests.map((interest) => <option value={interest} key={interest} />)}
          </datalist>
        </>
        : <label>Visit date<input name="date" type="date" /></label>}
      <button className="as03-button" disabled={busy}><Search size={18} /> Search</button>
    </form>
    <div className="as03-row as03-results">
      <p role="status">{busy ? "Searching…" : items ? `${items.length} ${items.length === 1 ? mode.slice(0, -1) : mode} found` : ""}</p>
      {destinations && compared.length > 0 && <button className="as03-outline" onClick={() => setShowComparison(true)} disabled={compared.length < 2}>Compare ({compared.length})</button>}
    </div>
    {error && <p role="alert" className="as03-error">{error}</p>}
    {!busy && items?.length === 0 && <div className="as03-panel"><h2>No matches</h2><p>Change your filters and search again.</p></div>}
    <div className="as03-grid">
      {items?.map((item) => {
        const { title, interest, image, location, venue, startsAt, status, summary } = item.fields;
        return <article className="as03-card" key={item.id}>
          <CardMedia mode={mode} image={image} />
          <div className="as03-card-text">
            <p className="as03-tag">{interest || (status && displayValue("status", status))}</p>
            <h2>{title}</h2>
            <p className="as03-meta"><MapPin size={16} /> {location || venue}</p>
            {startsAt && <p className="as03-meta">{startsAt.replace("T", " · ")} MYT</p>}
            <p>{summary}</p>
            <div className="as03-row">
              <button className="as03-outline" onClick={() => setDetail(item)}>View details</button>
              <button className="as03-outline" onClick={() => select(item)}><Plus size={16} /> Plan</button>
              {destinations && <button className="as03-text-button" aria-pressed={compared.some((record) => record.id === item.id)} onClick={() => toggle(item)}>Compare</button>}
            </div>
          </div>
        </article>;
      })}
    </div>

    {detail && <Modal title={detail.fields.title} onClose={closeDetail}>
      <p>{detail.fields.summary || "A description is unavailable."}</p>
      <dl className="as03-description">
        {Object.entries({
          Location: detail.fields.location || detail.fields.venue,
          Interest: detail.fields.interest,
          Activities: detail.fields.activities,
          Status: detail.fields.status && displayValue("status", detail.fields.status),
          Starts: detail.fields.startsAt?.replace("T", " · "),
        }).filter(([, value]) => Boolean(value)).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}
      </dl>
      <div className="as03-row">
        <button className="as03-button" onClick={() => { closeDetail(); select(detail); }}>Add to itinerary</button>
        {detail.fields.provider && safeProvider(detail.fields.provider) && <a className="as03-outline" href={safeProvider(detail.fields.provider)!} target="_blank" rel="noopener noreferrer">External provider <ArrowUpRight size={16} /></a>}
      </div>
    </Modal>}
    {showComparison && <Modal title="Compare destinations" onClose={closeComparison} wide>
      <div className="as03-compare">{compared.map(({ id, fields }) => <article className="as03-panel" key={id}>
        <h3>{fields.title}</h3>
        <p>{fields.location} · {fields.interest}</p>
        <p>{fields.activities || "Activity details unavailable."}</p>
        <p>{fields.summary}</p>
      </article>)}</div>
    </Modal>}
  </>;
}
