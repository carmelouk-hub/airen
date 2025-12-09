export const serviceAreas = [
  {
    name: "Cognitive Core",
    mission: "Orchestrates AIRen's reasoning graph, safety gates, and execution intelligence.",
    owner: "Systems Engineering",
    capabilities: [
      "Adaptive reasoning graph",
      "Safety and alignment gate",
      "Autonomous plan synthesis",
    ],
  },
  {
    name: "Operational Fabric",
    mission: "Maintains runtime fidelity through observability, release discipline, and disaster readiness.",
    owner: "Site Reliability Engineering",
    capabilities: [
      "Telemetry mesh and health beacons",
      "Progressive delivery lanes",
      "Resilience, rollback, and failover automation",
    ],
  },
  {
    name: "Experience Loop",
    mission: "Connects AIRen output to human operators with transparent, reviewable decision trails.",
    owner: "DesignOps",
    capabilities: [
      "Narrative surfaces and operator HUD",
      "Feedback routing and annotation",
      "Traceable decision journal",
    ],
  },
  {
    name: "Intelligence Augments",
    mission: "Links specialized models, retrieval stacks, and evaluators into a unified capability surface.",
    owner: "ML Platform",
    capabilities: [
      "Model registry and capability contracts",
      "Retrieval adapters and knowledge curation",
      "Evaluation harness with guardrails",
    ],
  },
];

export const aryaStreams = [
  {
    id: "A1",
    focus: "Mission-critical automation for continuous delivery and post-deployment guardianship.",
    cadence: "Weekly drops with daily telemetry checkpoints.",
    status: "operational",
    signals: ["canary-pass-rate", "change-failure-rate", "rollback-latency"],
  },
  {
    id: "R2",
    focus: "Retrieval reliability and knowledge freshness across all operational theaters.",
    cadence: "Twice-weekly knowledge rotations with monthly deep scrubs.",
    status: "operational",
    signals: ["freshness-index", "embedding-health", "source-trust"],
  },
  {
    id: "Y3",
    focus: "Human-in-the-loop experience upgrades with audit-grade transparency.",
    cadence: "Biweekly packages with continuous usability taps.",
    status: "advancing",
    signals: ["holo-latency", "explainability-score", "operator-satisfaction"],
  },
  {
    id: "A5",
    focus: "Alignment stress testing and evaluator evolution for emergent behaviors.",
    cadence: "Weekly red-team gauntlets and regression sweeps.",
    status: "advancing",
    signals: ["guardrail-efficacy", "jailbreak-detection", "evaluation-depth"],
  },
];

export const timeline2050 = [
  {
    year: 2025,
    title: "Foundational Runtime",
    summary: "AIRen OS stitched together the cognitive core with basic telemetry beacons and release lanes.",
    impact: "Unified runtime with first-class observability for early operators.",
  },
  {
    year: 2027,
    title: "Human-Centered Loop",
    summary: "Decision journal, annotations, and narrative surfaces shipped to production teams.",
    impact: "Operators gained reviewable trails and could compose missions safely.",
  },
  {
    year: 2032,
    title: "Multi-Model Augments",
    summary: "Registry and evaluation harness opened for specialized models with strict capability contracts.",
    impact: "New models joined the platform without sacrificing reliability or governance.",
  },
  {
    year: 2040,
    title: "Autonomous Delivery Spine",
    summary: "Progressive delivery lanes and resilience automation handled global rollouts with minimal human intervention.",
    impact: "Change failure rate dropped below 1% while cadence increased across all theaters.",
  },
  {
    year: 2050,
    title: "Persistent Sentience Guardrails",
    summary: "Alignment, retrieval fidelity, and human trust signals converged into a living safety lattice.",
    impact: "AIRen sustained autonomous operations with continuous human trust calibration.",
  },
];

export const regressionSuites = [
  {
    name: "Atlas Core",
    scope: "Cognitive kernel, planning, and guardrails",
    cadence: "Nightly",
    owner: "Systems QA",
    criticalSignals: ["reasoning-coherence", "alignment-gate", "latency-budget"],
  },
  {
    name: "Fabric Reliability",
    scope: "Telemetry mesh, delivery lanes, and failover behaviors",
    cadence: "Twice daily",
    owner: "SRE QA",
    criticalSignals: ["canary-pass-rate", "uptime", "rollback-success"],
  },
  {
    name: "Operator Experience",
    scope: "HUD surfaces, audit trails, and feedback routing",
    cadence: "Daily",
    owner: "DesignOps QA",
    criticalSignals: ["trace-completeness", "ux-friction", "annotation-integrity"],
  },
  {
    name: "Augment Integrity",
    scope: "Model adapters, retrieval curation, and evaluator health",
    cadence: "Daily",
    owner: "ML Platform QA",
    criticalSignals: ["freshness-index", "evaluation-depth", "capability-contract"],
  },
];

export const configurationProfile = {
  environment: "mission",
  releaseTrain: "Nova-∆",
  governance: {
    alignmentPanel: "Aegis Council",
    auditWindowDays: 30,
    traceability: "end-to-end",
  },
  telemetry: {
    uptime: 99.97,
    errorBudgetRemaining: 98.4,
    signalCount: 48,
  },
  safeguards: [
    "Layered guardrails with human override",
    "Immutable decision journal for every mission",
    "Progressive delivery with automatic rollback",
    "Model capability contracts with evaluator drift watch",
  ],
};

export function getArchitectureSnapshot() {
  return {
    serviceAreas,
    aryaStreams,
    timeline2050,
    regressionSuites,
    configurationProfile,
  };
}

export function getOperationalScore() {
  const totalSignals = aryaStreams.reduce((total, stream) => total + stream.signals.length, 0);
  const cadenceScore = aryaStreams.length * 3 + regressionSuites.length * 2;
  const coverageScore = regressionSuites.reduce(
    (score, suite) => score + suite.criticalSignals.length,
    0,
  );
  const reliabilityScore = configurationProfile.telemetry.uptime;

  const composite = Math.min(
    100,
    Math.round(reliabilityScore * 0.35 + cadenceScore * 1.4 + coverageScore * 1.2),
  );

  return {
    composite,
    reliability: {
      uptime: configurationProfile.telemetry.uptime,
      errorBudgetRemaining: configurationProfile.telemetry.errorBudgetRemaining,
    },
    delivery: {
      cadenceScore,
      changeFailureRate: 0.8,
    },
    coverage: {
      regressionSuites: regressionSuites.length,
      trackedSignals: totalSignals + configurationProfile.telemetry.signalCount,
    },
  };
}
