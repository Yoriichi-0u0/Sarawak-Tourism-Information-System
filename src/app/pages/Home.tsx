import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, CalendarHeart, PhoneCall, Search, ShieldCheck } from "lucide-react";

import { api } from "../../lib/api";
import type { TourismItem } from "../../shared/contracts";
import { sections } from "../kinds";
import { Link, navigate } from "../router";
import { useSession } from "../session";
import { mediaAsset } from "../../shared/media";
import { Picture, today, useTitle } from "../ui";
import { ResultCard } from "./Discover";

const hero = mediaAsset("santubong-river");

export function HomePage() {
  const { account } = useSession();
  const [destinations, setDestinations] = useState<TourismItem[]>([]);
  const [events, setEvents] = useState<TourismItem[]>([]);
  const [emergency, setEmergency] = useState<TourismItem>();
  useTitle("");
  useEffect(() => {
    void api<TourismItem[]>("catalog/destination").then((items) => setDestinations(items.filter(({ fields }) => fields.provenance === "verified").slice(0, 4))).catch(() => {});
    void api<TourismItem[]>(`catalog/event?from=${today()}`).then((items) => setEvents(items.filter(({ fields }) => fields.status !== "cancelled").slice(0, 3))).catch(() => {});
    void api<TourismItem[]>("catalog/visitor?category=emergency").then((items) => setEmergency(items[0])).catch(() => {});
  }, []);
  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = String(new FormData(event.currentTarget).get("query") ?? "").trim();
    navigate(`/destinations${query ? `?${new URLSearchParams({ query })}` : ""}`);
  }
  return <>
    <section className="hero" aria-labelledby="hero-title">
      {hero && <Picture asset={hero} sizes="(max-width: 1240px) 100vw, 1200px" eager />}
      <div className="hero-content">
        <h1 id="hero-title">Explore Sarawak, plan with confidence.</h1>
        <p>Destinations, stays, transport, food, events and visitor information in one place. Then build a day-by-day trip you can come back to.</p>
        <form className="hero-search" role="search" onSubmit={search}>
          <label className="sr-only" htmlFor="hero-query">Search destinations</label>
          <input id="hero-query" name="query" type="search" placeholder="Search destinations, e.g. Bako, Mulu, Kuching" maxLength={200} />
          <button className="button primary"><Search size={18} aria-hidden="true" />Search</button>
        </form>
      </div>
      {hero && <span className="image-note">{hero.subject} · Photo: {hero.author}, {hero.licence} · <Link to="/credits">Credits</Link></span>}
    </section>
    <nav className="tiles" aria-label="Browse by category">
      {sections.map(({ path, label, blurb, icon: Icon }) => <Link key={path} className="tile" to={path}><Icon size={26} aria-hidden="true" /><strong>{label}</strong><span>{blurb}</span></Link>)}
    </nav>
    {destinations.length > 0 && <section className="section" aria-labelledby="featured">
      <div className="section-head"><h2 id="featured">Popular destinations</h2><Link to="/destinations">All destinations <ArrowRight size={14} aria-hidden="true" /></Link></div>
      <div className="grid">{destinations.map((item) => <ResultCard key={item.id} item={item} />)}</div>
    </section>}
    {events.length > 0 && <section className="section" aria-labelledby="upcoming">
      <div className="section-head"><h2 id="upcoming">Coming up</h2><Link to="/events">All events <ArrowRight size={14} aria-hidden="true" /></Link></div>
      <div className="grid">{events.map((item) => <ResultCard key={item.id} item={item} />)}</div>
    </section>}
    <section className="section grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))" }}>
      <div className="panel stack" style={{ gap: 10 }}>
        <p className="eyebrow"><CalendarHeart size={16} aria-hidden="true" />Plan your trip</p>
        <h2 style={{ margin: 0 }}>{account ? `Welcome back, ${account.displayName}` : "Build a day-by-day plan"}</h2>
        <p className="muted" style={{ margin: 0 }}>Add destinations, events, stays and transport to a multi-day itinerary. STIS flags time conflicts and event changes for you.</p>
        <div className="row">{account ? <Link className="button primary" to="/trips">My trips</Link>
          : <><Link className="button primary" to="/account/register">Create an account</Link><Link className="button secondary" to="/trips">Plan as a guest</Link></>}</div>
      </div>
      {emergency && <div className="panel stack" style={{ gap: 10 }}>
        <p className="eyebrow"><PhoneCall size={16} aria-hidden="true" />Travel safely</p>
        <h2 style={{ margin: 0 }}>{emergency.fields.title}</h2>
        <p className="muted" style={{ margin: 0 }}>{emergency.fields.summary}</p>
        <div className="row"><Link className="button secondary" to="/visitor-info">All visitor information</Link></div>
      </div>}
      <div className="panel stack" style={{ gap: 10 }}>
        <p className="eyebrow"><ShieldCheck size={16} aria-hidden="true" />Honest information</p>
        <h2 style={{ margin: 0 }}>Know where facts come from</h2>
        <p className="muted" style={{ margin: 0 }}>Every listing is labelled Verified, Reported, STIS guidance or Illustrative. STIS never shows invented prices, timetables or availability. Bookings happen with the provider.</p>
      </div>
    </section>
  </>;
}
