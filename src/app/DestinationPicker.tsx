import { useId, useState } from "react";

import { matchingOptions, selectedIds, selectionSummary, toggleDestination } from "../lib/destinationSelection";
import type { DestinationOption } from "../lib/destinationSelection";

export function DestinationPicker({ options, value, onChange, hintId, errorId, invalid = false }: {
  options: DestinationOption[]; value: string; onChange: (value: string) => void;
  hintId?: string; errorId?: string; invalid?: boolean;
}) {
  const [query, setQuery] = useState("");
  const listId = useId();
  const selected = selectedIds(value);
  const shown = matchingOptions(options, query);
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return <fieldset className="destination-picker" aria-describedby={describedBy} data-invalid={invalid || undefined}>
    <legend>Related destinations</legend>
    <label className="destination-search field">Search destinations<input type="search" value={query} placeholder="e.g. Bako" autoComplete="off"
      aria-controls={listId} onChange={(event) => setQuery(event.target.value)}
      onKeyDown={(event) => { if (event.key === "Escape" && query) { event.preventDefault(); setQuery(""); } }} /></label>
    <p className="small muted" role="status">{selectionSummary(selected.length)}</p>
    <ul className="destination-list" id={listId}>
      {shown.map(({ id, title }) => <li key={id}><label>
        <input type="checkbox" value={id} checked={selected.includes(id)} onChange={(event) => onChange(toggleDestination(value, id, event.target.checked))} />
        <span>{title}</span>
      </label></li>)}
    </ul>
    {!shown.length && <p className="small muted">No destinations match “{query.trim()}”. Clear the search to see all destinations.</p>}
  </fieldset>;
}
