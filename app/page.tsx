import { getArchitectureSnapshot, getOperationalScore } from "@/lib/architecture";

type StatusTone = "operational" | "degraded" | "maintenance";

type StatusBadgeProps = {
  tone: StatusTone;
  label: string;
};

const toneStyles: Record<StatusTone, string> = {
  operational: "bg-emerald-500/10 text-emerald-200 ring-1 ring-emerald-400/30",
  degraded: "bg-amber-500/10 text-amber-200 ring-1 ring-amber-400/30",
  maintenance: "bg-sky-500/10 text-sky-200 ring-1 ring-sky-400/30",
};

function StatusBadge({ tone, label }: StatusBadgeProps) {
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${toneStyles[tone]}`}>
      {label}
    </span>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6 shadow-[0_10px_40px_rgba(0,0,0,0.35)] backdrop-blur">
      {children}
    </div>
  );
}

export default function Home() {
  const snapshot = getArchitectureSnapshot();
  const operationalScore = getOperationalScore();

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-6 py-10 lg:px-10 lg:py-16">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-2">
          <p className="text-sm uppercase tracking-[0.35em] text-slate-400">Restoration Dashboard</p>
          <h1 className="text-4xl font-semibold text-slate-50 sm:text-5xl">AIRen Unified Master</h1>
          <p className="text-base text-slate-300">
            Unified view of the recovered architecture: backend, frontend, ARYA intelligence, Timeline2050, configuration, and
            test coverage.
          </p>
        </div>
        <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-right shadow-lg">
          <div className="text-sm text-slate-300">Operational Score</div>
          <div className="text-3xl font-semibold text-sky-200">{operationalScore}</div>
        </div>
      </header>

      <section className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {snapshot.serviceAreas.map((area) => (
          <Panel key={area.id}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm text-slate-400">{area.owner}</p>
                <h2 className="text-2xl font-semibold text-slate-50">{area.name}</h2>
                <p className="mt-2 text-sm text-slate-300">{area.summary}</p>
              </div>
              <StatusBadge tone={area.status} label={area.status.toUpperCase()} />
            </div>
            <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-300">
              {area.checkpoints.map((item) => (
                <span key={item} className="rounded-full bg-white/5 px-3 py-1 ring-1 ring-white/10">
                  {item}
                </span>
              ))}
            </div>
            <p className="mt-4 text-xs text-slate-400">Updated {new Date(area.updatedAt).toLocaleString()}</p>
          </Panel>
        ))}
      </section>

      <section className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-400">ARYA Intelligence</p>
              <h2 className="text-2xl font-semibold text-slate-50">Streams</h2>
            </div>
            <StatusBadge tone="degraded" label="RECOVERING" />
          </div>
          <div className="mt-5 space-y-4">
            {snapshot.aryaStreams.map((stream) => (
              <div key={stream.id} className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-slate-50">{stream.capability}</h3>
                  <span className="text-xs uppercase tracking-wide text-slate-300">{stream.maturity}</span>
                </div>
                <ul className="mt-3 space-y-2 text-sm text-slate-300">
                  {stream.highlights.map((item) => (
                    <li key={item} className="flex items-start gap-2">
                      <span className="mt-1 h-2 w-2 rounded-full bg-sky-300" aria-hidden />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Panel>

        <Panel>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-400">Timeline2050</p>
              <h2 className="text-2xl font-semibold text-slate-50">Scenario Milestones</h2>
            </div>
            <StatusBadge tone="operational" label="PUBLISHED" />
          </div>
          <div className="mt-5 space-y-4">
            {snapshot.timeline2050.map((event) => (
              <div key={event.id} className="flex gap-3 rounded-xl border border-white/10 bg-slate-900/40 p-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/5 text-lg font-semibold text-sky-200">
                  {event.targetYear}
                </div>
                <div className="space-y-1">
                  <h3 className="text-lg font-semibold text-slate-50">{event.title}</h3>
                  <p className="text-sm text-slate-300">{event.focus}</p>
                  <p className="text-xs text-slate-400">Owner: {event.owner}</p>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </section>

      <section className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-400">Configuration</p>
              <h2 className="text-2xl font-semibold text-slate-50">Unified Controls</h2>
            </div>
            <StatusBadge tone="operational" label={snapshot.configuration.environment} />
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Region</p>
              <p className="text-lg font-semibold text-slate-50">{snapshot.configuration.region}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Observability</p>
              <ul className="mt-2 space-y-1 text-sm text-slate-300">
                <li>Metrics: {snapshot.configuration.observability.metrics}</li>
                <li>Tracing: {snapshot.configuration.observability.tracing}</li>
                <li>Logging: {snapshot.configuration.observability.logging}</li>
              </ul>
            </div>
          </div>
          <div className="mt-4 space-y-2">
            {snapshot.configuration.featureFlags.map((flag) => (
              <div
                key={flag.key}
                className="flex items-start justify-between rounded-xl border border-white/10 bg-slate-900/40 p-4"
              >
                <div>
                  <p className="text-sm font-semibold text-slate-50">{flag.key}</p>
                  <p className="text-xs text-slate-300">{flag.description}</p>
                </div>
                <StatusBadge tone={flag.enabled ? "operational" : "maintenance"} label={flag.enabled ? "ON" : "OFF"} />
              </div>
            ))}
          </div>
        </Panel>

        <Panel>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-400">Quality & Tests</p>
              <h2 className="text-2xl font-semibold text-slate-50">Regression Suites</h2>
            </div>
            <StatusBadge tone="operational" label="TRACKING" />
          </div>
          <div className="mt-4 space-y-3">
            {snapshot.regressionSuites.map((suite) => (
              <div key={suite.id} className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-50">{suite.name}</h3>
                    <p className="text-xs text-slate-400">Owner: {suite.owner}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-semibold text-sky-200">{Math.round(suite.coverage * 100)}%</p>
                    <p className="text-xs text-slate-400">Cadence: {suite.cadence}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </section>
    </main>
  );
}
