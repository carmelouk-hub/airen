import {
  aryaStreams,
  configurationProfile,
  getArchitectureSnapshot,
  getOperationalScore,
  regressionSuites,
  serviceAreas,
  timeline2050,
} from "@/lib/architecture";

import { describe, expect, it } from "vitest";

describe("AIRen architecture", () => {
  it("exposes service areas with capabilities and owners", () => {
    expect(serviceAreas.length).toBeGreaterThanOrEqual(4);
    serviceAreas.forEach((area) => {
      expect(area.name).toBeTruthy();
      expect(area.owner).toBeTruthy();
      expect(area.capabilities.length).toBeGreaterThanOrEqual(3);
    });
  });

  it("keeps the snapshot references aligned across exports", () => {
    const snapshot = getArchitectureSnapshot();
    expect(snapshot.serviceAreas).toBe(serviceAreas);
    expect(snapshot.aryaStreams).toBe(aryaStreams);
    expect(snapshot.timeline2050).toBe(timeline2050);
    expect(snapshot.regressionSuites).toBe(regressionSuites);
    expect(snapshot.configurationProfile).toBe(configurationProfile);
  });

  it("orders the 2050 timeline chronologically", () => {
    const years = timeline2050.map((event) => event.year);
    const sorted = [...years].sort((a, b) => a - b);
    expect(years).toEqual(sorted);
    expect(years[0]).toBeGreaterThanOrEqual(2025);
    expect(years[years.length - 1]).toBe(2050);
  });

  it("derives a composite operational score within bounds", () => {
    const score = getOperationalScore();
    const totalSignals = aryaStreams.reduce((total, stream) => total + stream.signals.length, 0);

    expect(score.composite).toBeGreaterThan(0);
    expect(score.composite).toBeLessThanOrEqual(100);
    expect(score.coverage.regressionSuites).toBe(regressionSuites.length);
    expect(score.coverage.trackedSignals).toBe(
      totalSignals + configurationProfile.telemetry.signalCount,
    );
    expect(score.reliability.uptime).toBeCloseTo(configurationProfile.telemetry.uptime);
  });

  it("keeps governance and safeguards defined", () => {
    expect(configurationProfile.governance.alignmentPanel).toMatch(/Aegis/);
    expect(configurationProfile.safeguards.length).toBeGreaterThanOrEqual(3);
  });
});
