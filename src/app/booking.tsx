// Booking marks on trip stops (issue #10, step 3). STIS hands the tourist to the provider, asks on their return
// whether they booked, and records only who the booking is with and, for a stay, the check-out date.
import { useEffect, useState, type FormEvent } from "react";
import { BadgeCheck } from "lucide-react";

import { providerLink } from "../lib/providerLinks";
import type { ReviewedPlan, TourismItem } from "../shared/contracts";
import { ExternalLink, formatDay, Notice, today } from "./ui";

type Stop = ReviewedPlan["entries"][number];
export type Change = (edit: Record<string, unknown>, feedback: string) => Promise<boolean | undefined>;
export type Handoff = { entryId: string; host: string; back: boolean };

const bookable = new Set<Stop["kind"]>(["accommodation", "transportation", "event", "dining"]);
const word = (stop: Pick<Stop, "kind">) => (stop.kind === "dining" ? "reserved" : "booked");

/** The calendar day after `day`, computed in UTC so no timezone can shift it. */
export function nextDay(day: string): string {
  const date = new Date(`${day}T00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/** The words of a stop's booking mark, or undefined when it isn't marked. */
export function bookingLabel(stop: Pick<Stop, "kind" | "day" | "bookedWith" | "bookedUntil">): string | undefined {
  if (!stop.bookedWith) return undefined;
  const head = `${stop.kind === "dining" ? "Reserved" : "Booked"} ${stop.bookedWith === "phone" ? "by phone" : `with ${stop.bookedWith}`}`;
  return stop.bookedUntil ? `${head} · ${formatDay(stop.day, false)} – ${formatDay(stop.bookedUntil, false)}` : head;
}

/** Dates offered to the provider: a booked stay's own dates, otherwise the stop's day to the trip's last day. */
export function stopDates(stop: Pick<Stop, "kind" | "day" | "bookedUntil">, plan: Pick<ReviewedPlan, "endDate">) {
  if (stop.kind !== "accommodation") return undefined;
  if (stop.bookedUntil) return { checkIn: stop.day, checkOut: stop.bookedUntil };
  return plan.endDate > stop.day ? { checkIn: stop.day, checkOut: plan.endDate } : undefined;
}

const recordOf = (stop: Stop): TourismItem => ({
  id: stop.recordId, kind: stop.kind, version: 0,
  fields: { title: stop.title, provider: stop.provider ?? "", provenance: stop.provenance ?? "" },
}) as TourismItem;

function stopLink(stop: Stop, plan: Pick<ReviewedPlan, "endDate">) {
  const dates = stopDates(stop, plan);
  return providerLink(recordOf(stop), dates && { ...dates, today: today() });
}

export function BookingBadge({ stop }: { stop: Stop }) {
  const label = bookingLabel(stop);
  return label ? <span className="badge ok"><BadgeCheck size={14} aria-hidden="true" />{label}</span> : null;
}

/** Remembers which stop's provider the tourist left for, and notices when they come back to this tab. */
export function useHandoff() {
  const [handoff, setHandoff] = useState<Handoff>();
  useEffect(() => {
    if (!handoff || handoff.back) return;
    const onReturn = () => { if (document.visibilityState === "visible") setHandoff((current) => current && { ...current, back: true }); };
    // Listen only after the click that opened the provider, so its own focus change doesn't count as a return.
    const timer = window.setTimeout(() => {
      window.addEventListener("focus", onReturn);
      document.addEventListener("visibilitychange", onReturn);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [handoff]);
  return {
    handoff,
    start: (entryId: string, host: string) => setHandoff({ entryId, host, back: false }),
    clear: () => setHandoff(undefined),
  };
}

/** A stop's provider link, the "Did you book it?" prompt, the mark form, and the controls for an existing mark. */
export function StopBooking({ stop, plan, busy, change, handoff, onHandoff, onDismiss }: {
  stop: Stop; plan: Pick<ReviewedPlan, "endDate">; busy: boolean; change: Change;
  handoff?: Handoff; onHandoff: (entryId: string, host: string) => void; onDismiss: () => void;
}) {
  const [open, setOpen] = useState(false);
  if (!bookable.has(stop.kind)) return null;
  const link = stopLink(stop, plan);

  if (stop.bookedWith) {
    const reopen = link && link.host === stop.bookedWith ? link : undefined;
    return <div className="stack" style={{ gap: 6, marginTop: 8 }}>
      <p className="small muted" style={{ margin: 0 }}>Marked by you. STIS doesn't check bookings: your provider's confirmation is what counts.</p>
      <div className="row">
        {reopen && <ExternalLink href={reopen.href} className="button secondary small">Open {reopen.host}</ExternalLink>}
        <button className="button ghost small" disabled={busy} onClick={() => change({ action: "unbook", entryId: stop.id }, `Booking mark cleared for ${stop.title}.`)}>
          Clear booking mark<span className="sr-only"> for {stop.title}</span></button>
      </div>
    </div>;
  }

  const asking = handoff?.entryId === stop.id && handoff.back;
  const done = () => { setOpen(false); onDismiss(); };
  return <div className="stack" style={{ gap: 6, marginTop: 8 }}>
    {asking && !open && <Notice tone="info" focus title={`Did you ${stop.kind === "dining" ? "reserve" : "book"} ${stop.title} on ${handoff.host}?`}>
      <div className="row">
        <button className="button primary small" onClick={() => setOpen(true)}>Yes, mark it as {word(stop)}</button>
        <button className="button ghost small" onClick={onDismiss}>Not yet</button>
      </div>
    </Notice>}
    {open ? <BookingForm stop={stop} plan={plan} suggested={handoff?.entryId === stop.id ? handoff.host : link?.host} busy={busy} change={change} onDone={done} />
      : <>
        <div className="row">
          {link && <ExternalLink href={link.href} className="button secondary small" onClick={() => onHandoff(stop.id, link.host)}>{link.label}</ExternalLink>}
          <button className="button ghost small" onClick={() => setOpen(true)}>Mark as {word(stop)}<span className="sr-only"> {stop.title}</span></button>
        </div>
        {link?.datesFilled && <p className="small muted" style={{ margin: 0 }}>Your trip dates are filled in. Check them on {link.host} before you book.</p>}
        {link?.note && <p className="small muted" style={{ margin: 0 }}>{link.note}</p>}
      </>}
  </div>;
}

function BookingForm({ stop, plan, suggested, busy, change, onDone }: {
  stop: Stop; plan: Pick<ReviewedPlan, "endDate">; suggested?: string; busy: boolean; change: Change; onDone: () => void;
}) {
  const stay = stop.kind === "accommodation";
  const verb = word(stop);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const saved = await change({
      action: "book", entryId: stop.id, provider: form.get("provider") ?? "", until: stay ? form.get("until") ?? "" : "", reference: form.get("reference") ?? "",
    }, `${stop.title} marked as ${verb}.`);
    if (saved) onDone();
  }
  return <form className="stack" style={{ gap: 8 }} onSubmit={submit} aria-label={`Mark ${stop.title} as ${verb}`}>
    <div className="editor-grid">
      <label className="field">{stop.kind === "dining" ? "Reserved with" : "Booked with"}
        <input type="text" name="provider" required maxLength={100} defaultValue={suggested ?? ""} list={`providers-${stop.id}`} />
        <small>A website such as booking.com, or "phone"</small></label>
      <datalist id={`providers-${stop.id}`}>{suggested && suggested !== "phone" && <option value={suggested} />}<option value="phone" /></datalist>
      {stay && <label className="field">Check-out
        <input type="date" name="until" required min={nextDay(stop.day)} defaultValue={plan.endDate > stop.day ? plan.endDate : nextDay(stop.day)} />
        <small>Check-in is this stop's day, {formatDay(stop.day)}.</small></label>}
      <label className="field">Booking reference (optional)
        <input type="text" name="reference" maxLength={60} autoComplete="off" />
        <small>Saved in this stop's note. Anyone with a view-only link to the trip can see notes.</small></label>
    </div>
    <div className="row">
      <button className="button primary small" disabled={busy}>Mark as {verb}</button>
      <button type="button" className="button ghost small" onClick={onDone}>Cancel</button>
    </div>
  </form>;
}
