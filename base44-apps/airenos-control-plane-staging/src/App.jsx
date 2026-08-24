import { useState } from "react";
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  Ban,
  BrainCircuit,
  Building2,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  DatabaseZap,
  Eye,
  Fingerprint,
  Gauge,
  GitBranch,
  History,
  KeyRound,
  LockKeyhole,
  Network,
  Orbit,
  RefreshCcw,
  Scale,
  ShieldCheck,
  Sparkles,
  UserRound,
  UsersRound,
} from "lucide-react";
import {
  acceptanceChecks,
  customerReviewClaims,
  declaredPreferenceEvidenceStatus,
  governanceState,
  openDecisions,
  purposeReviewCatalog,
  supplierReviewClaims,
} from "./reviewData";

const navigation = [
  { id: "overview", label: "Overview", icon: Gauge },
  { id: "customers", label: "Customer Twin", icon: UserRound },
  { id: "suppliers", label: "Supplier Twin", icon: Building2 },
  { id: "authorization", label: "Purpose & Authority", icon: Fingerprint },
  { id: "governance", label: "Promotion Review", icon: ShieldCheck },
];

const airenIconUrl = "https://raw.githubusercontent.com/carmelouk-hub/airen/cd9b3db1de61f3898f835078a8fe9af991a62060/base44-apps/airenos-control-plane-staging/public/airenos-icon.png";

const architectureLayers = [
  { icon: Activity, name: "Observation Ledger", note: "Authorized events remain observations" },
  { icon: Fingerprint, name: "Purpose & Authorization Graph", note: "Purpose never replaces permission" },
  { icon: Network, name: "Evidence-backed Claim Graph", note: "Claims remain traceable and contestable" },
  { icon: Orbit, name: "Relationship Twin", note: "Purpose-specific reconstructable projection" },
  { icon: BrainCircuit, name: "Governed Action Orchestrator", note: "Proposals traverse application services" },
  { icon: RefreshCcw, name: "Correction & Contestability", note: "History is superseded, never hidden" },
];

const claimTone = {
  PROPOSED: "proposed",
  CONFIRMED: "confirmed",
  CORRECTED: "corrected",
  REJECTED: "rejected",
  EXPIRED: "expired",
  SUPERSEDED: "superseded",
};

function ClaimCard({ claim }) {
  return (
    <article className="claim-card">
      <div className="claim-head">
        <span className={`claim-state ${claimTone[claim.state] || ""}`}>{claim.state}</span>
        <Eye size={16} />
      </div>
      <h3>{claim.subject}</h3>
      <dl>
        <div><dt>Evidence</dt><dd>{claim.evidence}</dd></div>
        <div><dt>Guardrail</dt><dd>{claim.guardrail}</dd></div>
      </dl>
    </article>
  );
}

function TwinReview({ kind }) {
  const isCustomer = kind === "customer";
  const claims = isCustomer ? customerReviewClaims : supplierReviewClaims;
  const title = isCustomer ? "Customer Relationship Twin" : "Supplier Relationship Twin";
  const subject = isCustomer ? "SYNTHETIC CUSTOMER · REVIEW A" : "SYNTHETIC SUPPLIER · REVIEW A";

  return (
    <section className="view-stack">
      <header className="view-header">
        <div>
          <span className="kicker">Design review · synthetic only</span>
          <h1>{title}</h1>
          <p>A purpose-specific projection of evidence-backed claims. This screen has no persistence, operational identity or executable action.</p>
        </div>
        <span className="read-only"><LockKeyhole size={13} />READ ONLY</span>
      </header>

      <article className="subject-band">
        <div className="subject-avatar">{isCustomer ? <UserRound size={23} /> : <Building2 size={23} />}</div>
        <div><span>Illustrative subject</span><strong>{subject}</strong></div>
        <div className="subject-boundary"><ShieldCheck size={15} />No real identity · no cross-Tenant merge</div>
      </article>

      <div className="claim-grid">
        {claims.map((claim) => <ClaimCard key={claim.subject} claim={claim} />)}
      </div>

      <div className="twin-bottom-grid">
        <article className="boundary-card">
          <Ban size={21} />
          <div>
            <span>Forbidden inference boundary</span>
            <strong>{isCustomer ? "No protected or sensitive traits inferred from behavior" : "No opaque score, automatic exclusion or penalty"}</strong>
          </div>
        </article>
        <article className="boundary-card safe">
          <History size={21} />
          <div><span>Correction model</span><strong>Add evidence and explicit supersede semantics</strong></div>
        </article>
      </div>
    </section>
  );
}

