"use client";

import { motion } from "framer-motion";

const fadeInUp = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0 },
};

const staggerContainer = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.12,
    },
  },
};

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 flex items-center justify-center px-4 py-10">
      <div className="max-w-6xl w-full">
        {/* TOP BAR */}
        <motion.div
          className="flex items-center justify-between gap-4 mb-10"
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-700/70 bg-slate-900/80 px-4 py-1.5 text-xs tracking-wide uppercase">
            <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.9)]" />
            <span className="font-semibold text-slate-100">AIRen • Core System</span>
          </div>

          <div className="text-[0.7rem] md:text-xs text-slate-400 text-right leading-tight">
            <div>Founder Console attiva</div>
            <div className="text-slate-300">Stiamo preparando l&apos;interfaccia del tuo ecosistema.</div>
          </div>
        </motion.div>

        {/* HERO + STATUS */}
        <motion.div
          className="grid gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)] items-start"
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
        >
          {/* HERO */}
          <motion.section variants={fadeInUp}>
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight text-slate-50 mb-4">
              AIRen –{" "}
              <span className="text-emerald-400">
                Sistema in Caricamento
              </span>
            </h1>

            <p className="text-sm sm:text-base text-slate-300 max-w-xl mb-6">
              Architettura collegata con successo. Repository GitHub sincronizzato.
              Vercel attivo. Ora stiamo portando in superficie il{" "}
              <span className="font-semibold text-slate-100">
                livello visibile del tuo ecosistema
              </span>
              : l&apos;interfaccia che userai ogni giorno.
            </p>

            <div className="relative overflow-hidden rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900/80 via-slate-900/40 to-slate-900/90 p-6 sm:p-7">
              <div className="absolute inset-px rounded-2xl bg-[radial-gradient(circle_at_top,_rgba(45,212,191,0.18),_transparent_55%),radial-gradient(circle_at_bottom,_rgba(59,130,246,0.12),_transparent_55%)] pointer-events-none" />

              <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-[.18em] text-slate-400 mb-2">
                    Stato Sistema
                  </h2>
                  <p className="text-sm text-slate-200 max-w-md">
                    Layer infrastrutturale pronto. Il prossimo passo: definire
                    pagina iniziale, sezioni del cruscotto e percorsi
                    operativi per AIRen OS, RistoAiren &amp; Galassia.
                  </p>
                </div>

                <div className="flex flex-col gap-3 text-xs text-slate-200 min-w-[210px]">
                  <StatusRow label="Architettura" value="Collegata" tone="ok" />
                  <StatusRow label="GitHub · airen" value="Sync attivo" tone="ok" />
                  <StatusRow label="Vercel · produzione" value="Online" tone="ok" />
                  <StatusRow label="UI / Dashboard" value="In costruzione guidata" tone="pending" />
                </div>
              </div>
            </div>

            <motion.div
              className="mt-6 flex flex-col sm:flex-row sm:items-center gap-3 text-xs sm:text-sm text-slate-300"
              variants={fadeInUp}
            >
              <span className="inline-flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                Prossimi step: struttura sezioni, navigazione, pannello Founder.
              </span>
              <span className="hidden sm:inline-block h-px flex-1 bg-slate-800" />
              <span className="text-slate-400">
                Tutte le modifiche partiranno da questa pagina:{" "}
                <code className="rounded-md bg-slate-900/70 px-1.5 py-0.5 text-[0.7rem] border border-slate-800">
                  app/page.tsx
                </code>
              </span>
            </motion.div>
          </motion.section>

          {/* PANNELLO LATERALE */}
          <motion.aside
            className="space-y-5"
            variants={fadeInUp}
          >
            <Panel title="Timeline Sistema">
              <TimelineStep
                label="1 · Collegamento repository"
                detail="GitHub &amp; Vercel agganciati al progetto AIRen."
                done
              />
              <TimelineStep
                label="2 · Sincronizzazione iniziale"
                detail="Branch main allineato, prime modifiche tracciate."
                done
              />
              <TimelineStep
                label="3 · Interfaccia fondativa"
                detail="Definizione layout home + struttura dashboard."
                active
              />
              <TimelineStep
                label="4 · Moduli verticali"
                detail="RistoAiren, Syngraphus, APPWORK, EasyPoint..."
              />
            </Panel>

            <Panel title="Founder Notes">
              <ul className="space-y-2 text-xs text-slate-300">
                <li>• Mantenere il design essenziale, leggibile, senza rumore.</li>
                <li>• Pensare già in ottica 2050: moduli estendibili e scalabili.</li>
                <li>• Ogni sezione della UI deve parlare la lingua del Founder.</li>
              </ul>
            </Panel>
          </motion.aside>
        </motion.div>
      </div>
    </main>
  );
}

type StatusTone = "ok" | "pending";

function StatusRow({
  label,
  value,
  tone = "ok",
}: {
  label: string;
  value: string;
  tone?: StatusTone;
}) {
  const color =
    tone === "ok"
      ? "bg-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.9)]"
      : "bg-amber-300 shadow-[0_0_10px_rgba(252,211,77,0.9)]";

  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-slate-400">{label}</span>
      <span className="inline-flex items-center gap-2">
        <span className={`h-1.5 w-1.5 rounded-full ${color}`} />
        <span className="font-medium">{value}</span>
      </span>
    </div>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-[0_18px_45px_rgba(15,23,42,0.75)]">
      <h3 className="text-xs font-semibold tracking-[.18em] uppercase text-slate-400 mb-3">
        {title}
      </h3>
      <div className="space-y-3 text-[0.8rem] text-slate-200">{children}</div>
    </div>
  );
}

function TimelineStep({
  label,
  detail,
  done,
  active,
}: {
  label: string;
  detail: string;
  done?: boolean;
  active?: boolean;
}) {
  let dot = "bg-slate-600";
  if (done) dot = "bg-emerald-400";
  if (active) dot = "bg-sky-400";

  return (
    <div className="flex items-start gap-3">
      <div className="mt-1">
        <span
          className={`h-2 w-2 rounded-full ${dot} block shadow-[0_0_10px_rgba(148,163,184,0.4)]`}
        />
      </div>
      <div className="space-y-0.5">
        <div className="text-[0.78rem] font-semibold text-slate-100">
          {label}
        </div>
        <div className="text-[0.75rem] text-slate-400">{detail}</div>
      </div>
    </div>
  );
}
