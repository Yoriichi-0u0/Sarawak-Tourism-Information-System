import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, CalendarDays, ChevronRight, Copy, MapPin, RefreshCw, TriangleAlert } from "lucide-react";

import { api, errorMessage } from "./client";
import { conflictDetails } from "./conflicts";
import type { ReviewedPlan, TourismItem } from "./contracts";
import { describePlanChanges, isStale } from "./recovery";

export type GuestLink = { id: string; guest: string };
type DateInput = { date: string; provisional: boolean };

export function readLink(): GuestLink | undefined {
  const match = /^#itinerary\/([\w-]{1,70})\/([\w-]{43})$/.exec(location.hash);
  return match ? { id: match[1], guest: match[2] } : undefined;
}

function storeLink(link?: GuestLink) {
  const locationWithoutHash = location.pathname + location.search;
  const fragment = link ? `#itinerary/${link.id}/${link.guest}` : "";
  history.replaceState(null, "", locationWithoutHash + fragment);
}

export function Planner({ selection, clearSelection, browse }: {
  selection?: TourismItem; clearSelection: () => void; browse: () => void;
}) {
  const [link, setLink] = useState(readLink);
  const [plan, setPlan] = useState<ReviewedPlan>();
  const [busy, setBusy] = useState(() => Boolean(readLink()));
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState<string>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [dateInput, setDateInput] = useState<DateInput>();
  const [saved, setSaved] = useState<ReviewedPlan>();
  const savedNotice = useRef<HTMLElement>(null);
  const unsavedInput = Boolean(dateInput || editing || (selection && (start || end)));
  const locked = busy || Boolean(saved);

  useEffect(() => { if (saved) savedNotice.current?.focus(); }, [saved]);

  async function run(operation: () => Promise<void>, feedback = "") {
    setError("");
    setMessage("");
    setBusy(true);
    try { await operation(); setMessage(feedback); } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    function openLink() {
      const next = readLink();
      setLink(next);
      setPlan(undefined);
      setSaved(undefined);
      setDateInput(undefined);
      setBusy(Boolean(next));
      setError("");
      setMessage("");
    }
    window.addEventListener("hashchange", openLink);
    return () => window.removeEventListener("hashchange", openLink);
  }, []);

  useEffect(() => {
    if (!link) return;
    setBusy(true);
    let live = true;
    void api<ReviewedPlan>(`itineraries/${link.id}`, { guest: link.guest })
      .then((value) => { if (live) setPlan(value); })
      .catch((cause: unknown) => { if (live) setError(errorMessage(cause)); })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [link]);

  function edit(change: unknown, feedback: string, finished?: () => void) {
    if (!plan || !link) return;
    setError("");
    setMessage("");
    setBusy(true);
    void (async () => {
      try {
        const value = await api<ReviewedPlan>(`itineraries/${link.id}`, {
          method: "PUT", guest: link.guest, body: { change, revision: plan.revision },
        });
        setPlan(value);
        finished?.();
        setMessage(feedback);
      } catch (cause) {
        if (!isStale(cause)) { setError(errorMessage(cause)); return; }
        try { setSaved(await api<ReviewedPlan>(`itineraries/${link.id}`, { guest: link.guest })); }
        catch (reload) { setError(errorMessage(reload)); }
      } finally { setBusy(false); }
    })();
  }

  function loadSaved(discard: boolean) {
    if (!saved) return;
    setPlan(saved);
    setSaved(undefined);
    setError("");
    if (discard) {
      setDateInput(undefined);
      setEditing(undefined);
      setStart("");
      setEnd("");
    }
    setMessage(discard ? "Loaded the saved itinerary." : "Loaded the saved itinerary. Your unsaved input is kept; review it, then try again.");
  }

  function submitDate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const settings = dateInput ?? { date: plan?.date ?? "", provisional: plan?.provisional ?? true };
    if (plan) {
      edit({ action: "date", ...settings }, "Travel date updated.", () => setDateInput(undefined));
      return;
    }
    void run(async () => {
      const result = await api<{ plan: ReviewedPlan; guest: string }>("itineraries", { method: "POST", body: settings });
      const access = { id: result.plan.id, guest: result.guest };
      storeLink(access);
      setPlan(result.plan);
      setLink(access);
      setDateInput(undefined);
    }, "Itinerary created.");
  }

  function clearPlan() {
    storeLink();
    setLink(undefined);
    setPlan(undefined);
    setSaved(undefined);
    setDateInput(undefined);
    setConfirmDelete(false);
    setError("");
  }

  const shownDate = dateInput ?? { date: plan?.date ?? "", provisional: plan?.provisional ?? true };
  const { pairs, partners } = conflictDetails(plan);

  return <div className="as03-stack">
    <div className="as03-row as03-section-title">
      <div><p className="as03-meta"><CalendarDays size={18} /> Trip planner</p><h1>Your itinerary</h1></div>
      {link && plan && <button className="as03-outline" onClick={() => {
        void run(() => navigator.clipboard.writeText(location.href), "Guest link copied.");
      }}><Copy size={16} /> Copy guest link</button>}
    </div>
    {error && <p className="as03-error" role="alert">{error}</p>}
    {message && <p className="as03-success" role="status">{message}</p>}
    {plan && saved && <section className="as03-stale" role="alert" aria-labelledby="as03-stale-plan" tabIndex={-1} ref={savedNotice}>
      <h2 id="as03-stale-plan">This itinerary changed in another window or tab</h2>
      <p>Your last change was not saved. The saved itinerary is now at revision {saved.revision}:</p>
      <ul>{describePlanChanges(plan, saved).map((change) => <li key={change}>{change}</li>)}</ul>
      {unsavedInput && <p>Your unsaved input is still in the form below.</p>}
      <div className="as03-row">
        <button className="as03-button" onClick={() => loadSaved(false)}>{unsavedInput ? "Load saved version and keep my input" : "Load saved version"}</button>
        {unsavedInput && <button className="as03-outline" onClick={() => loadSaved(true)}>Load saved version and discard my input</button>}
      </div>
    </section>}
    {link && !plan && <div className="as03-panel">
      {busy ? <p role="status">Opening itinerary…</p> : <button className="as03-outline" onClick={clearPlan}>Start another itinerary</button>}
    </div>}
    {(!link || plan) && <form className="as03-panel as03-dateform" onSubmit={submitDate}>
      <label>Travel date<input type="date" name="date" required value={shownDate.date}
        onChange={(event) => setDateInput({ ...shownDate, date: event.target.value })} /></label>
      <label className="as03-check"><input type="checkbox" name="provisional" checked={shownDate.provisional}
        onChange={(event) => setDateInput({ ...shownDate, provisional: event.target.checked })} /> Provisional date</label>
      <button className="as03-button" disabled={locked}>{plan ? "Update date" : "Create itinerary"}</button>
    </form>}
    {selection && <section className="as03-panel">
      <p className="as03-tag">Selected for planning</p><h2>{selection.fields.title}</h2>
      {plan ? <form className="as03-dateform" onSubmit={(event) => {
        event.preventDefault();
        edit({ action: "add", recordId: selection.id, start, end }, "Entry added.", () => {
          setStart(""); setEnd(""); clearSelection();
        });
      }}>
        <label>Start time<input type="time" value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <label>End time<input type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
        <button className="as03-button" disabled={locked}>Add entry</button>
      </form> : <p>Create your itinerary to add this selection.</p>}
    </section>}
    {plan && <>
      <div className="as03-row">
        <h2>Planned stops</h2>
        <button className="as03-outline" disabled={locked} onClick={() => {
          if (!link) return;
          void run(async () => setPlan(await api<ReviewedPlan>(`itineraries/${link.id}`, { guest: link.guest })), "Itinerary refreshed.");
        }}><RefreshCw size={16} /> Refresh status</button>
      </div>
      {pairs.length > 0 && <section role="alert" className="as03-conflicts" aria-labelledby="as03-conflict-title">
        <h3 id="as03-conflict-title"><TriangleAlert size={18} aria-hidden="true" /> {pairs.length} time conflict{pairs.length === 1 ? "" : "s"}. Adjust the overlapping stops.</h3>
        <ul>{pairs.map(({ first, second }) => <li key={`${first.id}:${second.id}`}>
          <strong>{first.title}</strong> ({first.interval}) overlaps <strong>{second.title}</strong> ({second.interval}).
        </li>)}</ul>
      </section>}
      {!plan.entries.length && <p>Browse destinations or events to add your first stop.</p>}
      <ol className="as03-entries">
        {plan.entries.map((entry, index) => {
          const clashes = partners.get(entry.id);
          return <li key={entry.id} className={clashes ? "as03-panel as03-conflict" : "as03-panel"} aria-label={entry.title}
            aria-describedby={clashes ? `as03-conflict-${entry.id}` : undefined}>
          <p className="as03-meta">{entry.start ? `${entry.start}–${entry.end} MYT` : "Time undecided"}</p>
          {clashes && <p className="as03-conflict-note" id={`as03-conflict-${entry.id}`}>
            <TriangleAlert size={16} aria-hidden="true" /> Time conflict: overlaps {clashes.map(({ title, interval }) => `${title} (${interval})`).join("; ")}
          </p>}
          <h3>{entry.title}</h3>
          {entry.location && <p className="as03-meta"><MapPin size={16} aria-hidden="true" /> {entry.location}</p>}
          {entry.notice && <p className="as03-status">{entry.notice === "unavailable" ? "Current information unavailable" : `Event ${entry.notice}`}</p>}
          {editing === entry.id ? <form className="as03-dateform" onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            edit({ action: "update", entryId: entry.id, start: data.get("start"), end: data.get("end") }, "Entry updated.", () => setEditing(undefined));
          }}>
            <label>Start time<input type="time" name="start" defaultValue={entry.start} /></label>
            <label>End time<input type="time" name="end" defaultValue={entry.end} /></label>
            <button className="as03-button" disabled={locked}>Save time</button>
            <button className="as03-text-button" type="button" onClick={() => setEditing(undefined)}>Cancel</button>
          </form> : <div className="as03-row">
            <button className="as03-outline" disabled={locked} onClick={() => setEditing(entry.id)}>Edit time</button>
            <button className="as03-outline" disabled={locked || index === 0} aria-label="Move up" onClick={() => edit({ action: "move", entryId: entry.id, position: index - 1 }, "Entry moved.")}><ArrowUp size={16} /></button>
            <button className="as03-outline" disabled={locked || index === plan.entries.length - 1} aria-label="Move down" onClick={() => edit({ action: "move", entryId: entry.id, position: index + 1 }, "Entry moved.")}><ArrowDown size={16} /></button>
            <button className="as03-text-button" disabled={locked} onClick={() => edit({ action: "remove", entryId: entry.id }, "Entry removed.")}>Remove</button>
          </div>}
        </li>;
        })}
      </ol>
      <div className="as03-row">
        <button className="as03-button" onClick={browse}>Explore destinations <ChevronRight size={17} /></button>
        <button className="as03-text-button" disabled={locked} onClick={() => setConfirmDelete(true)}>Delete itinerary</button>
      </div>
      {confirmDelete && <div className="as03-panel as03-row">
        <p>Delete this itinerary and all its entries?</p>
        <button className="as03-button" disabled={busy} onClick={() => {
          if (!link) return;
          void run(async () => {
            await api(`itineraries/${link.id}`, { method: "DELETE", guest: link.guest });
            clearPlan();
          }, "Itinerary deleted.");
        }}>Confirm deletion</button>
        <button className="as03-outline" onClick={() => setConfirmDelete(false)}>Keep itinerary</button>
      </div>}
    </>}
  </div>;
}
