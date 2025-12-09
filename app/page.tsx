import type { ReactNode } from "react";
import Link from "next/link";
import {
  aryaStreams,
  configurationProfile,
  getOperationalScore,
  regressionSuites,
  serviceAreas,
  timeline2050,
} from "@/lib/architecture";

const score = getOperationalScore();

export default function Home() {
  return (
    <main className="relative min-h-screen overflow-hidden px-6 py-12 md:px-10">
      <div className="absolute inset-0 z-0 bg-gradient-to-b from-white/5 via-transparent to-black" />
      <div className="relative z-10 mx-auto flex max-w-6xl flex-col gap-10">
        <header className="flex flex-col gap-6 rounded-3xl border border-[var(--border)] bg-[var(--panel)]/80 p-8 backdrop-blur md:flex-row md:items-start md:justify-between">
          <div className="flex-1 space-y-3">
            <p className="text-sm uppercase tracking-[0.3em] text-[var(--muted)]">AIRen — Codex Restore v1.0</p>
            <h1 className="text-3xl font-semibold sm:text-4xl">Full System Architecture</h1>
            <p className="max-w-3xl text-lg text-[var(--muted)]">
              Authoritative runtime map for AIRen OS. APIs, UI, and validation suites pull directly from
              this architecture spine—no placeholders, no drift.
            </p>
            <div className="flex flex-wrap gap-3 text-sm text-[var(--muted)]">
              <span className="rounded-full border border-[var(--border)] px-3 py-1">
                Release Train: {configurationProfile.releaseTrain}
              </span>
              <span className="rounded-full border border-[var(--border)] px-3 py-1">
                Environment: {configurationProfile.environment}
              </span>
              <span className="rounded-full border border-[var(--border)] px-3 py-1">
                Governance: {configurationProfile.governance.alignmentPanel}
              </span>
            </div>
          </div>
          <div className="grid w-full max-w-sm grid-cols-2 gap-4 md:w-auto">
            <StatCard label="Composite" value={`${score.composite}%`} accent />
            <StatCard label="Uptime" value={`${score.reliability.uptime}%`} />
            <StatCard label="Signals" value={String(score.coverage.trackedSignals)} />
            <StatCard label="Suites" value={String(score.coverage.regressionSuites)} />
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-2">
          <Panel title="Service Areas" description="Operating surfaces that define AIRen's core responsibilities.">
            <div className="grid gap-4 sm:grid-cols-2">
              {serviceAreas.map((area) => (
                <div
                  key={area.name}
                  className="rounded-2xl border border-[var(--border)] bg-black/30 p-4"
                >
                  <div className="mb-1 text-sm uppercase tracking-[0.2em] text-[var(--muted)]">
                    {area.owner}
                  </div>
                  <h3 className="text-lg font-semibold">{area.name}</h3>
                  <p className="mb-3 text-sm text-[var(--muted)]">{area.mission}</p>
                  <ul className="space-y-2 text-sm text-[var(--muted)]">
                    {area.capabilities.map((capability) => (
                      <li key={capability} className="flex items-start gap-2">
                        <span className="mt-1 h-2 w-2 rounded-full bg-[var(--accent)]" />
                        <span>{capability}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="ARYA Streams" description="Delivery streams with their cadence and operational signals.">
            <div className="flex flex-col gap-3">
              {aryaStreams.map((stream) => (
                <div
                  key={stream.id}
                  className="flex flex-col gap-2 rounded-2xl border border-[var(--border)] bg-black/30 p-4"
                >
                  <div className="flex items-center justify-between text-sm text-[var(--muted)]">
                    <span className="uppercase tracking-[0.2em]">{stream.id}</span>
                    <span className="rounded-full border border-[var(--border)] px-3 py-1 text-xs uppercase tracking-wide">
                      {stream.status}
                    </span>
                  </div>
                  <h3 className="text-lg font-semibold">{stream.focus}</h3>
                  <p className="text-sm text-[var(--muted)]">{stream.cadence}</p>
                  <div className="flex flex-wrap gap-2 text-xs text-[var(--muted)]">
                    {stream.signals.map((signal) => (
                      <span key={signal} className="rounded-full border border-[var(--border)] px-2 py-1">
                        {signal}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <Panel
            title="2050 Timeline"
            description="Milestones that progressively assembled the AIRen OS spine."
          >
            <div className="space-y-4">
              {timeline2050.map((event) => (
                <div key={event.year} className="rounded-2xl border border-[var(--border)] bg-black/30 p-4">
                  <div className="flex items-center justify-between text-sm text-[var(--muted)]">
                    <span className="rounded-full border border-[var(--border)] px-2 py-1">{event.year}</span>
                    <span className="text-xs uppercase tracking-wide text-[var(--accent)]">{event.title}</span>
                  </div>
                  <p className="mt-3 text-sm text-[var(--muted)]">{event.summary}</p>
                  <p className="mt-2 text-sm font-medium text-foreground">Impact: {event.impact}</p>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Regression Suites" description="Validation harnesses that maintain fidelity.">
            <div className="space-y-3">
              {regressionSuites.map((suite) => (
                <div key={suite.name} className="rounded-2xl border border-[var(--border)] bg-black/30 p-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold">{suite.name}</h3>
                    <span className="text-xs uppercase tracking-wide text-[var(--muted)]">{suite.cadence}</span>
                  </div>
                  <p className="text-sm text-[var(--muted)]">{suite.scope}</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-[var(--muted)]">
                    {suite.criticalSignals.map((signal) => (
                      <span key={signal} className="rounded-full border border-[var(--border)] px-2 py-1">
                        {signal}
                      </span>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-[var(--muted)]">Owner: {suite.owner}</p>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Configuration Profile" description="Governance and safeguards loaded into the runtime.">
            <div className="space-y-4">
              <div className="rounded-2xl border border-[var(--border)] bg-black/30 p-4">
                <h3 className="text-base font-semibold">Governance</h3>
                <ul className="mt-2 space-y-1 text-sm text-[var(--muted)]">
                  <li>Panel: {configurationProfile.governance.alignmentPanel}</li>
                  <li>Audit Window: {configurationProfile.governance.auditWindowDays} days</li>
                  <li>Traceability: {configurationProfile.governance.traceability}</li>
                </ul>
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-black/30 p-4">
                <h3 className="text-base font-semibold">Safeguards</h3>
                <ul className="mt-2 space-y-2 text-sm text-[var(--muted)]">
                  {configurationProfile.safeguards.map((item) => (
                    <li key={item} className="flex items-start gap-2">
                      <span className="mt-1 h-2 w-2 rounded-full bg-[var(--accent)]" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-2xl border border-[var(--border)] bg-black/30 p-4">
                <h3 className="text-base font-semibold">Telemetry</h3>
                <p className="text-sm text-[var(--muted)]">
                  {configurationProfile.telemetry.uptime}% uptime · {configurationProfile.telemetry.errorBudgetRemaining}%
                  error budget · {configurationProfile.telemetry.signalCount} signals
                </p>
              </div>
            </div>
          </Panel>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <Panel title="API Surface" description="Programmatic entry points wired to the architecture spine.">
            <ul className="space-y-3 text-sm text-[var(--muted)]">
              {["/api/status", "/api/configuration", "/api/tests", "/api/timeline"].map((endpoint) => (
                <li key={endpoint} className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-black/30 px-4 py-3">
                  <span className="font-mono text-foreground">GET {endpoint}</span>
                  <Link className="text-[var(--accent)]" href={endpoint}>
                    explore
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Operational Lens" description="Live score computed from runtime cadence and coverage.">
            <div className="grid grid-cols-2 gap-4">
              <StatCard label="Cadence" value={score.delivery.cadenceScore.toFixed(1)} />
              <StatCard label="Change Failure" value={`${score.delivery.changeFailureRate}%`} />
              <StatCard label="Error Budget" value={`${score.reliability.errorBudgetRemaining}%`} />
              <StatCard label="Coverage Signals" value={`${score.coverage.trackedSignals}`} />
            </div>
            <p className="mt-4 text-sm text-[var(--muted)]">
              Computed directly from the ARYA streams and regression suites. Update the spine to propagate new
              operational posture through the UI, APIs, and tests.
            </p>
          </Panel>
        </section>
      </div>
    </main>
  );
}

function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-3xl border border-[var(--border)] bg-[var(--panel)]/80 p-6 backdrop-blur">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="text-sm text-[var(--muted)]">{description}</p>
      </div>
      {children}
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-black/30 p-4 shadow-inner">
      <div className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">{label}</div>
      <div className={`text-2xl font-semibold ${accent ? "text-[var(--accent)]" : ""}`}>{value}</div>
    </div>
  );
}
