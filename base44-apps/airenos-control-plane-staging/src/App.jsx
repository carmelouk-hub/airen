import {
  Activity,
  ArrowRight,
  BadgeCheck,
  BrainCircuit,
  Building2,
  CircleDot,
  DatabaseZap,
  Fingerprint,
  Gauge,
  Network,
  Orbit,
  ShieldCheck,
  Sparkles,
  UsersRound,
} from "lucide-react";

const intelligenceLayers = [
  { icon: Activity, name: "Observation Ledger", state: "North Star" },
  { icon: Fingerprint, name: "Purpose & Authorization Graph", state: "North Star" },
  { icon: Network, name: "Evidence-backed Claim Graph", state: "North Star" },
  { icon: Orbit, name: "Relationship Twin", state: "North Star" },
  { icon: BrainCircuit, name: "Governed Action Orchestrator", state: "North Star" },
  { icon: BadgeCheck, name: "Correction & Contestability", state: "North Star" },
];

const certifications = [
  { label: "T20 mandatory tests", value: "0 / 66", tone: "blocked" },
  { label: "Portable Booking", value: "Fail closed", tone: "blocked" },
  { label: "Golden Restaurant E2E", value: "Not authorized", tone: "waiting" },
];

function LayerCard({ icon: Icon, name, state }) {
  return (
    <article className="layer-card">
      <div className="layer-icon"><Icon size={19} /></div>
      <div>
        <h3>{name}</h3>
        <p>{state} · non operational</p>
      </div>
      <ArrowRight className="layer-arrow" size={17} />
    </article>
  );
}

export default function App() {
  return (
    <main className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <aside className="rail">
        <div className="brand-lockup">
          <img src="/airenos-icon.png" alt="AIRenOS" />
          <div><strong>AIRenOS</strong><span>Control Plane</span></div>
        </div>

        <nav aria-label="Primary">
          <a className="nav-item active" href="#overview"><Gauge size={18} />Overview</a>
          <a className="nav-item" href="#intelligence"><Sparkles size={18} />Intelligence OS</a>
          <a className="nav-item" href="#relationships"><UsersRound size={18} />Relationships</a>
          <a className="nav-item" href="#organizations"><Building2 size={18} />Organizations</a>
          <a className="nav-item" href="#governance"><ShieldCheck size={18} />Governance</a>
        </nav>

        <div className="rail-boundary">
          <ShieldCheck size={18} />
          <div><strong>Foundation protected</strong><span>Provider-neutral authority</span></div>
        </div>
      </aside>

      <section className="workspace" id="overview">
        <header className="topbar">
          <div>
            <p className="eyebrow">SYSTEM FOR THE FUTURE · 2050</p>
            <h1>Relationship intelligence,<br />under human authority.</h1>
          </div>
          <div className="environment-pill"><CircleDot size={14} />STAGING SHELL</div>
        </header>

        <section className="hero-grid">
          <article className="signal-panel glass-panel">
            <div className="panel-heading">
              <div><span className="kicker">North Star</span><h2>Relationship Intelligence OS</h2></div>
              <div className="live-orbit"><span /><Orbit size={24} /></div>
            </div>
            <p className="panel-copy">A governed operating system for evidence-backed customer and supplier relationships. This staging surface contains no operational or production data.</p>
            <div className="signal-line"><span /><i /><i /><i /><i /></div>
            <div className="boundary-flow">
              <div><Sparkles size={17} />Base44 experience</div>
              <ArrowRight size={16} />
              <div><DatabaseZap size={17} />Accepted typed APIs</div>
              <ArrowRight size={16} />
              <div><ShieldCheck size={17} />AIRenOS Foundation</div>
            </div>
          </article>

          <article className="cert-panel glass-panel" id="governance">
            <span className="kicker">Certification radar</span>
            <h2>Promotion is fail-closed</h2>
            <div className="cert-list">
              {certifications.map((item) => (
                <div className="cert-row" key={item.label}>
                  <span>{item.label}</span><strong className={item.tone}>{item.value}</strong>
                </div>
              ))}
            </div>
            <p className="cert-note"><ShieldCheck size={15} /> No runtime promotion before governance evidence.</p>
          </article>
        </section>

        <section className="layers" id="intelligence">
          <div className="section-title">
            <div><span className="kicker">Cognitive architecture</span><h2>Six governed intelligence layers</h2></div>
            <span className="read-only">DESIGN VIEW · READ ONLY</span>
          </div>
          <div className="layer-grid">
            {intelligenceLayers.map((layer) => <LayerCard key={layer.name} {...layer} />)}
          </div>
        </section>

        <footer>
          <span>AIRenOS Control Plane · staging foundation</span>
          <span>No production data · no authoritative Base44 entities</span>
        </footer>
      </section>
    </main>
  );
}
