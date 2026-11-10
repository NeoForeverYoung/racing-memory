import { describe, expect, it } from "vitest";
import { selectTrainingCard } from "./trainingCard";

const insight = (id: string, confidence: "low" | "medium" | "high", timeLossMs: number) => ({
  id,
  kind: "braking" as const,
  title: id,
  advice: "Release the brake progressively.",
  lapNumber: 12,
  referenceLapNumber: 9,
  distanceMeters: 420,
  location: { lat: 0, lon: 0 },
  timeLossMs,
  confidence,
  evidence: [{ metric: "brake duration", current: 920, reference: 670, unit: "ms" }],
});

describe("selectTrainingCard", () => {
  it("prefers stronger evidence before a larger low-confidence loss", () => {
    const result = selectTrainingCard({
      referenceLapNumber: 9,
      analyzedLapNumber: 12,
      warnings: [],
      insights: [insight("low-large", "low", 700), insight("high-focus", "high", 280)],
    });
    expect(result.card?.source.insightId).toBe("high-focus");
    expect(result.card?.targetTimeLossMs).toBe(140);
    expect(result.card?.completionCriteria).toContain("5 个完整、无事故圈");
  });

  it("does not invent a task without usable evidence", () => {
    expect(selectTrainingCard({
      referenceLapNumber: 1,
      analyzedLapNumber: null,
      insights: [],
      warnings: ["At least two complete laps are required."],
    })).toEqual({
      schemaVersion: 1,
      card: null,
      reason: "At least two complete laps are required.",
    });
  });

  it("rejects medium-confidence and implausibly large losses", () => {
    const result = selectTrainingCard({
      referenceLapNumber: 5,
      analyzedLapNumber: 9,
      warnings: [],
      insights: [
        insight("medium", "medium", 800),
        insight("huge", "high", 54_664),
      ],
    });

    expect(result.card).toBeNull();
    expect(result.reason).toContain("足够可靠");
  });

  it("rejects a generic speed delta without control-specific evidence", () => {
    const generic = {
      ...insight("generic-speed", "high", 600),
      kind: "corner-speed" as const,
      evidence: [{ metric: "speed", current: 42, reference: 48, unit: "mph" }],
    };
    expect(selectTrainingCard({
      referenceLapNumber: 5,
      analyzedLapNumber: 6,
      warnings: [],
      insights: [generic],
    }).card).toBeNull();
  });
});