function AuthorizationReview() {
  const flow = [
    { icon: UserRound, title: "Trusted actor", note: "Not resolved in this shell" },
    { icon: KeyRound, title: "Permission & entitlement", note: "Required before purpose evaluation" },
    { icon: Fingerprint, title: "Purpose & lawful basis", note: "Catalog and matrix remain open" },
    { icon: Eye, title: "Minimized projection", note: "Allowed fields only" },
    { icon: Sparkles, title: "Action proposal", note: "Never self-approved" },
  ];

  return (
    <section className="view-stack">
      <header className="view-header">
        <div><span className="kicker">Trust & Purpose Fabric</span><h1>Purpose is a constraint, not a shortcut.</h1><p>Consent may be one lawful basis. It never replaces trusted scope, permission, entitlement or human control.</p></div>
        <span className="read-only"><LockKeyhole size={13} />DESIGN GATE</span>
      </header>

      <div className="authorization-flow">
        {flow.map((step, index) => (
          <div className="flow-step" key={step.title}>
            <span><step.icon size={20} /></span>
            <strong>{step.title}</strong>
            <small>{step.note}</small>
            {index < flow.length - 1 && <ChevronRight size={18} className="flow-arrow" />}
          </div>
        ))}
      </div>

      <section className="purpose-catalog" aria-label="Candidate purpose catalog">
        <div className="section-heading">
          <div><span className="kicker">Purpose catalog v0.1</span><h2>Six candidates. Zero active purposes.</h2></div>
          <span>LEGAL BASIS APPROVED · 0</span>
        </div>
        <div className="purpose-grid">
          {purposeReviewCatalog.map((purpose) => (
            <article key={purpose.id} className="purpose-card">
              <div><span>{purpose.id}</span><strong>{purpose.status}</strong></div>
              <h3>{purpose.label}</h3>
              <p>{purpose.subject}</p>
              <dl>
                <div><dt>Candidate operations</dt><dd>{purpose.operation}</dd></div>
                <div><dt>Lawful basis</dt><dd>{purpose.legalBasis}</dd></div>
                <div><dt>Qualified review</dt><dd className={purpose.reviewState === "PACKET READY" ? "packet-ready" : ""}>{purpose.reviewState}</dd></div>
              </dl>
            </article>
          ))}
        </div>
        <article className="review-packet-band">
          <div><Scale size={21} /><span><small>Selected review packet</small><strong>PUR-CUST-DECLARED-PREFERENCE-v0</strong></span></div>
          <dl>
            <div><dt>Packet</dt><dd>READY</dd></div>
            <div><dt>Decision form</dt><dd>READY</dd></div>
            <div><dt>Decision</dt><dd>NOT RECORDED</dd></div>
            <div><dt>Lawful basis</dt><dd>TBD · 0 APPROVED</dd></div>
            <div><dt>Qualified sign-off</dt><dd>MISSING</dd></div>
            <div><dt>Purpose</dt><dd>DISABLED</dd></div>
          </dl>
        </article>
        <article className="evidence-bundle-band">
          <div><DatabaseZap size={21} /><span><small>Evidence bundle index</small><strong>{declaredPreferenceEvidenceStatus.indexState}</strong></span></div>
          <dl>
            <div><dt>Required slots</dt><dd>{declaredPreferenceEvidenceStatus.required}</dd></div>
            <div><dt>Ready</dt><dd>{declaredPreferenceEvidenceStatus.ready}</dd></div>
            <div><dt>Partial</dt><dd>{declaredPreferenceEvidenceStatus.partial}</dd></div>
            <div><dt>Missing</dt><dd>{declaredPreferenceEvidenceStatus.missing}</dd></div>
            <div><dt>Decision</dt><dd>{declaredPreferenceEvidenceStatus.qualifiedDecision}</dd></div>
            <div><dt>Purpose</dt><dd>{declaredPreferenceEvidenceStatus.purposeState}</dd></div>
          </dl>
        </article>
        <article className="journey-evidence-band">
          <div><GitBranch size={21} /><span><small>EBI-R01 · service journey</small><strong>{declaredPreferenceEvidenceStatus.r01CaptureState}</strong></span></div>
          <dl>
            <div><dt>Requirement</dt><dd>{declaredPreferenceEvidenceStatus.r01RequirementState}</dd></div>
            <div><dt>Exact journey</dt><dd>{declaredPreferenceEvidenceStatus.exactJourneyVerified ? "VERIFIED" : "NOT VERIFIED"}</dd></div>
            <div><dt>Factual owner</dt><dd>{declaredPreferenceEvidenceStatus.factualOwnerState}</dd></div>
            <div><dt>Purpose</dt><dd>{declaredPreferenceEvidenceStatus.purposeState}</dd></div>
          </dl>
        </article>
      </section>

      <div className="authorization-grid">
        <article className="matrix-card">
          <span className="kicker">Candidate binding</span>
          <h2>Every use must explain itself</h2>
          {["Purpose", "Lawful basis", "Data category", "Authorized actor", "Recipient", "Duration", "Revocation policy", "Allowed operation"].map((item) => (
            <div className="matrix-row" key={item}><span>{item}</span><strong>Governance decision required</strong></div>
          ))}
        </article>
        <article className="fail-card">
          <LockKeyhole size={30} />
          <span>Current result</span>
          <h2>FAIL CLOSED</h2>
          <p>The candidate catalog is specified but every purpose remains disabled. No lawful basis is approved, so the design cannot grant access or execute an action.</p>
        </article>
      </div>
    </section>
  );
}

