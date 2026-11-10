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
  laps: [
    { lapNumber: 1, lapTimeMs: 60_123 },
    { lapNumber: 2, lapTimeMs: 61_877 },
  ],
  insights: [{ title: "更早回到油门", detail: "第 2 圈在出弯损失约 0.4 秒。", confidence: 0.9 }],
  trainingCard: {
    title: "练习出弯",
    detail: "集中练习一个区间。",
    exercise: "连续完成五个干净圈。",
    completionCriteria: "将损失降低到 0.2 秒。",
    confidence: "high" as const,
  },
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
    expect(html).toContain("逐圈表现");
    expect(html).toContain("下次练什么");
    expect(html).toContain("第 2 圈");
    expect(html).not.toContain("Machine-readable analytics");
    expect(html).not.toContain('"sampleCount"');
  });

  it("omits advice sections when no reliable recommendation exists", () => {
    const html = renderScorecardHtml({
      ...input,
      insights: [],
      trainingCard: null,
    });
    expect(html).not.toContain("最值得关注的机会");
    expect(html).not.toContain("下次练什么");
    expect(html).not.toContain("暂未生成");
  });
});
