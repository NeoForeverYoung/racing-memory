import { describe, expect, it } from "vitest";
import { renderScorecardHtml, renderScorecardSvg } from "./scorecardRenderer";

const input = {
  analytics: {
    metadata: { track: "Spa & Test", vehicle: "GT3" },
    sampleCount: 100,
    durationMs: 120_000,
    completeLapCount: 2,
    fastestLapMs: 60_123,
    fastestLapNumber: 1,
    averageLapMs: 61_000,
    medianLapMs: 61_000,
    optimalLapMs: 59_900,
    sectors: [],
    consistencyStdDevMs: 500,
    excludedLapNumbers: [],
    dataQuality: null,
  },
  trackPoints: [
    { lat: 50, lon: 5 },
    { lat: 50.1, lon: 5.1 },
  ],
};

describe("scorecard renderer", () => {
  it("renders a self-contained SVG with escaped metadata and track geometry", () => {
    const svg = renderScorecardSvg(input);
    expect(svg).toContain("Spa &amp; Test");
    expect(svg).toContain("1:00.123");
    expect(svg).toContain("<polyline");
  });

  it("renders a self-contained HTML report", () => {
    const html = renderScorecardHtml(input);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<svg");
    expect(html).not.toContain('src="scorecard');
  });
});
