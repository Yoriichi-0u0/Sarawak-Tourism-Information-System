import { useEffect, useRef, useState, type ReactNode } from "react";
import { CircleUserRound, Compass, Map, Menu, Monitor, Moon, ShieldCheck, Sun, X } from "lucide-react";

import { applyTheme, browserStorage, readTheme, saveTheme, themeChoices, type ThemeChoice } from "../lib/theme";
import { ComparePage, CompareProvider } from "./compare";
import { sectionAt, sections } from "./kinds";
import { ProfilePage, RecoverPage, RegisterPage, SignInPage } from "./pages/Account";
import { DetailPage } from "./pages/Detail";
import { DiscoverPage } from "./pages/Discover";
import { HomePage } from "./pages/Home";
import { StaffPage } from "./pages/Staff";
import { TransportPage } from "./pages/Transport";
import { TripPage, TripsPage } from "./pages/Trips";
import { VisitorInfoPage } from "./pages/VisitorInfo";
import { Link, match, navigate, useLocation } from "./router";
import { isStaff, SessionProvider, useSession } from "./session";
import { readGuestHash, TripProvider, useTrips } from "./trips";
import { Empty, useTitle } from "./ui";

const themeIcons = { auto: Monitor, light: Sun, dark: Moon } as const;

function ThemeSwitch({ choice, onChange, name }: { choice: ThemeChoice; onChange: (choice: ThemeChoice) => void; name: string }) {
  return <div className="theme-switch" role="radiogroup" aria-label="Colour theme">
    {themeChoices.map(([value, text]) => {
      const Icon = themeIcons[value];
      return <label key={value} title={`${text} theme`}>
        <input type="radio" name={name} value={value} checked={choice === value} onChange={() => onChange(value)} aria-label={`${text} theme`} />
        <Icon size={15} aria-hidden="true" /><span>{text}</span>
      </label>;
    })}
  </div>;
}

function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(() => readTheme(browserStorage()));
  useEffect(() => { applyTheme(choice, document.documentElement); saveTheme(choice, browserStorage()); }, [choice]);
  return [choice, setChoice] as const;
}

function current(path: string, target: string) {
  return path === target || path.startsWith(`${target}/`) ? "page" as const : undefined;
}

function Header({ path }: { path: string }) {
  const { account } = useSession();
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useTheme();
  useEffect(() => setOpen(false), [path]);
  const links = sections.map(({ path: to, label, icon: Icon }) => ({ to, label, Icon }));
  return <header className="header">
    <div className="shell header-bar">
      <Link className="brand" to="/"><img src="/icons/sarawak-icon-v2-256.png" alt="" width={34} height={34} />sarawak.<span className="sr-only"> home</span></Link>
      <nav className="nav" aria-label="Explore">
        {links.map(({ to, label }) => <Link key={to} to={to} aria-current={current(path, to)}>{label}</Link>)}
      </nav>
      <div className="header-actions">
        <ThemeSwitch choice={theme} onChange={setTheme} name="theme" />
        <Link className="button ghost small trips-link" to="/trips" aria-current={current(path, "/trips")}><Map size={16} aria-hidden="true" /><span className="label-wide">My trips</span><span className="sr-only">My trips</span></Link>
        {isStaff(account) && <Link className="button ghost small" to="/staff" aria-current={current(path, "/staff")}><ShieldCheck size={16} aria-hidden="true" /><span className="label-wide">Staff</span><span className="sr-only">Staff console</span></Link>}
        {account === undefined ? null : account
          ? <Link className="button secondary small" to="/account" aria-current={current(path, "/account")}><CircleUserRound size={16} aria-hidden="true" /><span className="label-wide">{account.displayName || "Account"}</span><span className="sr-only">Your account</span></Link>
          : <Link className="button primary small" to="/account/sign-in">Sign in</Link>}
        <button className="icon-button menu-button" aria-expanded={open} aria-controls="mobile-nav" onClick={() => setOpen(!open)}>
          {open ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}<span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
        </button>
      </div>
    </div>
    <nav className="shell mobile-nav" id="mobile-nav" data-open={open} aria-label="Explore (menu)" hidden={!open}>
      {links.map(({ to, label, Icon }) => <Link key={to} to={to} aria-current={current(path, to)}><Icon size={18} aria-hidden="true" />{label}</Link>)}
      <Link className="mobile-only" to="/trips" aria-current={current(path, "/trips")}><Map size={18} aria-hidden="true" />My trips</Link>
      <div className="mobile-only mobile-theme"><span className="small muted">Theme</span><ThemeSwitch choice={theme} onChange={setTheme} name="theme-menu" /></div>
    </nav>
  </header>;
}