function GovernanceReview() {
  return (
    <section className="view-stack">
      <header className="view-header">
        <div><span className="kicker">NEXT-AIR-002 governed design</span><h1>Design authority, without runtime authority.</h1><p>Option A authorizes contracts, governance, DPIA preparation and threat modelling only. The proposal remains non-canonical.</p></div>
        <span className="read-only"><BadgeCheck size={13} />DESIGN ONLY</span>
      </header>

      <div className="review-grid">
        <article className="review-panel">
          <div className="panel-title"><CheckCircle2 size={20} /><div><span>Acceptance foundation</span><strong>12 required proofs</strong></div></div>
          <div className="check-list">
            {acceptanceChecks.map((check, index) => (
              <div key={check}><span>{String(index + 1).padStart(2, "0")}</span><p>{check}</p><small>PENDING</small></div>
            ))}
          </div>
        </article>
        <article className="review-panel">
          <div className="panel-title"><Scale size={20} /><div><span>Open governance</span><strong>10 decisions</strong></div></div>
          <div className="decision-list">
            {openDecisions.map((decision, index) => (
              <div key={decision}><span>{index + 1}</span><p>{decision}</p></div>
            ))}
          </div>
        </article>
      </div>

      <article className="promotion-gate">
        <div><LockKeyhole size={24} /><span>Promotion gate</span></div>
        <strong>RUNTIME BLOCKED · separate governance decision required</strong>
        <button disabled>Promote to implementation</button>
      </article>
    </section>
  );
}

