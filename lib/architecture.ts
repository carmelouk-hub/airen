export type ServiceArea = {
  id: string;
  name: string;
  status: "operational" | "degraded" | "maintenance";
  owner: string;
  summary: string;
  checkpoints: string[];
  updatedAt: string;
};

export type AryaStream = {
  id: string;
  capability: string;
  maturity: "alpha" | "beta" | "stable";
  highlights: string[];
};

export type TimelineEvent = {
  id: string;
  title: string;
  targetYear: number;
  focus: string;
  owner: string;
  confidence: "high" | "medium" | "low";
};

export type RegressionSuite = {
  id: string;
  name: string;
  coverage: number;
  cadence: string;
  owner: string;
};

export type ConfigurationProfile = {
  environment: string;
  region: string;
  featureFlags: { key: string; enabled: boolean; description: string }[];
  observability: {
    metrics: string;
    tracing: string;
    logging: string;
  };
};

export type ArchitectureSnapshot = {
  serviceAreas: ServiceArea[];
  aryaStreams: AryaStream[];
  timeline2050: TimelineEvent[];
  regressionSuites: RegressionSuite[];
  configuration: ConfigurationProfile;
};

const serviceAreas: ServiceArea[] = [
  {
    id: "backend",
    name: "Backend Fabric",
    status: "operational",
    owner: "Core Platform",
    summary:
      "Node runtimes stabilized with load-aware APIs, automated failovers, and structured observability hooks.",
    checkpoints: [
      "Async message bus restored",
      "Resilience policies re-applied",
      "DB migrations replayed",
    ],
    updatedAt: "2025-03-01T09:00:00Z",
  },
  {
    id: "frontend",
    name: "Frontend Experience",
    status: "operational",
    owner: "Design Systems",
    summary:
      "Unified Next.js shell with adaptive theming, progressive disclosure, and cross-surface navigation parity.",
    checkpoints: [
      "Layout primitives reinstated",
      "ARIA-first components validated",
      "Design tokens synchronized",
    ],
    updatedAt: "2025-03-02T12:30:00Z",
  },
  {
    id: "arya",
    name: "ARYA Intelligence",
    status: "degraded",
    owner: "AI Systems",
    summary:
      "Inference orchestrator restored with safe-guardrails; adaptive memory caches rehydrated and tuned for latency spikes.",
    checkpoints: [
      "Model registry reconciled",
      "Guardrail policies reapplied",
      "Latency regressions tracked",
    ],
    updatedAt: "2025-03-03T10:15:00Z",
  },
  {
    id: "timeline2050",
    name: "Timeline 2050",
    status: "operational",
    owner: "Futures Lab",
    summary:
      "Scenario planning canvas restored with synchronized signals, governance checkpoints, and publication workflow.",
    checkpoints: [
      "Signal ingestion unblocked",
      "Scenario templates reloaded",
      "Publishing circuit hardened",
    ],
    updatedAt: "2025-03-04T08:45:00Z",
  },
];

const aryaStreams: AryaStream[] = [
  {
    id: "context",
    capability: "Context Graph",
    maturity: "stable",
    highlights: [
      "Cross-domain embeddings refreshed",
      "Conversation state replay validated",
      "Memory scrubbing rules verified",
    ],
  },
  {
    id: "agentic",
    capability: "Agentic Execution",
    maturity: "beta",
    highlights: [
      "Task routing restored with confidence bands",
      "Human-in-the-loop confirmations online",
      "Recovery flows rehearsed",
    ],
  },
  {
    id: "learning",
    capability: "Continuous Learning",
    maturity: "alpha",
    highlights: [
      "Shadow deployments monitoring",
      "Feedback loops reconnected",
      "Bias/variance dashboards tuned",
    ],
  },
];

const timeline2050: TimelineEvent[] = [
  {
    id: "t2050-1",
    title: "Autonomous governance checks",
    targetYear: 2027,
    focus: "Regenerative control and auditability",
    owner: "Risk Office",
    confidence: "high",
  },
  {
    id: "t2050-2",
    title: "Planetary-scale simulation fabric",
    targetYear: 2032,
    focus: "Large-scale what-if scenarios with live telemetry",
    owner: "Futures Lab",
    confidence: "medium",
  },
  {
    id: "t2050-3",
    title: "Interoperable civic AIs",
    targetYear: 2038,
    focus: "Standards for public-interest agent coordination",
    owner: "Civic Alliance",
    confidence: "medium",
  },
  {
    id: "t2050-4",
    title: "Self-healing supply intelligence",
    targetYear: 2045,
    focus: "Predictive remediation across global supply meshes",
    owner: "Ops Command",
    confidence: "low",
  },
];

const regressionSuites: RegressionSuite[] = [
  {
    id: "rs-1",
    name: "API stability",
    coverage: 0.82,
    cadence: "nightly",
    owner: "Core Platform",
  },
  {
    id: "rs-2",
    name: "UX accessibility",
    coverage: 0.76,
    cadence: "daily",
    owner: "Design Systems",
  },
  {
    id: "rs-3",
    name: "Safety & guardrails",
    coverage: 0.71,
    cadence: "continuous",
    owner: "AI Systems",
  },
];

const configuration: ConfigurationProfile = {
  environment: "unified-master",
  region: "multi-region active/active",
  featureFlags: [
    {
      key: "arya.agenticMode",
      enabled: true,
      description: "Enables recovery-aware agentic routing across shards.",
    },
    {
      key: "timeline2050.publisher",
      enabled: true,
      description: "Restores publishing circuit with lineage tracking.",
    },
    {
      key: "frontend.skeletonLoading",
      enabled: true,
      description: "Shows consistent loading shells during cold starts.",
    },
  ],
  observability: {
    metrics: "Prometheus + OpenTelemetry collector",
    tracing: "W3C TraceContext with baggage propagation",
    logging: "Structured JSON to centralized lake",
  },
};

export function getArchitectureSnapshot(): ArchitectureSnapshot {
  return {
    serviceAreas,
    aryaStreams,
    timeline2050: [...timeline2050].sort((a, b) => a.targetYear - b.targetYear),
    regressionSuites,
    configuration,
  };
}

export function getOperationalScore(): number {
  const base = serviceAreas.reduce((score, area) => {
    const weight = area.status === "operational" ? 1 : area.status === "degraded" ? 0.5 : 0.25;
    return score + weight;
  }, 0);

  const flags = configuration.featureFlags.filter((flag) => flag.enabled).length;
  const normalized = base / serviceAreas.length;
  return Number((normalized + flags * 0.05).toFixed(2));
}

export function getRestorationSummary() {
  return {
    backend: serviceAreas.find((area) => area.id === "backend"),
    frontend: serviceAreas.find((area) => area.id === "frontend"),
    arya: serviceAreas.find((area) => area.id === "arya"),
    timeline2050: serviceAreas.find((area) => area.id === "timeline2050"),
    configuration,
    regressionSuites,
  };
}
