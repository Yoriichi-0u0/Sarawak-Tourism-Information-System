import { useEffect, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, CalendarDays, ChevronRight, Copy, MapPin, RefreshCw } from "lucide-react";

import { api, errorMessage } from "./client";
import type { ReviewedPlan, TourismItem } from "./contracts";

export type GuestLink = { id: string; guest: string };

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
    void run(async () => {
      const value = await api<ReviewedPlan>(`itineraries/${link.id}`, {
        method: "PUT", guest: link.guest, body: { change, revision: plan.revision },
      });
      setPlan(value);
      finished?.();
    }, feedback);
  }

  function submitDate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const settings = { date: data.get("date"), provisional: data.get("provisional") === "on" };
    if (plan) {
      edit({ action: "date", ...settings }, "Travel date updated.");
      return;
    }
    void run(async () => {
      const result = await api<{ plan: ReviewedPlan; guest: string }>("itineraries", { method: "POST", body: settings });
      const access = { id: result.plan.id, guest: result.guest };
      storeLink(access);
      setPlan(result.plan);
      setLink(access);
    }, "Itinerary created.");
  }

  function clearPlan() {
    storeLink();
    setLink(undefined);
    setPlan(undefined);
    setConfirmDelete(false);
    setError("");
  }

  return <div className="as03-stack">
    <div className="as03-row as03-section-title">
      <div><p className="as03-meta"><CalendarDays size={18} /> Trip planner</p><h1>Your itinerary</h1></div>
      {link && plan && <button className="as03-outline" onClick={() => {
        void run(() => navigator.clipboard.writeText(location.href), "Guest link copied.");
      }}><Copy size={16} /> Copy guest link</button>}
    </div>
    {error && <p className="as03-error" role="alert">{error}</p>}
    {message && <p className="as03-success" role="status">{message}</p>}
    {link && !plan && <div className="as03-panel">
      {busy ? <p role="status">Opening itinerary…</p> : <button className="as03-outline" onClick={clearPlan}>Start another itinerary</button>}
    </div>}
    {(!link || plan) && <form className="as03-panel as03-dateform" onSubmit={submitDate} key={plan?.date ?? "new"}>
      <label>Travel date<input type="date" name="date" required defaultValue={plan?.date} /></label>
      <label className="as03-check"><input type="checkbox" name="provisional" defaultChecked={plan?.provisional ?? true} /> Provisional date</label>
      <button className="as03-button" disabled={busy}>{plan ? "Update date" : "Create itinerary"}</button>
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
        <button className="as03-button" disabled={busy}>Add entry</button>
      </form> : <p>Create your itinerary to add this selection.</p>}
    </section>}
    {plan && <>
      <div className="as03-row">
        <h2>Planned stops</h2>
        <button className="as03-outline" disabled={busy} onClick={() => {
          if (!link) return;
          void run(async () => setPlan(await api<ReviewedPlan>(`itineraries/${link.id}`, { guest: link.guest })), "Itinerary refreshed.");
        }}><RefreshCw size={16} /> Refresh status</button>
      </div>
      {plan.conflicts.length > 0 && <p role="alert" className="as03-error">{plan.conflicts.length} time conflict{plan.conflicts.length === 1 ? "" : "s"}. Adjust the overlapping stops.</p>}
      {!plan.entries.length && <p>Browse destinations or events to add your first stop.</p>}
      <ol className="as03-entries">
        {plan.entries.map((entry, index) => <li key={entry.id} className="as03-panel" aria-label={entry.title}>
          <p className="as03-meta">{entry.start ? `${entry.start}–${entry.end} MYT` : "Time undecided"}</p>
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
            <button className="as03-button" disabled={busy}>Save time</button>
            <button className="as03-text-button" type="button" onClick={() => setEditing(undefined)}>Cancel</button>
          </form> : <div className="as03-row">
            <button className="as03-outline" disabled={busy} onClick={() => setEditing(entry.id)}>Edit time</button>
            <button className="as03-outline" disabled={busy || index === 0} aria-label="Move up" onClick={() => edit({ action: "move", entryId: entry.id, position: index - 1 }, "Entry moved.")}><ArrowUp size={16} /></button>
            <button className="as03-outline" disabled={busy || index === plan.entries.length - 1} aria-label="Move down" onClick={() => edit({ action: "move", entryId: entry.id, position: index + 1 }, "Entry moved.")}><ArrowDown size={16} /></button>
            <button className="as03-text-button" disabled={busy} onClick={() => edit({ action: "remove", entryId: entry.id }, "Entry removed.")}>Remove</button>
          </div>}
        </li>)}
      </ol>
      <div className="as03-row">
        <button className="as03-button" onClick={browse}>Explore destinations <ChevronRight size={17} /></button>
        <button className="as03-text-button" disabled={busy} onClick={() => setConfirmDelete(true)}>Delete itinerary</button>
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
