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
    <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-6 py-10">
      <motion.div
        className="w-full max-w-6xl mx-auto"
        initial="hidden"
        animate="visible"
        variants={staggerContainer}
      >
        {/* Top bar: badge + founder status */}
        <motion.div
          className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-10"
          variants={fadeInUp}
        >
          <div className="inline-flex items-center gap-2 rounded-full bg-slate-900/80 border border-emerald-400/40 px-4 py-1.5 text-sm">
            <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.9)]" />
            <span className="font-medium tracking-wide">
              AIRen · Sistema Centrale
            </span>
          </div>
          <div className="text-xs md:text-sm text-slate-400 md:text-right leading-snug">
            <div className="font-semibold text-slate-200">
              Founder Console attiva
            </div>
            <div>Stiamo preparando l’interfaccia del tuo ecosistema.</div>
          </div>
        </motion.div>

        {/* Hero */}
        <motion.section className="mb-10" variants={fadeInUp}>
          <h1 className="text-3xl md:text-4xl lg:text-5xl font-semibold tracking-tight mb-4">
            AIRen{" "}
            <span className="bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-400 bg-clip-text text-transparent">
              – Sistema in caricamento
            </span>
          </h1>
          <p className="max-w-2xl text-sm md:text-base text-slate-300 leading-relaxed">
            Architettura collegata con successo. Repository GitHub
            sincronizzato. Vercel attivo. Ora stiamo portando in superficie il{" "}
            <span className="font-semibold text-emerald-300">
              livello visibile del tuo ecosistema
            </span>
            : l’interfaccia che userai ogni giorno.
          </p>
        </motion.section>

        {/* Main grid */}
        <motion.div
          className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] items-start"
          variants={staggerContainer}
        >
          {/* LEFT: Stato Sistema */}
          <motion.section
            className="rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-900/80 via-slate-950 to-slate-900/80 p-6 md:p-8 shadow-[0_0_60px_rgba(15,23,42,0.9)]"
            variants={fadeInUp}
          >
            <h2 className="text-sm font-semibold tracking-[0.2em] text-slate-400 mb-4">
              STATO SISTEMA
            </h2>

            <p className="text-sm md:text-base text-slate-200 mb-6 max-w-xl leading-relaxed">
              Strato infrastrutturale pronto. Il prossimo passo: definire
              pagina iniziale, sezioni del cruscotto e percorsi operativi per{" "}
              <span className="font-semibold text-emerald-300">
                AIRen OS, RistoAiren &amp; Galassia
              </span>
              .
            </p>

            {/* Status grid */}
            <div className="grid gap-4 md:grid-cols-2 mb-6">
              <div className="space-y-2 text-sm">
                <StatusRow label="Architettura" value="Collegata" />
                <StatusRow label="GitHub · airen" value="Sincronizzazione attiva" />
                <StatusRow label="Vercel · produzione" value="In linea" />
                <StatusRow label="Interfaccia utente / Dashboard" value="In costruzione guidata" />
              </div>

              <div className="rounded-2xl border border-slate-800/80 bg-slate-900/70 p-4 text-xs md:text-sm text-slate-300 space-y-2">
                <div className="font-semibold text-slate-100">
                  Prossimi step operativi
                </div>
                <ul className="list-disc list-inside space-y-1">
                  <li>Definizione layout home del Sistema Centrale.</li>
                  <li>Mappatura sezioni cruscotto Founder.</li>
                  <li>Accessi rapidi ai moduli verticali (RistoAiren, Syngraphus, APPWORK, EasyPoint...).</li>
                </ul>
              </div>
            </div>

            {/* File reference + note */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pt-4 border-t border-slate-800/70 text-xs md:text-sm">
              <div className="flex items-center gap-2 text-slate-400">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 border border-slate-700 text-[10px] font-mono">
                  app
                </span>
                <span>
                  Tutte le modifiche partono da questa pagina:{" "}
                  <code className="rounded bg-slate-900/80 px-1.5 py-0.5 text-[11px] text-emerald-300 border border-slate-700">
                    app/page.tsx
                  </code>
                </span>
              </div>
              <div className="text-slate-500">
                Strato <span className="text-slate-200">fondativo</span> pronto.
              </div>
            </div>
          </motion.section>

          {/* RIGHT: Timeline + Note Founder */}
          <motion.div
            className="space-y-4"
            variants={staggerContainer}
          >
            {/* Timeline sistema */}
            <motion.section
              className="rounded-3xl border border-slate-800 bg-slate-950/80 p-5 md:p-6"
              variants={fadeInUp}
            >
              <h3 className="text-xs font-semibold tracking-[0.22em] text-slate-400 mb-4">
                TIMELINE SISTEMA
              </h3>

              <div className="space-y-3 text-sm">
                <TimelineItem
                  active
                  step="1"
                  title="Collegamento repository"
                  desc="GitHub e Vercel si sono agganciati al progetto AIRen."
                />
                <TimelineItem
                  active
                  step="2"
                  title="Sincronizzazione iniziale"
                  desc="Ramo principale allineato, prime modifiche tracciate."
                />
                <TimelineItem
                  active
                  step="3"
                  title="Interfaccia fondativa"
                  desc="Definizione layout home + struttura dashboard."
                />
                <TimelineItem
                  step="4"
                  title="Moduli verticali"
                  desc="RistoAiren, Syngraphus, APPWORK, EasyPoint…"
                />
                <TimelineItem
                  step="5"
                  title="Navigazione Galassia"
                  desc="Accesso unificato ai progetti della Galaxy AIRen."
                />
                <TimelineItem
                  step="6"
                  title="Pannello Founder"
                  desc="Vista dedicata al controllo strategico e operativo."
                />
                <TimelineItem
                  step="7"
                  title="AI Layer & Kairos"
                  desc="Integrazione ARYA, motori predittivi e Kairos Engine."
                />
              </div>
            </motion.section>

            {/* Note del Foundatore */}
            <motion.section
              className="rounded-3xl border border-slate-800 bg-slate-950/90 p-5 md:p-6"
              variants={fadeInUp}
            >
              <h3 className="text-xs font-semibold tracking-[0.22em] text-slate-400 mb-4">
                NOTE DEL FONDATORE
              </h3>
              <ul className="space-y-2 text-xs md:text-sm text-slate-300">
                <li>
                  • Mantenere il design{" "}
                  <span className="font-semibold text-slate-100">
                    essenziale, leggibile, senza rumore
                  </span>
                  .
                </li>
                <li>
                  • Pensare già in ottica{" "}
                  <span className="font-semibold text-emerald-300">
                    2050
                  </span>
                  : moduli estensibili e scalabili, mai rigidi.
                </li>
                <li>
                  • Ogni sezione della UI deve parlare la{" "}
                  <span className="font-semibold text-slate-100">
                    lingua del Founder
                  </span>
                  , non del tecnico.
                </li>
                <li>
                  • La home del Sistema Centrale è il{" "}
                  <span className="font-semibold text-slate-100">
                    quadro strumenti
                  </span>{" "}
                  da cui parte tutta la Galassia AIRen.
                </li>
              </ul>
            </motion.section>
          </motion.div>
        </motion.div>

        {/* Footer tecnico */}
        <motion.footer
          className="mt-10 flex flex-col md:flex-row md:items-center md:justify-between gap-2 text-[11px] text-slate-500"
          variants={fadeInUp}
        >
          <div>
            AIRen OS · Interfaccia fondativa v0.2 · Processo guidato dal Founder
          </div>
          <div className="text-slate-600">
            © AIRen Galaxy Initiative — Tutti i percorsi convergono nel Sistema
            Centrale.
          </div>
        </motion.footer>
      </motion.div>
    </main>
  );
}

type StatusRowProps = {
  label: string;
  value: string;
};

function StatusRow({ label, value }: StatusRowProps) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-slate-400">{label}</span>
      <span className="inline-flex items-center gap-2 text-emerald-300 text-xs">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        <span className="font-medium">{value}</span>
      </span>
    </div>
  );
}

type TimelineItemProps = {
  step: string;
  title: string;
  desc: string;
  active?: boolean;
};

function TimelineItem({ step, title, desc, active }: TimelineItemProps) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div
          className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs font-semibold ${
            active
              ? "border-emerald-400 text-emerald-300 bg-slate-900"
              : "border-slate-700 text-slate-400 bg-slate-900/60"
          }`}
        >
          {step}
        </div>
        <div className="h-full w-px bg-slate-800/70 mt-1" />
      </div>
      <div className="pt-0.5">
        <div className="text-[13px] font-medium text-slate-100">{title}</div>
        <div className="text-xs text-slate-400">{desc}</div>
      </div>
    </div>
  );
}
