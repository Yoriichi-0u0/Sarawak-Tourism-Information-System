import { useEffect, useState, type FormEvent } from "react";
import {
  AlertTriangle, ArrowDown, ArrowUp, CalendarDays, CalendarPlus, CalendarRange, Copy, Download, Eye, Link2, Link2Off, Luggage, MapPin, Pencil, Printer,
  RefreshCw, Trash2, UserCheck,
} from "lucide-react";

import { api, download, errorMessage, RequestError } from "../../lib/api";
import { conflictDetails } from "../../lib/conflicts";
import { describePlanChanges, isStale } from "../../lib/recovery";
import type { PlanSummary, ReviewedPlan } from "../../shared/contracts";
import { detailPath, sectionFor, sections } from "../kinds";
import { Link, navigate } from "../router";
import { useSession } from "../session";
import { daysOf, guestPath, readShareHash, sharePath, useTrips, type GuestLink } from "../trips";
import { Empty, formatDay, kindLabel, Loading, Notice, today, useTitle } from "../ui";

function NewTripForm({ onCreated }: { onCreated: (plan: ReviewedPlan, guest?: string) => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [start, setStart] = useState(today());
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try {
      const created = await api<{ plan: ReviewedPlan; guest?: string }>("itineraries", { method: "POST", body: {
        title: String(form.get("title") || "My Sarawak trip"), date: form.get("date"), endDate: form.get("endDate") || undefined, provisional: form.get("provisional") === "on" } });
      onCreated(created.plan, created.guest);
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }
  return <form className="panel stack" onSubmit={submit} aria-labelledby="new-trip">
    <h2 id="new-trip" style={{ margin: 0 }}>Start a new trip</h2>
    {error && <Notice tone="error">{error}</Notice>}
    <label className="field">Trip name<input type="text" name="title" maxLength={120} placeholder="My Sarawak trip" /></label>
    <div className="editor-grid">
      <label className="field">First day<input type="date" name="date" required value={start} onChange={(event) => setStart(event.target.value)} /></label>
      <label className="field">Last day <small>(optional, up to 14 days)</small><input type="date" name="endDate" min={start} /></label>
    </div>
    <label className="checkbox"><input type="checkbox" name="provisional" defaultChecked />Dates are provisional (not yet confirmed)</label>
    <div><button className="button primary" disabled={busy}><CalendarPlus size={18} aria-hidden="true" />Create trip</button></div>
  </form>;
}

export function TripsPage() {
  const { account } = useSession();
  const { guest, setGuest } = useTrips();
  const [trips, setTrips] = useState<PlanSummary[]>();
  const [error, setError] = useState("");
  useTitle("My trips");
  useEffect(() => {
    if (!account) { setTrips(undefined); return; }
    void api<PlanSummary[]>("itineraries").then(setTrips).catch((cause) => setError(errorMessage(cause)));
  }, [account]);
  const created = (plan: ReviewedPlan, token?: string) => {
    if (token) { const link = { id: plan.id, token }; setGuest(link); navigate(guestPath(link)); } else navigate(`/trips/${plan.id}`);
  };
  return <div className="stack">
    <div><p className="eyebrow"><Luggage size={16} aria-hidden="true" />Trips</p><h1>{account ? "My trips" : "Plan a trip"}</h1></div>
    {account === undefined && <Loading />}
    {account === null && <Notice tone="info" title="You are not signed in.">
      <p>You can plan as a guest: STIS gives you a private link to the trip. <Link to="/account/sign-in">Sign in</Link> or <Link to="/account/register">create an account</Link> to keep trips across devices without managing links.</p>
      {guest && <p><Link to={guestPath(guest)}>Return to the guest trip you opened in this tab</Link></p>}
    </Notice>}
    {account && guest && <Notice tone="info" title="You have a guest trip open in this tab">
      <p>Open it and choose “Save to my account” to keep it with your other trips.</p>
      <Link className="button primary small" to={guestPath(guest)}>Open guest trip</Link>
    </Notice>}
    {error && <Notice tone="error">{error}</Notice>}
    <div className="trip-layout">
      <div className="stack">
        {account && trips?.length === 0 && <Empty icon={CalendarRange} title="No trips yet"><p>Create one here, or use “Add to trip” while exploring.</p></Empty>}
        {account && !trips && !error && <Loading />}
        {trips && trips.length > 0 && <ul className="trip-list" style={{ listStyle: "none", padding: 0, margin: 0 }}>{trips.map((trip) => <li key={trip.id} className="panel trip-row">
          <div><h2 style={{ margin: 0, fontSize: 20 }}><Link to={`/trips/${trip.id}`}>{trip.title}</Link></h2>
            <p className="meta" style={{ margin: "4px 0 0" }}><span><CalendarDays size={14} aria-hidden="true" />{formatDay(trip.date, false)}{trip.endDate !== trip.date ? ` – ${formatDay(trip.endDate, false)}` : ""}</span>
              <span>{trip.entryCount} stop{trip.entryCount === 1 ? "" : "s"}</span>{trip.provisional && <span className="badge neutral">Provisional dates</span>}</p></div>
          <Link className="button secondary small" to={`/trips/${trip.id}`}>Open<span className="sr-only"> {trip.title}</span></Link>
        </li>)}</ul>}
      </div>
      <NewTripForm onCreated={created} />
    </div>
  </div>;
}

type Editing = { id: string } | undefined;

export function TripPage({ id, guest }: { id: string; guest?: GuestLink }) {
  const { account } = useSession();
  const { setGuest, flash, peekFlash, clearFlash } = useTrips();
  const [plan, setPlan] = useState<ReviewedPlan | null>();
  const [error, setError] = useState("");
  const [message, setMessage] = useState(peekFlash);
  useEffect(clearFlash, [clearFlash]);
  const [stale, setStale] = useState<string[]>();
  const [editing, setEditing] = useState<Editing>();
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const token = guest?.id === id ? guest.token : undefined;
  useTitle(plan?.title ?? "Trip");

  useEffect(() => {
    let live = true;
    api<ReviewedPlan>(`itineraries/${id}`, { guest: token }).then((value) => live && setPlan(value))
      .catch((cause) => { if (!live) return; if (cause instanceof RequestError && cause.status === 404) setPlan(null); else setError(errorMessage(cause)); });
    return () => { live = false; };
  }, [id, token]);

  async function change(edit: Record<string, unknown>, feedback: string) {
    if (!plan) return;
    setBusy(true); setError(""); setMessage("");
    try {
      setPlan(await api<ReviewedPlan>(`itineraries/${id}`, { method: "PUT", guest: token, body: { revision: plan.revision, change: edit } }));
      setMessage(feedback); setStale(undefined);
      return true;
    } catch (cause) {
      if (isStale(cause)) {
        const latest = await api<ReviewedPlan>(`itineraries/${id}`, { guest: token }).catch(() => undefined);
        if (latest) { setStale(describePlanChanges(plan, latest)); setPlan(latest); }
        else setError(errorMessage(cause));
      } else setError(errorMessage(cause));
      return false;
    } finally { setBusy(false); }
  }

  if (plan === undefined && !error) return <Loading text="Opening your trip…" />;
  if (plan === null) return <Empty page icon={AlertTriangle} title="This trip link is invalid or the trip was deleted">
    <p>Guest links stop working when a trip is deleted or saved to an account.</p><Link className="button primary" to="/trips">Go to trips</Link></Empty>;
  if (!plan) return <Notice tone="error">{error}</Notice>;

  const days = daysOf(plan);
  const { pairs, partners } = conflictDetails(plan);
  const position = (entryId: string) => plan.entries.findIndex((entry) => entry.id === entryId);

  async function submitEdit(event: FormEvent<HTMLFormElement>, entryId: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (await change({ action: "update", entryId, day: form.get("day"), start: form.get("start") ?? "", end: form.get("end") ?? "", note: form.get("note") ?? "" }, "Stop updated.")) setEditing(undefined);
  }
  async function submitDates(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await change({ action: "date", date: form.get("date"), endDate: form.get("endDate"), provisional: form.get("provisional") === "on" }, "Travel dates updated.");
  }
  async function rename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await change({ action: "rename", title: new FormData(event.currentTarget).get("title") }, "Trip renamed.");
  }
  async function claim() {
    setBusy(true); setError("");
    try {
      const saved = await api<ReviewedPlan>(`itineraries/${id}/claim`, { method: "POST", guest: token, body: {} });
      flash("Saved to your account. The old guest link no longer opens this trip.");
      setGuest(undefined); setPlan(saved); navigate(`/trips/${saved.id}`, { replace: true });
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true);
    try { await api(`itineraries/${id}`, { method: "DELETE", guest: token }); setGuest(undefined); navigate("/trips"); }
    catch (cause) { setError(errorMessage(cause)); setBusy(false); }
  }

  return <div className="stack">
    <nav className="breadcrumb" aria-label="Breadcrumb"><Link to="/trips">Trips</Link> / <span aria-current="page">{plan.title}</span></nav>
    <div className="spread">
      <div><p className="eyebrow"><Luggage size={16} aria-hidden="true" />{plan.owned ? "Saved to your account" : "Guest trip"}</p>
        <h1 style={{ margin: 0 }}>{plan.title}</h1>
        <p className="meta"><span><CalendarDays size={14} aria-hidden="true" />{formatDay(plan.date)}{plan.endDate !== plan.date ? ` – ${formatDay(plan.endDate)}` : ""}</span>
          {plan.provisional && <span className="badge neutral">Provisional dates</span>}<span>{plan.entries.length} stop{plan.entries.length === 1 ? "" : "s"}</span></p></div>
      <div className="row">
        <button className="button secondary small" disabled={busy} onClick={() => download(`itineraries/${id}/calendar`, `sarawak-trip-${plan.date}.ics`, { guest: token }).catch((cause) => setError(errorMessage(cause)))}>
          <Download size={16} aria-hidden="true" />Calendar (.ics)</button>
        <button className="button secondary small" onClick={() => window.print()}><Printer size={16} aria-hidden="true" />Print</button>
        {token && <button className="button secondary small" onClick={() => navigator.clipboard?.writeText(window.location.href).then(() => setMessage("Guest link copied. Anyone with it can view and edit this trip."), () => setError("Copy the link from the address bar."))}>
          <Copy size={16} aria-hidden="true" />Copy guest link</button>}
      </div>
    </div>
    {message && <Notice tone="ok">{message}</Notice>}
    {error && <Notice tone="error">{error}</Notice>}
    {stale && <Notice tone="warn" focus title="This trip was changed somewhere else. The latest version is shown below.">
      <ul>{stale.map((line) => <li key={line}>{line}</li>)}</ul><p>Nothing from your last action was saved. Any edit form you had open is still open, so you can try again.</p></Notice>}
    {token && !account && <Notice tone="info" title="Planning as a guest">Keep this page's link to come back, or <Link to="/account/sign-in">sign in</Link> to save the trip to an account.</Notice>}
    {token && account && <Notice tone="info" title="Save this trip to your account?">
      <p>Your trips are then available whenever you sign in, and the guest link stops working.</p>
      <button className="button primary small" disabled={busy} onClick={claim}><UserCheck size={16} aria-hidden="true" />Save to my account</button></Notice>}
    {pairs.length > 0 && <Notice tone="error" title={`${pairs.length} time conflict${pairs.length === 1 ? "" : "s"}. Adjust the overlapping stops.`}>
      <ul>{pairs.map(({ first, second }) => <li key={`${first.id}-${second.id}`}><strong>{first.title}</strong> ({first.interval}) overlaps <strong>{second.title}</strong> ({second.interval}).</li>)}</ul></Notice>}

    <div className="trip-layout">
      <div>
        {days.map((day) => {
          const stops = plan.entries.filter((entry) => entry.day === day);
          return <section className="day" key={day} aria-labelledby={`day-${day}`}>
            <div className="day-head"><h2 id={`day-${day}`}>Day {days.indexOf(day) + 1}</h2><span className="muted">{formatDay(day)}</span></div>
            {!stops.length && <p className="muted">Nothing planned yet. <Link to="/destinations">Explore destinations</Link> or <Link to="/events">find events</Link>.</p>}
            {stops.map((entry, index) => {
              const conflicts = partners.get(entry.id) ?? [];
              const Icon = sectionFor(entry.kind).icon;
              const isEditing = editing?.id === entry.id;
              return <article className="stop" key={entry.id} data-conflict={conflicts.length > 0} aria-labelledby={`stop-${entry.id}`}>
                <div className="stop-time">{entry.start ? <>{entry.start}<small>to {entry.end}</small></> : <small>Any time</small>}</div>
                <div>
                  <p className="small muted" style={{ margin: 0, display: "flex", gap: 6, alignItems: "center" }}><Icon size={14} aria-hidden="true" />{kindLabel(entry.kind)}</p>
                  <h3 id={`stop-${entry.id}`}>{entry.notice === "unavailable" ? entry.title : <Link to={detailPath(entry.kind, entry.recordId)}>{entry.title}</Link>}</h3>
                  {entry.location && <p className="meta" style={{ margin: 0 }}><span><MapPin size={14} aria-hidden="true" />{entry.location}</span></p>}
                  <div className="tags" style={{ marginTop: 6 }}>
                    {entry.notice === "cancelled" && <span className="badge danger">Event cancelled</span>}
                    {entry.notice === "postponed" && <span className="badge warn">Event postponed</span>}
                    {entry.notice === "unavailable" && <span className="badge neutral">Current information unavailable</span>}
                    {entry.dateNotice && <span className="badge warn"><AlertTriangle size={14} aria-hidden="true" />Published for {formatDay(entry.eventStartsAt!.slice(0, 10))}</span>}
                    {conflicts.length > 0 && <span className="badge danger"><AlertTriangle size={14} aria-hidden="true" />Overlaps {conflicts.map(({ title, interval }) => `${title} (${interval})`).join(", ")}</span>}
                  </div>
                  {entry.eventStartsAt && !entry.dateNotice && <p className="small muted" style={{ margin: "6px 0 0" }}>Published event start: {entry.eventStartsAt.replace("T", " ")}</p>}
                  {entry.note && <p className="small" style={{ margin: "6px 0 0" }}>Note: {entry.note}</p>}
                  {isEditing ? <form className="stack" style={{ marginTop: 10 }} onSubmit={(event) => submitEdit(event, entry.id)} aria-label={`Edit ${entry.title}`}>
                    <div className="editor-grid">
                      <label className="field">Day<select name="day" defaultValue={entry.day}>{days.map((option) => <option key={option} value={option}>{formatDay(option)}</option>)}</select></label>
                      <label className="field">Note<input type="text" name="note" defaultValue={entry.note} maxLength={500} /></label>
                      <label className="field">Start<input type="time" name="start" defaultValue={entry.start} /></label>
                      <label className="field">End<input type="time" name="end" defaultValue={entry.end} /></label>
                    </div>
                    <div className="row"><button className="button primary small" disabled={busy}>Save stop</button><button type="button" className="button ghost small" onClick={() => setEditing(undefined)}>Cancel</button></div>
                  </form> : <div className="stop-actions">
                    <button className="button secondary small" onClick={() => setEditing({ id: entry.id })}><Pencil size={14} aria-hidden="true" />Edit<span className="sr-only"> {entry.title}</span></button>
                    <button className="icon-button" disabled={busy || index === 0} aria-label={`Move ${entry.title} earlier`} onClick={() => change({ action: "move", entryId: entry.id, position: position(stops[index - 1].id) }, "Stop moved.")}><ArrowUp size={16} /></button>
                    <button className="icon-button" disabled={busy || index === stops.length - 1} aria-label={`Move ${entry.title} later`} onClick={() => change({ action: "move", entryId: entry.id, position: position(stops[index + 1].id) }, "Stop moved.")}><ArrowDown size={16} /></button>
                    <button className="button ghost small" disabled={busy} onClick={() => change({ action: "remove", entryId: entry.id }, `${entry.title} removed.`)}><Trash2 size={14} aria-hidden="true" />Remove<span className="sr-only"> {entry.title}</span></button>
                  </div>}
                </div>
              </article>;
            })}
          </section>;
        })}
      </div>
      <aside className="aside">
        <form className="panel stack" onSubmit={rename} aria-label="Rename trip" key={`title-${plan.revision}`}>
          <label className="field">Trip name<input type="text" name="title" required maxLength={120} defaultValue={plan.title} /></label>
          <div><button className="button secondary small" disabled={busy}>Rename</button></div></form>
        <form className="panel stack" onSubmit={submitDates} aria-label="Travel dates" key={`dates-${plan.revision}`}>
          <h2 style={{ fontSize: 18, margin: 0 }}>Travel dates</h2>
          <label className="field">First day<input type="date" name="date" required defaultValue={plan.date} /></label>
          <label className="field">Last day<input type="date" name="endDate" required defaultValue={plan.endDate} /></label>
          <label className="checkbox"><input type="checkbox" name="provisional" defaultChecked={plan.provisional} />Dates are provisional</label>
          <p className="small muted" style={{ margin: 0 }}>Moving the first day moves every stop with it.</p>
          <div><button className="button secondary small" disabled={busy}>Update dates</button></div></form>
        <SharePanel id={id} guest={token} sharing={Boolean(plan.sharing)} onChange={(sharing) => setPlan({ ...plan, sharing })} />
        <div className="panel stack" style={{ gap: 8 }}>
          <h2 style={{ fontSize: 18, margin: 0 }}>Add more</h2>
          {sections.filter(({ kind }) => kind !== "visitor").map(({ path, label, icon: Icon }) => <Link key={path} to={path} className="row" style={{ gap: 8 }}><Icon size={16} aria-hidden="true" />{label}</Link>)}
        </div>
        <div className="panel stack" style={{ gap: 8 }}>
          {!confirmDelete ? <button className="button ghost small" onClick={() => setConfirmDelete(true)}><Trash2 size={16} aria-hidden="true" />Delete this trip</button>
            : <><p style={{ margin: 0 }}><strong>Delete “{plan.title}”?</strong> This cannot be undone.</p>
              <div className="row"><button className="button danger small" disabled={busy} onClick={remove}>Delete trip</button><button className="button ghost small" onClick={() => setConfirmDelete(false)}>Keep it</button></div></>}
        </div>
      </aside>
    </div>
  </div>;
}

function SharePanel({ id, guest, sharing, onChange }: { id: string; guest?: string; sharing: boolean; onChange: (sharing: boolean) => void }) {
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  async function create() {
    setBusy(true); setError(""); setStatus("");
    try {
      const { token } = await api<{ token: string }>(`itineraries/${id}/share`, { method: "POST", guest, body: {} });
      setLink(`${window.location.origin}${sharePath(token)}`); onChange(true);
      setStatus(sharing ? "New link created. The previous link no longer works." : "View-only link created.");
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }
  async function stop() {
    setBusy(true); setError(""); setStatus("");
    try { await api(`itineraries/${id}/share`, { method: "DELETE", guest }); setLink(""); onChange(false); setStatus("Sharing stopped. The link no longer opens this trip."); }
    catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }
  return <section className="panel stack" style={{ gap: 10 }} aria-labelledby="share-title">
    <h2 id="share-title" style={{ fontSize: 18, margin: 0 }}><Eye size={18} aria-hidden="true" /> Share a view-only link</h2>
    <p className="small muted" style={{ margin: 0 }}>People with the link can see the trip, including notes, but cannot change it. You can replace or stop the link at any time.</p>
    {error && <Notice tone="error">{error}</Notice>}
    {status && <p role="status" className="small" style={{ margin: 0 }}>{status}</p>}
    {link && <div className="stack" style={{ gap: 6 }}>
      <label className="field">View-only link<input type="text" readOnly value={link} onFocus={(event) => event.currentTarget.select()} /></label>
      <button className="button secondary small" onClick={() => navigator.clipboard?.writeText(link).then(() => setStatus("Link copied."), () => setStatus("Select the link and copy it."))}>
        <Copy size={14} aria-hidden="true" />Copy link</button>
      <p className="small muted" style={{ margin: 0 }}>Save it now: for your security STIS stores only a fingerprint of the link and cannot show it again.</p>
    </div>}
    {!sharing ? <div><button className="button secondary small" disabled={busy} onClick={create}><Link2 size={14} aria-hidden="true" />Create view-only link</button></div>
      : <div className="row">
        {!link && <span className="badge ok">A view-only link is active</span>}
        <button className="button secondary small" disabled={busy} onClick={create}><RefreshCw size={14} aria-hidden="true" />{link ? "Replace link" : "Get a new link"}</button>
        <button className="button ghost small" disabled={busy} onClick={stop}><Link2Off size={14} aria-hidden="true" />Stop sharing</button>
      </div>}
  </section>;
}

export function SharedTripPage({ hash }: { hash: string }) {
  const token = readShareHash(hash);
  const [plan, setPlan] = useState<ReviewedPlan | null>();
  const [error, setError] = useState("");
  useTitle(plan ? `${plan.title} (shared)` : "Shared trip");
  useEffect(() => {
    if (!token) { setPlan(null); return; }
    let live = true;
    api<ReviewedPlan>("shared-itinerary", { share: token }).then((value) => live && setPlan(value))
      .catch((cause) => { if (!live) return; if (cause instanceof RequestError && cause.status === 404) setPlan(null); else setError(errorMessage(cause)); });
    return () => { live = false; };
  }, [token]);
  if (plan === undefined && !error) return <Loading text="Opening the shared trip…" />;
  if (plan === null) return <Empty page icon={AlertTriangle} title="This shared trip is no longer available">
    <p>The link may be incomplete, or the person who shared it replaced the link, stopped sharing or deleted the trip.</p>
    <Link className="button primary" to="/trips">Plan your own trip</Link></Empty>;
  if (!plan) return <Notice tone="error">{error}</Notice>;
  const days = daysOf(plan);
  const { pairs, partners } = conflictDetails(plan);
  return <div className="stack">
    <div className="spread">
      <div><p className="eyebrow"><Eye size={16} aria-hidden="true" />Shared with you · view only</p>
        <h1 style={{ margin: 0 }}>{plan.title}</h1>
        <p className="meta"><span><CalendarDays size={14} aria-hidden="true" />{formatDay(plan.date)}{plan.endDate !== plan.date ? ` – ${formatDay(plan.endDate)}` : ""}</span>
          {plan.provisional && <span className="badge neutral">Provisional dates</span>}<span>{plan.entries.length} stop{plan.entries.length === 1 ? "" : "s"}</span></p></div>
      <div className="row">
        <button className="button secondary small" onClick={() => download("shared-itinerary/calendar", `sarawak-trip-${plan.date}.ics`, { share: token }).catch((cause) => setError(errorMessage(cause)))}>
          <Download size={16} aria-hidden="true" />Calendar (.ics)</button>
        <button className="button secondary small" onClick={() => window.print()}><Printer size={16} aria-hidden="true" />Print</button>
      </div>
    </div>
    {error && <Notice tone="error">{error}</Notice>}
    <Notice tone="info" title="You are viewing someone else's trip">It shows their latest saved plan and current published details. To plan your own, <Link to="/trips">start a trip</Link>.</Notice>
    {pairs.length > 0 && <Notice tone="warn" title={`${pairs.length} time conflict${pairs.length === 1 ? "" : "s"} in this plan`}>
      <ul>{pairs.map(({ first, second }) => <li key={`${first.id}-${second.id}`}><strong>{first.title}</strong> ({first.interval}) overlaps <strong>{second.title}</strong> ({second.interval}).</li>)}</ul></Notice>}
    <div>
      {days.map((day, index) => {
        const stops = plan.entries.filter((entry) => entry.day === day);
        return <section className="day" key={day} aria-labelledby={`day-${day}`}>
          <div className="day-head"><h2 id={`day-${day}`}>Day {index + 1}</h2><span className="muted">{formatDay(day)}</span></div>
          {!stops.length && <p className="muted">Nothing planned for this day.</p>}
          {stops.map((entry) => {
            const Icon = sectionFor(entry.kind).icon;
            const conflicts = partners.get(entry.id) ?? [];
            return <article className="stop" key={entry.id} data-conflict={conflicts.length > 0} aria-labelledby={`stop-${entry.id}`}>
              <div className="stop-time">{entry.start ? <>{entry.start}<small>to {entry.end}</small></> : <small>Any time</small>}</div>
              <div>
                <p className="small muted" style={{ margin: 0, display: "flex", gap: 6, alignItems: "center" }}><Icon size={14} aria-hidden="true" />{kindLabel(entry.kind)}</p>
                <h3 id={`stop-${entry.id}`}>{entry.notice === "unavailable" ? entry.title : <Link to={detailPath(entry.kind, entry.recordId)}>{entry.title}</Link>}</h3>
                {entry.location && <p className="meta" style={{ margin: 0 }}><span><MapPin size={14} aria-hidden="true" />{entry.location}</span></p>}
                <div className="tags" style={{ marginTop: 6 }}>
                  {entry.notice === "cancelled" && <span className="badge danger">Event cancelled</span>}
                  {entry.notice === "postponed" && <span className="badge warn">Event postponed</span>}
                  {entry.notice === "unavailable" && <span className="badge neutral">Current information unavailable</span>}
                  {entry.dateNotice && <span className="badge warn"><AlertTriangle size={14} aria-hidden="true" />Published for {formatDay(entry.eventStartsAt!.slice(0, 10))}</span>}
                  {conflicts.length > 0 && <span className="badge danger"><AlertTriangle size={14} aria-hidden="true" />Overlaps {conflicts.map(({ title, interval }) => `${title} (${interval})`).join(", ")}</span>}
                </div>
                {entry.note && <p className="small" style={{ margin: "6px 0 0" }}>Note: {entry.note}</p>}
              </div>
            </article>;
          })}
        </section>;
      })}
    </div>
  </div>;
}
