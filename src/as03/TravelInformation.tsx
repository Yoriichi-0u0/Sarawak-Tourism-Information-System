import { useState } from "react";

import { safeProvider } from "../domain";
import { api, errorMessage } from "./client";
import { categories, fieldLabels, isRecordKind } from "./contracts";
import type { TourismItem } from "./contracts";

const topics = ["accommodation", "transportation", "dining", "visitor"] as const;
const hiddenFields = new Set(["title", "summary", "destinationIds", "provider"]);

export function TravelInformation() {
  const [topic, setTopic] = useState("");
  const [records, setRecords] = useState<TourismItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function read(kind: string) {
    setTopic(kind);
    setError("");
    setRecords([]);
    if (!isRecordKind(kind)) return;
    setBusy(true);
    try { setRecords(await api<TourismItem[]>(`records?kind=${kind}`)); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }

  return <section className="as03-panel as03-travel" aria-label="Travel information">
    <h2>Travel information</h2>
    <label className="as03-field">Browse published information<select value={topic} disabled={busy} onChange={(e) => { void read(e.target.value); }}>
      <option value="">Choose a category</option>
      {topics.map((kind) => <option key={kind} value={kind}>{categories[kind]}</option>)}
    </select></label>
    {error && <p role="alert" className="as03-error">{error}</p>}
    {busy && <p role="status">Loading records…</p>}
    {topic && !busy && !records.length && !error && <p>No published information is available.</p>}
    {records.map(({ id, fields }) => {
      const provider = fields.provider && safeProvider(fields.provider);
      return <article className="as03-travel-record" key={id}>
        <h3>{fields.title}</h3>
        {fields.summary && <p>{fields.summary}</p>}
        <dl className="as03-description">{Object.entries(fields).filter(([key, value]) => value && !hiddenFields.has(key)).map(([key, value]) =>
          <div key={key}><dt>{fieldLabels[key]}</dt><dd>{value}</dd></div>)}</dl>
        {provider && <a href={provider} target="_blank" rel="noopener noreferrer">External provider</a>}
      </article>;
    })}
  </section>;
}
