import type { ReviewedPlan } from "../src/shared/contracts.ts";
import { addDays } from "./domain.ts";

const escape = (value: string) => value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const compactDate = (date: string) => date.replace(/-/g, "");
const compactTime = (time: string) => `${time.replace(":", "")}00`;
const notices = { cancelled: "Event cancelled", postponed: "Event postponed", unavailable: "Current information unavailable" } as const;

function fold(line: string): string[] {
  const parts: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    parts.push(rest.slice(0, 74));
    rest = ` ${rest.slice(74)}`;
  }
  return [...parts, rest];
}

/** An iCalendar (RFC 5545) export of a reviewed itinerary. Times are Kuching local time (UTC+8, no daylight saving). */
export function toCalendar(plan: ReviewedPlan, now = new Date()): string {
  const stamp = `${now.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//STIS//Sarawak Tourism Information System//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `X-WR-CALNAME:${escape(plan.title)}`, "X-WR-TIMEZONE:Asia/Kuching",
    "BEGIN:VTIMEZONE", "TZID:Asia/Kuching", "BEGIN:STANDARD", "DTSTART:19700101T000000", "TZOFFSETFROM:+0800", "TZOFFSETTO:+0800", "TZNAME:+08",
    "END:STANDARD", "END:VTIMEZONE",
  ];
  for (const entry of plan.entries) {
    const description = [
      entry.notice ? notices[entry.notice] : "",
      entry.dateNotice ? `Published event date: ${entry.eventStartsAt?.slice(0, 10)}` : "",
      entry.note,
      plan.provisional ? "Travel dates are provisional." : "",
    ].filter(Boolean).join("\n");
    lines.push("BEGIN:VEVENT", `UID:${entry.id}@stis`, `DTSTAMP:${stamp}`);
    if (entry.start) {
      lines.push(`DTSTART;TZID=Asia/Kuching:${compactDate(entry.day)}T${compactTime(entry.start)}`,
        `DTEND;TZID=Asia/Kuching:${compactDate(entry.day)}T${compactTime(entry.end)}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${compactDate(entry.day)}`, `DTEND;VALUE=DATE:${compactDate(addDays(entry.day, 1))}`);
    }
    lines.push(`SUMMARY:${escape(entry.title)}`);
    if (entry.location) lines.push(`LOCATION:${escape(entry.location)}`);
    if (description) lines.push(`DESCRIPTION:${escape(description)}`);
    if (entry.notice === "cancelled" || entry.notice === "unavailable") lines.push("STATUS:CANCELLED");
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.flatMap(fold).join("\r\n")}\r\n`;
}
