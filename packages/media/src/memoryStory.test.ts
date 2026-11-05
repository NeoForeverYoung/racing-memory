import { describe, expect, it } from "vitest";
import { planMemoryStory } from "./memoryStory";
import type { MemoryHighlight } from "@lapwing/telemetry-core";

function highlight(
  id: string,
  kind: MemoryHighlight["kind"],
  atMs: number,
  score: number,
): MemoryHighlight {
  return {
    id,
    kind,
    atMs,
    startMs: atMs - 10_000,
    endMs: atMs + 5_000,
    score,
    title: id,
  };
}

describe("planMemoryStory", () => {
  it("selects scored events within a target duration", () => {
    const plan = planMemoryStory([
      highlight("best", "best_lap", 30_000, 100),
      highlight("finish", "finish", 120_000, 90),
      highlight("pass", "overtake", 70_000, 80),
      highlight("incident", "incident", 95_000, 60),
    ], 45_000);
    expect(plan.actualDurationMs).toBeLessThanOrEqual(45_000);
    expect(plan.segments.flatMap((segment) => segment.highlightIds)).toEqual(["best", "pass", "finish"]);
    expect(plan.rejected).toContainEqual({ highlightId: "incident", reason: "duration-budget" });
  });

  it("merges overlapping windows", () => {
    const plan = planMemoryStory([
      highlight("a", "overtake", 30_000, 80),
      highlight("b", "incident", 35_000, 60),
    ], 30_000);
    expect(plan.segments).toHaveLength(1);
    expect(plan.actualDurationMs).toBe(20_000);
  });
});
