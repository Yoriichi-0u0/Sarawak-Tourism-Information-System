import { isDateOrDateTime } from "../shared/catalogue.ts";
import type { RecordKind, TourismItem } from "../shared/contracts.ts";

/** Trip dates to offer a provider, as `YYYY-MM-DD` strings. `today` is the current Kuching date. */
export type TripDates = { checkIn?: string; checkOut?: string; today: string };

export type ProviderLink = {
  href: string;
  /** The provider's host without a leading `www.`, shown to the tourist before they leave STIS. */
  host: string;
  label: string;
  /** True when trip dates were added to the link. */
  datesFilled: boolean;
  /** Extra wording for providers whose page does less than the label might suggest. */
  note?: string;
};

const kindLabels: Record<RecordKind, string> = {
  destination: "Official information",
  event: "Tickets and registration",
  accommodation: "Check availability and book",
  transportation: "Operator information",
  dining: "Website or menu",
  visitor: "Read the official guidance",
};

/** A whole calendar day, never a date-time, so a timezone can't shift it. */
const isDay = (value: string | undefined): value is string => value?.length === 10 && isDateOrDateTime(value);

/** Matches a domain or any of its subdomains, so `booking.com.example` is not Booking.com. */
const on = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

/**
 * Builds the outbound link for a record's provider URL. Only Booking.com gets trip dates, and only when
 * both are valid, check-in is today or later, and check-out is after check-in; every other link opens
 * unchanged. Returns undefined when there is no safe link to offer.
 */
export function providerLink(item: TourismItem, dates?: TripDates): ProviderLink | undefined {
  const raw = item.fields.provider;
  if (!raw || item.fields.provenance === "illustrative") return undefined;
  let url: URL;
  try { url = new URL(raw); } catch { return undefined; }
  if (url.protocol !== "https:" || url.username || url.password) return undefined;
  const host = url.hostname.replace(/^www\./, "");

  if (on(host, "booking.com")) {
    const checkIn = dates?.checkIn, checkOut = dates?.checkOut;
    const datesFilled = item.kind === "accommodation" && dates !== undefined && isDay(checkIn) && isDay(checkOut)
      && checkIn >= dates.today && checkOut > checkIn;
    if (datesFilled) {
      url.searchParams.set("checkin", checkIn);
      url.searchParams.set("checkout", checkOut);
    }
    return { href: url.href, host, label: "Search Booking.com", datesFilled };
  }
  if (on(host, "agoda.com")) return { href: url.href, host, label: "Open Agoda", datesFilled: false };
  if (on(host, "grab.com"))
    return { href: url.href, host, label: "Open Grab", datesFilled: false, note: "This opens Grab's information page. It doesn't book a ride." };
  return { href: url.href, host, label: kindLabels[item.kind], datesFilled: false };
}
