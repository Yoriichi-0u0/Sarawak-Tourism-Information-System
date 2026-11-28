import { ShieldCheck } from "lucide-react";

import { Link } from "../router";
import { useTitle } from "../ui";

export function PrivacyPage() {
  useTitle("Privacy and your data");
  return <div className="stack prose" style={{ maxWidth: "72ch" }}>
    <div><p className="eyebrow"><ShieldCheck size={16} aria-hidden="true" />Privacy</p><h1>Privacy and your data</h1>
      <p className="muted">STIS is an independent student project, not a service of Sarawak Tourism Board. This notice explains what the system stores about you,
        written with Malaysia's Personal Data Protection Act 2010 in mind. Last updated 24 November 2026.</p></div>

    <section className="stack" style={{ gap: 8 }} aria-labelledby="privacy-browse">
      <h2 id="privacy-browse">Browsing</h2>
      <p>You can explore every listing without an account. There are no analytics, advertising or tracking scripts, and no third-party cookies.
        Your browser keeps only your colour theme choice (the <code>stis-theme</code> setting), and only if you pick Light or Dark.</p>
    </section>

    <section className="stack" style={{ gap: 8 }} aria-labelledby="privacy-account">
      <h2 id="privacy-account">If you create an account</h2>
      <ul>
        <li><strong>Stored:</strong> your email address, display name, a password hash (scrypt; the password itself is never stored),
          fingerprints of your one-time recovery codes, and the trips you save.</li>
        <li><strong>Sign-in session:</strong> one HttpOnly cookie identifies your session. Tourist sessions end after 14 days without use
          (30 days at most); staff sessions after 30 minutes without use (8 hours at most).</li>
        <li><strong>Abuse protection:</strong> failed sign-in and recovery attempts are counted against a one-way fingerprint of the email address and of your
          network address. The fingerprints are not linked to your account.</li>
        <li><strong>Kept until you delete it:</strong> use <Link to="/account">Delete my account</Link> on your account page. Your account,
          sessions, recovery codes and saved trips are removed at once.</li>
      </ul>
    </section>

    <section className="stack" style={{ gap: 8 }} aria-labelledby="privacy-guest">
      <h2 id="privacy-guest">Guest trips and shared links</h2>
      <p>A guest trip is stored with a fingerprint of its private link, not with any personal detail. It stays until you delete it from the trip page or save it
        to an account. A view-only link shows the trip, including your notes, to anyone who has it; replace or stop the link from the trip page at any time.
        Links are never written to server logs.</p>
    </section>

    <section className="stack" style={{ gap: 8 }} aria-labelledby="privacy-bookings">
      <h2 id="privacy-bookings">Bookings you mark in a trip</h2>
      <p>When you mark a stop as booked or reserved, STIS stores only who it is with (the provider's website name, or "phone") and, for a stay, the check-out
        date. STIS does not check the booking and never receives payment or booking details from providers. If you add a booking reference, it is saved in
        that stop's note: like your other notes, anyone with a view-only link to the trip can see it. Clearing the booking mark leaves the note as it is, so
        edit the note to remove the reference.</p>
    </section>

    <section className="stack" style={{ gap: 8 }} aria-labelledby="privacy-where">
      <h2 id="privacy-where">Where data is kept</h2>
      <p>The database is hosted by Supabase in Singapore, and the application by Vercel, with its server functions in Singapore. Error logs record only the
        request type, route and status code, never passwords, session cookies, links or form contents. STIS does not sell or share your data, and bookings and
        payments happen on the providers' own websites under their own terms.</p>
    </section>

    <section className="stack" style={{ gap: 8 }} aria-labelledby="privacy-staff">
      <h2 id="privacy-staff">Staff</h2>
      <p>Staff accounts work the same way. Each published change records which staff account made it, so the history of tourism information stays accountable.</p>
    </section>
  </div>;
}
