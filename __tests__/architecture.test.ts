import { describe, expect, it } from "vitest";
import { getArchitectureSnapshot, getOperationalScore } from "@/lib/architecture";

describe("architecture snapshot", () => {
  it("orders timeline events by year", () => {
    const snapshot = getArchitectureSnapshot();
    const years = snapshot.timeline2050.map((event) => event.targetYear);
    const sorted = [...years].sort((a, b) => a - b);

    expect(years).toEqual(sorted);
  });

  it("exposes all critical areas", () => {
    const snapshot = getArchitectureSnapshot();
    const keys = snapshot.serviceAreas.map((area) => area.id);

    expect(keys).toEqual(expect.arrayContaining(["backend", "frontend", "arya", "timeline2050"]));
  });
});

describe("operational score", () => {
  it("returns a bounded normalized value", () => {
    const score = getOperationalScore();
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(2);
  });
});
