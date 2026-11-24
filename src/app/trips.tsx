import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { CalendarPlus, Check } from "lucide-react";

import Modal from "../components/Modal";
import { api, errorMessage } from "../lib/api";
import type { PlanSummary, ReviewedPlan, TourismItem } from "../shared/contracts";
import { Link, navigate } from "./router";
import { useSession } from "./session";
import { formatDay, Notice, today } from "./ui";

export type GuestLink = { id: string; token: string };
type TripState = {
  guest?: GuestLink;
  setGuest: (link: GuestLink | undefined) => void;
  addToTrip: (item: TourismItem) => void;
  tripPath: (id: string) => string;
  peekFlash: () => string;
  clearFlash: () => void;
  flash: (message: string) => void;
};

const TripContext = createContext<TripState | undefined>(undefined);

export function readGuestHash(hash: string): GuestLink | undefined {
  const found = /^#(?:itinerary\/)?([\w-]{1,70})\/([\w-]{43})$/.exec(hash);
  return found ? { id: found[1], token: found[2] } : undefined;
}

export const guestPath = (link: GuestLink) => `/trips/guest#${link.id}/${link.token}`;

/** A view-only link carries its capability token in the fragment, which browsers never send to servers. */
export function readShareHash(hash: string): string | undefined {
  return /^#([\w-]{43})$/.exec(hash)?.[1];
}

export const sharePath = (token: string) => `/trips/shared#${token}`;

export function TripProvider({ children }: { children: ReactNode }) {
  const [guest, setGuest] = useState<GuestLink | undefined>(() => readGuestHash(window.location.hash));
  const [adding, setAdding] = useState<TourismItem>();
  const pending = useRef("");
  const tripPath = useCallback((id: string) => guest?.id === id ? guestPath(guest) : `/trips/${id}`, [guest]);
  const value = useMemo(() => ({ guest, setGuest, addToTrip: setAdding, tripPath,
    flash: (message: string) => { pending.current = message; },
    peekFlash: () => pending.current, clearFlash: () => { pending.current = ""; } }), [guest, tripPath]);
  return <TripContext.Provider value={value}>
    {children}
    {adding && <AddToTrip item={adding} onClose={() => setAdding(undefined)} />}
  </TripContext.Provider>;
}

export function useTrips() {
  const value = useContext(TripContext);
  if (!value) throw new Error("useTrips must be used inside TripProvider.");
  return value;
}

