import { describe, expect, it } from "vitest";
import { analyzeSession } from "./sessionAnalytics";
import type { Lap } from "@/types/racing";

function lap(lapNumber: number, lapTimeMs: number, incomplete = false): Lap {
  return {
    lapNumber,
    startTime: 0,
    endTime: lapTimeMs,
    lapTimeMs,
    maxSpeedMph: 100,
    maxSpeedKph: 161,
    minSpeedMph: 20,
    minSpeedKph: 32,
    startIndex: 0,
    endIndex: 1,
    incomplete,
    sectorTimes: [lapTimeMs / 2, lapTimeMs / 2],
  };
}

describe("analyzeSession", () => {
  it("excludes incomplete and extreme laps from comparable statistics", () => {
    const result = analyzeSession(
      { samples: [], duration: 300_000 },
      [lap(1, 60_000), lap(2, 61_000), lap(3, 62_000), lap(4, 180_000), lap(5, 10_000, true)],
      { vehicle: "GT3" },
    );

    expect(result.completeLapCount).toBe(4);
    expect(result.fastestLapNumber).toBe(1);
    expect(result.averageLapMs).toBe(61_000);
    expect(result.excludedLapNumbers).toEqual([4]);
    expect(result.metadata.vehicle).toBe("GT3");
  });
});