function Footer() {
  return <footer className="footer">
    <div className="shell footer-grid">
      <div>
        <p style={{ margin: 0 }}><strong style={{ color: "var(--ink)" }}>sarawak.</strong> · Sarawak Tourism Information System</p>
        <p className="small" style={{ margin: 0 }}>An independent student project. Not affiliated with Sarawak Tourism Board. Check details with official providers before you travel.</p>
      </div>
      <p className="small" style={{ margin: 0 }}>Official tourism information: <a href="https://www.sarawaktourism.com/" target="_blank" rel="noopener noreferrer">sarawaktourism.com<span className="sr-only"> (opens an external site)</span></a></p>
    </div>
  </footer>;
}

function NotFound() {
  useTitle("Page not found");
  return <Empty page icon={Compass} title="We couldn't find that page">
    <p>The link may be out of date, or the page has moved.</p>
    <Link className="button primary" to="/">Back to discover</Link>
  </Empty>;
}

function GuestTrip({ hash }: { hash: string }) {
  const { guest, setGuest } = useTrips();
  const link = readGuestHash(hash) ?? guest;
  useEffect(() => { if (link && (link.id !== guest?.id || link.token !== guest?.token)) setGuest(link); }, [link, guest, setGuest]);
  if (!link) return <Empty page icon={Map} title="This guest trip link is incomplete">
    <p>Guest trips open from the full private link that was shown when the trip was created.</p>
    <Link className="button primary" to="/trips">Go to my trips</Link>
  </Empty>;
  return <TripPage key={link.id} id={link.id} guest={link} />;
}

function Routes({ path, hash }: { path: string; hash: string }): ReactNode {
  if (path === "/") return <HomePage />;
  const section = sectionAt(path);
  if (section) {
    if (section.kind === "transportation") return <TransportPage />;
    if (section.kind === "visitor") return <VisitorInfoPage />;
    return <DiscoverPage key={section.kind} kind={section.kind} />;
  }
  const detail = match("/:section/:id", path);
  const detailSection = detail && sectionAt(`/${detail.section}`);
  if (detail && detailSection) return <DetailPage key={detail.id} kind={detailSection.kind} id={detail.id} />;
  const compare = match("/compare/:kind", path);
  const compareSection = compare && sections.find(({ kind }) => kind === compare.kind);
  if (compareSection) return <ComparePage kind={compareSection.kind} />;
  if (match("/trips", path)) return <TripsPage />;
  if (match("/trips/guest", path)) return <GuestTrip hash={hash} />;
  const trip = match("/trips/:id", path);
  if (trip) return <TripPage key={trip.id} id={trip.id} />;
  if (match("/account", path)) return <ProfilePage />;
  if (match("/account/sign-in", path)) return <SignInPage />;
  if (match("/account/register", path)) return <RegisterPage />;
  if (match("/account/recover", path)) return <RecoverPage />;
  if (match("/staff", path)) return <StaffPage />;
  return <NotFound />;
}

function Shell() {
  const { path, hash } = useLocation();
  const main = useRef<HTMLElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (path === "/" && /^#itinerary\//.test(hash) && readGuestHash(hash)) {
      const link = readGuestHash(hash)!;
      navigate(`/trips/guest#${link.id}/${link.token}`, { replace: true });
    }
  }, [path, hash]);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    main.current?.focus({ preventScroll: true });
  }, [path]);
  return <>
    <button className="skip-link" onClick={() => main.current?.focus()}>Skip to main content</button>
    <Header path={path} />
    <main id="main" ref={main} tabIndex={-1} className="shell page">
      <Routes path={path} hash={hash} />
    </main>
    <Footer />
  </>;
}

export default function App() {
  return <SessionProvider>
    <TripProvider>
      <CompareProvider>
        <Shell />
      </CompareProvider>
    </TripProvider>
  </SessionProvider>;
}