function Overview({ onNavigate }) {
  return (
    <section className="view-stack">
      <header className="view-header hero-heading">
        <div><span className="kicker">SYSTEM FOR THE FUTURE · 2050</span><h1>Relationship intelligence,<br />under human authority.</h1><p>A governed design workspace for evidence-backed customer and supplier relationships. No operational or production data is present.</p></div>
        <span className="read-only"><CircleDot size={13} />STAGING REVIEW</span>
      </header>

      <section className="overview-grid">
        <article className="north-star-panel">
          <div className="panel-title"><Orbit size={22} /><div><span>North Star</span><strong>Dual-layer relationship framework</strong></div></div>
          <div className="dual-layer">
            <button onClick={() => onNavigate("authorization")}><Fingerprint size={19} /><span><strong>AIRenOS Trust & Purpose Fabric</strong><small>Shared primitives · candidate only</small></span><ArrowRight size={17} /></button>
            <button onClick={() => onNavigate("customers")}><GitBranch size={19} /><span><strong>Vertical Relationship Twins</strong><small>Purpose-specific projections · review only</small></span><ArrowRight size={17} /></button>
          </div>
        </article>
        <article className="state-panel">
          <span className="kicker">Governance state</span>
          <h2>{governanceState.state}</h2>
          <div><span>Design phase</span><strong className="safe-text">Authorized</strong></div>
          <div><span>Implementation</span><strong>Not authorized</strong></div>
          <div><span>Canonical promotion</span><strong>Not authorized</strong></div>
          <div><span>Fixture class</span><strong className="safe-text">Synthetic only</strong></div>
          <button onClick={() => onNavigate("governance")}>Open governed design review <ArrowRight size={15} /></button>
        </article>
      </section>

      <section>
        <div className="section-heading"><div><span className="kicker">Candidate architecture</span><h2>Six governed intelligence layers</h2></div><span>DESIGN VIEW · READ ONLY</span></div>
        <div className="architecture-grid">
          {architectureLayers.map(({ icon: Icon, name, note }) => (
            <article key={name}><span><Icon size={19} /></span><div><h3>{name}</h3><p>{note}</p></div></article>
          ))}
        </div>
      </section>

      <article className="foundation-flow">
        <div><Sparkles size={18} />Base44 review experience</div><ArrowRight size={17} /><div><DatabaseZap size={18} />Accepted typed APIs only</div><ArrowRight size={17} /><div><ShieldCheck size={18} />AIRenOS Foundation authority</div>
      </article>
    </section>
  );
}

export default function App() {
  const [activeView, setActiveView] = useState("overview");

  const renderView = () => {
    if (activeView === "customers") return <TwinReview kind="customer" />;
    if (activeView === "suppliers") return <TwinReview kind="supplier" />;
    if (activeView === "authorization") return <AuthorizationReview />;
    if (activeView === "governance") return <GovernanceReview />;
    return <Overview onNavigate={setActiveView} />;
  };

  return (
    <main className="app-shell">
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />
      <aside className="rail">
        <div className="brand-lockup"><img src={airenIconUrl} alt="AIRenOS" /><div><strong>AIRenOS</strong><span>Design Review</span></div></div>
        <nav aria-label="Design review sections">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button key={id} className={`nav-item ${activeView === id ? "active" : ""}`} onClick={() => setActiveView(id)}><Icon size={18} /><span>{label}</span></button>
          ))}
        </nav>
        <div className="rail-state"><BadgeCheck size={16} /><div><strong>Governed design active</strong><span>Implementation disabled</span></div></div>
        <div className="rail-boundary"><ShieldCheck size={18} /><div><strong>Foundation protected</strong><span>Provider-neutral authority</span></div></div>
      </aside>
      <section className="workspace">
        <div className="workspace-bar"><span>{governanceState.artifactClass}</span><span>{governanceState.fixtureClass}</span></div>
        {renderView()}
        <footer><span>AIRenOS Relationship Intelligence · design review milestone</span><span>No persistence · no operational actions · no production data</span></footer>
      </section>
    </main>
  );
}
