import {
  ArrowUpRight,
  BookOpenCheck,
  Bot,
  Building2,
  CalendarClock,
  ChefHat,
  CircleDot,
  LockKeyhole,
  MapPin,
  PackageSearch,
  ShieldCheck,
  Sparkles,
  UserRoundCheck,
  UsersRound,
  Utensils,
} from "lucide-react";

const lifecycle = ["Requested", "Pending", "Confirmed", "Arrived", "Seated", "Completed"];

const airenIconUrl = "https://raw.githubusercontent.com/carmelouk-hub/airen/cd9b3db1de61f3898f835078a8fe9af991a62060/base44-apps/airenos-control-plane-staging/public/airenos-icon.png";

const modules = [
  { icon: CalendarClock, name: "Booking", copy: "Portable contract pending T20", status: "Gated" },
  { icon: UsersRound, name: "Guest relationships", copy: "Consent-aware design surface", status: "Design" },
  { icon: ChefHat, name: "Service operations", copy: "No operational data connected", status: "Shell" },
  { icon: PackageSearch, name: "Supplier relationships", copy: "Evidence-backed future layer", status: "North Star" },
  { icon: Bot, name: "STELLA", copy: "Governed assistance, no direct writes", status: "Read only" },
  { icon: BookOpenCheck, name: "Governance evidence", copy: "Certification and parity trail", status: "Active" },
];

function ModuleCard({ icon: Icon, name, copy, status }) {
  return (
    <article className="module-card">
      <div className="module-top"><span className="module-icon"><Icon size={20} /></span><small>{status}</small></div>
      <h3>{name}</h3>
      <p>{copy}</p>
      <ArrowUpRight size={17} className="module-arrow" />
    </article>
  );
}

export default function App() {
  return (
    <main className="restaurant-shell">
      <div className="light-field field-one" />
      <div className="light-field field-two" />

      <header className="main-header">
        <div className="brand">
          <img src={airenIconUrl} alt="AIRenOS" />
          <div><strong>Risto<span>AIRen</span></strong><small>Powered by AIRenOS</small></div>
        </div>
        <nav>
          <a className="active" href="#home">Home</a>
          <a href="#journey">Journey</a>
          <a href="#modules">Modules</a>
          <a href="#governance">Governance</a>
        </nav>
        <div className="stage-badge"><CircleDot size={13} />STAGING</div>
      </header>

      <section className="content" id="home">
        <div className="hero">
          <div className="hero-copy">
            <p className="eyebrow"><Utensils size={14} /> RESTAURANT INTELLIGENCE VERTICAL</p>
            <h1>Every service.<br /><span>One living relationship.</span></h1>
            <p className="lead">A future-facing restaurant experience built on trusted context, explicit authorization and governed intelligence — without moving authority into Base44.</p>
            <div className="context-strip">
              <span><Building2 size={15} />Tenant not resolved</span>
              <span><MapPin size={15} />Location not resolved</span>
              <strong><LockKeyhole size={15} />Fail closed</strong>
            </div>
          </div>

          <div className="orbital-card">
            <div className="orbital-ring ring-one" />
            <div className="orbital-ring ring-two" />
            <img src={airenIconUrl} alt="" />
            <div className="orbit-label label-one"><ShieldCheck size={14} />Trusted context</div>
            <div className="orbit-label label-two"><UserRoundCheck size={14} />Human authority</div>
            <div className="orbit-label label-three"><Sparkles size={14} />Governed intelligence</div>
          </div>
        </div>

        <section className="journey-panel" id="journey">
          <div className="journey-title">
            <div><span className="section-kicker">Canonical Booking lifecycle</span><h2>Journey contract view</h2></div>
            <span className="locked"><LockKeyhole size={13} />OPERATIONS LOCKED · T20</span>
          </div>
          <div className="journey-track">
            {lifecycle.map((step, index) => (
              <div className="journey-step" key={step}>
                <span>{String(index + 1).padStart(2, "0")}</span><strong>{step}</strong>
                {index < lifecycle.length - 1 && <i />}
              </div>
            ))}
          </div>
          <p className="journey-note">Alternative terminal states: Cancelled · No show. This is a design representation, not an executable Booking runtime.</p>
        </section>

        <section id="modules">
          <div className="module-heading"><div><span className="section-kicker">Vertical architecture</span><h2>Restaurant operating surfaces</h2></div><p>No production fixtures or authoritative entities.</p></div>
          <div className="module-grid">{modules.map((module) => <ModuleCard key={module.name} {...module} />)}</div>
        </section>

        <section className="governance-band" id="governance">
          <ShieldCheck size={26} />
          <div><strong>Foundation authority remains external</strong><span>All future mutations must pass trusted Tenant/Location resolution, permissions, entitlements, idempotency, audit and outbox.</span></div>
          <span className="evidence">0 / 66 T20 tests</span>
        </section>

        <footer><span>RistoAIRen · staging shell</span><span>System for the future · 2050</span></footer>
      </section>
    </main>
  );
}
