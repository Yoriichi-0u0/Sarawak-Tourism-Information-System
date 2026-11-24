import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { Columns3, Scale, X } from "lucide-react";

import { fieldSpecs, optionLabel, splitTags } from "../shared/catalogue";
import type { RecordKind, TourismItem } from "../shared/contracts";
import { detailPath, sectionFor } from "./kinds";
import { Link } from "./router";
import { AddButton } from "./trips";
import { Empty, ProvenanceBadge, useTitle } from "./ui";

type CompareState = { selected: TourismItem[]; toggle: (item: TourismItem) => void; clear: () => void; remove: (id: string) => void };
const CompareContext = createContext<CompareState | undefined>(undefined);
export const comparable = (kind: RecordKind) => kind !== "visitor";

export function CompareProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<TourismItem[]>([]);
  const value = useMemo<CompareState>(() => ({
    selected,
    toggle: (item) => setSelected((current) => current.some(({ id }) => id === item.id)
      ? current.filter(({ id }) => id !== item.id)
      : [...current.filter(({ kind }) => kind === item.kind).slice(-2), item]),
    clear: () => setSelected([]),
    remove: (id) => setSelected((current) => current.filter((item) => item.id !== id)),
  }), [selected]);
  return <CompareContext.Provider value={value}>{children}</CompareContext.Provider>;
}

export function useCompare() {
  const value = useContext(CompareContext);
  if (!value) throw new Error("useCompare must be used inside CompareProvider.");
  return value;
}

export function CompareToggle({ item }: { item: TourismItem }) {
  const { selected, toggle } = useCompare();
  if (!comparable(item.kind)) return null;
  const pressed = selected.some(({ id }) => id === item.id);
  return <button className="button ghost small" aria-pressed={pressed} onClick={() => toggle(item)}>
    <Scale size={16} aria-hidden="true" />{pressed ? "Comparing" : "Compare"}<span className="sr-only">: {item.fields.title}</span>
  </button>;
}

export function CompareTray({ kind }: { kind: RecordKind }) {
  const { selected, clear } = useCompare();
  const items = selected.filter((item) => item.kind === kind);
  if (!items.length) return null;
  return <div className="compare-tray" role="region" aria-label="Comparison">
    <p style={{ margin: 0 }}><strong>{items.length} selected</strong> <span className="muted">· {items.map(({ fields }) => fields.title).join(", ")}</span></p>
    <div className="row">
      {items.length < 2 && <span className="small muted">Select at least two to compare (up to three).</span>}
      <Link className={`button primary small${items.length < 2 ? " disabled" : ""}`} to={`/compare/${kind}`} aria-disabled={items.length < 2}
        onClick={(event) => { if (items.length < 2) event.preventDefault(); }}><Columns3 size={16} aria-hidden="true" />Compare</Link>
      <button className="button ghost small" onClick={clear}>Clear</button>
    </div>
  </div>;
}

function display(kind: RecordKind, key: string, value: string | undefined) {
  const spec = fieldSpecs(kind).find((entry) => entry.key === key);
  if (!value) return <span className="muted">Not provided</span>;
  if (spec?.type === "tags") return splitTags(value).map((tag) => optionLabel(spec.options, tag) ?? tag).join(", ");
  if (spec?.type === "select") return optionLabel(spec.options, value) ?? value;
  return value;
}

const hidden = new Set(["title", "image", "provider", "sourceName", "sourceUrl", "reviewedOn", "provenance", "destinationIds", "summary"]);

export function ComparePage({ kind }: { kind: RecordKind }) {
  const { selected, remove } = useCompare();
  const items = selected.filter((item) => item.kind === kind);
  const section = sectionFor(kind);
  useTitle(`Compare ${section.plural}`);
  if (items.length < 2) return <Empty page icon={Scale} title="Choose two or three to compare">
    <p>Use “Compare” on {section.plural} results, then return here.</p>
    <Link className="button primary" to={section.path}>Browse {section.plural}</Link>
  </Empty>;
  const rows = fieldSpecs(kind).filter(({ key }) => !hidden.has(key));
  return <div className="stack">
    <div><p className="eyebrow"><Scale size={16} aria-hidden="true" />Compare</p><h1>Compare {section.plural}</h1></div>
    <div className="table-scroll">
      <table className="compare-table">
        <caption className="sr-only">Comparison of {items.length} {section.plural}</caption>
        <thead><tr><td />{items.map((item) => <th scope="col" key={item.id}>
          <Link to={detailPath(kind, item.id)}>{item.fields.title}</Link>
          <div style={{ marginTop: 8 }}><button className="button ghost small" onClick={() => remove(item.id)}><X size={14} aria-hidden="true" />Remove<span className="sr-only"> {item.fields.title}</span></button></div>
        </th>)}</tr></thead>
        <tbody>
          <tr><th scope="row">Information</th>{items.map((item) => <td key={item.id}><ProvenanceBadge fields={item.fields} /></td>)}</tr>
          <tr><th scope="row">About</th>{items.map((item) => <td key={item.id}>{display(kind, "summary", item.fields.summary)}</td>)}</tr>
          {rows.map((row) => <tr key={row.key}><th scope="row">{row.label}</th>
            {items.map((item) => <td key={item.id}>{display(kind, row.key, item.fields[row.key])}</td>)}</tr>)}
          <tr><th scope="row">Plan</th>{items.map((item) => <td key={item.id}><AddButton item={item} compact /></td>)}</tr>
        </tbody>
      </table>
    </div>
  </div>;
}