function daysOf(plan: { date: string; endDate: string }) {
  const days: string[] = [];
  for (let day = plan.date; day <= plan.endDate && days.length < 14;) {
    days.push(day);
    const next = new Date(`${day}T00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    day = next.toISOString().slice(0, 10);
  }
  return days;
}
export { daysOf };

function AddToTrip({ item, onClose }: { item: TourismItem; onClose: () => void }) {
  const { account } = useSession();
  const { guest, setGuest, tripPath } = useTrips();
  const [trips, setTrips] = useState<PlanSummary[]>();
  const [choice, setChoice] = useState<string>("");
  const [target, setTarget] = useState<ReviewedPlan>();
  const [error, setError] = useState("");
  const [issue, setIssue] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<ReviewedPlan>();
  const eventDay = item.kind === "event" ? item.fields.startsAt?.slice(0, 10) : undefined;
  const eventTime = item.kind === "event" ? item.fields.startsAt?.split("T")[1] ?? "" : "";
  const [draft, setDraft] = useState({ title: "My Sarawak trip", date: eventDay && eventDay >= today() ? eventDay : today(), endDate: "", provisional: true });

  useEffect(() => {
    let live = true;
    (async () => {
      const list: PlanSummary[] = account ? await api<PlanSummary[]>("itineraries") : [];
      if (guest && !list.some(({ id }) => id === guest.id)) {
        const plan = await api<ReviewedPlan>(`itineraries/${guest.id}`, { guest: guest.token }).catch(() => undefined);
        if (plan) list.unshift({ id: plan.id, title: `${plan.title} (guest link)`, date: plan.date, endDate: plan.endDate, provisional: plan.provisional, entryCount: plan.entries.length, updatedAt: "" });
      }
      if (!live) return;
      setTrips(list);
      setChoice(list[0]?.id ?? "new");
    })().catch((cause) => live && setError(errorMessage(cause)));
    return () => { live = false; };
  }, [account, guest]);

  useEffect(() => {
    if (!choice || choice === "new") { setTarget(undefined); return; }
    let live = true;
    void api<ReviewedPlan>(`itineraries/${choice}`, { guest: guest?.id === choice ? guest.token : undefined })
      .then((plan) => live && setTarget(plan)).catch((cause) => live && setError(errorMessage(cause)));
    return () => { live = false; };
  }, [choice, guest]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setError(""); setIssue("");
    try {
      let plan = target;
      let link = guest;
      if (choice === "new") {
        const created = await api<{ plan: ReviewedPlan; guest?: string }>("itineraries", { method: "POST",
          body: { title: draft.title, date: draft.date, endDate: draft.endDate || undefined, provisional: draft.provisional } });
        plan = created.plan;
        if (created.guest) { link = { id: created.plan.id, token: created.guest }; setGuest(link); }
      }
      if (!plan) throw new Error("Choose a trip.");
      const added = await api<ReviewedPlan>(`itineraries/${plan.id}`, { method: "PUT", guest: link?.id === plan.id ? link.token : undefined,
        body: { revision: plan.revision, change: { action: "add", recordId: item.id, day: form.get("day") || plan.date,
          start: form.get("start") ?? "", end: form.get("end") ?? "", note: form.get("note") ?? "" } } });
      setDone(added);
    } catch (cause) {
      const message = errorMessage(cause);
      if (/start time/.test(message)) setIssue(message); else setError(message);
    } finally { setBusy(false); }
  }

  const days = target ? daysOf(target) : daysOf({ date: draft.date, endDate: draft.endDate || draft.date });
  if (done) return <Modal title="Added to your trip" onClose={onClose}>
    <Notice tone="ok" focus title={`${item.fields.title} is in “${done.title}”.`}>
      {done.conflicts.length > 0 && <p>This trip now has {done.conflicts.length} time conflict{done.conflicts.length === 1 ? "" : "s"} to review.</p>}
      {!account && <p>You are planning as a guest. Keep the trip link, or sign in to save it to an account.</p>}
    </Notice>
    <div className="row" style={{ marginTop: 16 }}>
      <Link className="button primary" to={tripPath(done.id)} onClick={onClose}>Open trip</Link>
      <button className="button secondary" onClick={onClose}>Keep exploring</button>
    </div>
  </Modal>;

  return <Modal title={`Add ${item.fields.title} to a trip`} onClose={onClose}>
    {error && <Notice tone="error">{error}</Notice>}
    {!trips ? <p role="status">Loading your trips…</p> : <form className="stack" onSubmit={submit}>
      <label className="field">Trip
        <select value={choice} onChange={(event) => setChoice(event.target.value)}>
          {trips.map((trip) => <option key={trip.id} value={trip.id}>{trip.title} · {formatDay(trip.date, false)}</option>)}
          <option value="new">Create a new trip</option>
        </select>
      </label>
      {choice === "new" && <fieldset className="stack">
        <legend>New trip</legend>
        <label className="field">Trip name<input type="text" required maxLength={120} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
        <div className="editor-grid">
          <label className="field">First day<input type="date" required value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></label>
          <label className="field">Last day <small>(optional, up to 14 days)</small><input type="date" min={draft.date} value={draft.endDate} onChange={(event) => setDraft({ ...draft, endDate: event.target.value })} /></label>
        </div>
        <label className="checkbox"><input type="checkbox" checked={draft.provisional} onChange={(event) => setDraft({ ...draft, provisional: event.target.checked })} />Dates are provisional</label>
        {!account && <p className="small muted">You can plan without an account. <Link to="/account/sign-in" onClick={onClose}>Sign in</Link> to keep trips across devices.</p>}
      </fieldset>}
      <label className="field">Day
        <select name="day" defaultValue={eventDay && days.includes(eventDay) ? eventDay : days[0]} key={days.join()}>
          {days.map((day) => <option key={day} value={day}>{formatDay(day)}</option>)}
        </select>
      </label>
      {eventDay && !days.includes(eventDay) && <Notice tone="warn">This event is published for {formatDay(eventDay)}, outside the selected trip dates. You can still add it; the trip will flag the date difference.</Notice>}
      <fieldset>
        <legend>Planned time <span className="hint">(optional; Kuching time)</span></legend>
        <div className="editor-grid">
          <label className="field">Start<input type="time" name="start" defaultValue={eventTime} aria-invalid={Boolean(issue) || undefined} /></label>
          <label className="field">End<input type="time" name="end" aria-invalid={Boolean(issue) || undefined} /></label>
        </div>
        {issue && <p className="field-error">{issue}</p>}
      </fieldset>
      <label className="field">Note <small>(optional)</small><input type="text" name="note" maxLength={500} /></label>
      <div className="row"><button className="button primary" disabled={busy}><CalendarPlus size={18} aria-hidden="true" />{busy ? "Adding…" : "Add to trip"}</button>
        <button type="button" className="button ghost" onClick={onClose}>Cancel</button></div>
    </form>}
  </Modal>;
}

export function AddButton({ item, compact = false }: { item: TourismItem; compact?: boolean }) {
  const { addToTrip } = useTrips();
  if (item.kind === "visitor") return null;
  return <button className={`button ${compact ? "secondary small" : "primary"}`} onClick={() => addToTrip(item)}>
    <CalendarPlus size={16} aria-hidden="true" />Add to trip<span className="sr-only">: {item.fields.title}</span>
  </button>;
}

export function SavedTick() {
  return <Check size={16} aria-hidden="true" />;
}

export function openTrip(link: GuestLink) {
  navigate(guestPath(link));
}
