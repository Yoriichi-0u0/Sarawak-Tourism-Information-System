import { useEffect, useState } from "react";
import { CalendarDays, Compass, Map, ShieldCheck } from "lucide-react";

import { Catalogue } from "./Catalogue";
import { Planner, readLink } from "./Planner";
import { Staff } from "./Staff";
import { TravelInformation } from "./TravelInformation";
import type { TourismItem } from "./contracts";
import "./as03.css";

const sections = [
  { key: "destinations", name: "Destinations", icon: Compass },
  { key: "events", name: "Events", icon: CalendarDays },
  { key: "itinerary", name: "Itinerary", icon: Map },
  { key: "staff", name: "Staff", icon: ShieldCheck },
] as const;
type Section = typeof sections[number]["key"];

export default function Experience() {
  const [section, setSection] = useState<Section>(() => readLink() ? "itinerary" : "destinations");
  const [selection, setSelection] = useState<TourismItem>();
  useEffect(() => {
    function openItineraryLink() {
      if (readLink()) setSection("itinerary");
    }
    window.addEventListener("hashchange", openItineraryLink);
    return () => window.removeEventListener("hashchange", openItineraryLink);
  }, []);
  function navigate(target: Section) {
    setSection(target);
    window.scrollTo(0, 0);
  }

  return <div className="as03">
    <a className="skip-link" href="#as03-main" onClick={(event) => {
      event.preventDefault();
      document.getElementById("as03-main")?.focus();
    }}>Skip to content</a>
    <header className="as03-header">
      <div className="as03-shell as03-topbar">
        <button className="as03-brand" onClick={() => navigate("destinations")}>
          <img src="/icons/hornbill-256.png" width={42} height={42} alt="" />
          <span>sarawak.</span>
        </button>
        <nav aria-label="Main navigation">{sections.map(({ key, name, icon: Icon }) =>
          <button key={key} aria-current={section === key ? "page" : undefined} onClick={() => navigate(key)}>
            <Icon size={18} /> {name}
          </button>)}</nav>
      </div>
    </header>
    <main id="as03-main" className="as03-shell as03-main" tabIndex={-1}>
      {section === "destinations" && <section className="as03-hero">
        <img src="/images/hero.webp" alt="" />
        <div><p>Explore Sarawak</p><h1>Find your next stop.</h1><p>Discover destinations, find events and map out your time in Sarawak.</p></div>
      </section>}
      {section === "events" && <section className="as03-section-title">
        <p className="as03-meta"><CalendarDays size={18} /> What’s on</p>
        <h1>Find events</h1><p>Search the demonstration catalogue by date or location.</p>
      </section>}
      {(section === "destinations" || section === "events") && <Catalogue key={section} mode={section} select={(item) => {
        setSelection(item); navigate("itinerary");
      }} />}
      {section === "destinations" && <TravelInformation />}
      {section === "itinerary" && <Planner selection={selection} clearSelection={() => setSelection(undefined)} browse={() => navigate("destinations")} />}
      {section === "staff" && <Staff />}
    </main>
    <footer className="as03-footer"><div className="as03-shell">Sarawak Tourism Information System · Assessment demonstration</div></footer>
  </div>;
}
