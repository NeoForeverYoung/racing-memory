import { describe, expect, it } from "vitest";
import { generateDrivingInsights } from "./drivingInsights";
import type { GpsSample, Lap } from "@/types/racing";

function sample(
  t: number,
  index: number,
  count: number,
  extraFields: Record<string, number> = {},
): GpsSample {
  const angle = (index / (count - 1)) * Math.PI * 2;
  return {
    t,
    lat: 35 + Math.sin(angle) * 0.001,
    lon: -80 + Math.cos(angle) * 0.001,
    speedMps: 25,
    speedMph: 55.9,
    speedKph: 90,
    extraFields: { throttle: index > count / 2 ? 100 : 20, ...extraFields },
  };
}

function lap(lapNumber: number, startIndex: number, endIndex: number, lapTimeMs: number): Lap {
  return {
    lapNumber,
    startTime: 0,
    endTime: lapTimeMs,
    lapTimeMs,
    maxSpeedMph: 60,
    maxSpeedKph: 96,
    minSpeedMph: 40,
    minSpeedKph: 64,
    startIndex,
    endIndex,
  };
}

describe("generateDrivingInsights", () => {
  it("reports an evidence-backed time-loss region against the fastest lap", () => {
    const count = 120;
    const reference = Array.from({ length: count }, (_, index) => sample(index * 100, index, count));
    const target = Array.from({ length: count }, (_, index) => sample(12_000 + index * 106, index, count));
    const result = generateDrivingInsights(
      [...reference, ...target],
      [lap(1, 0, count - 1, 11_900), lap(2, count, count * 2 - 1, 12_614)],
    );

    expect(result.referenceLapNumber).toBe(1);
    expect(result.analyzedLapNumber).toBe(2);
    expect(result.insights.length).toBeGreaterThan(0);
    expect(result.insights[0].evidence[0].metric).toBe("regional time loss");
    expect(result.insights[0].confidence).not.toBe("low");
  });

  it("degrades explicitly when there are not two complete laps", () => {
    const result = generateDrivingInsights([], []);
    expect(result.insights).toEqual([]);
    expect(result.warnings[0]).toContain("two complete laps");
  });

  it("does not compare a very slow lap against the fastest lap", () => {
    const count = 120;
    const reference = Array.from({ length: count }, (_, index) => sample(index * 100, index, count));
    const slow = Array.from({ length: count }, (_, index) => sample(12_000 + index * 145, index, count));
    const result = generateDrivingInsights(
      [...reference, ...slow],
      [lap(5, 0, count - 1, 11_900), lap(9, count, count * 2 - 1, 17_255)],
    );

    expect(result.analyzedLapNumber).toBeNull();
    expect(result.insights).toEqual([]);
    expect(result.warnings[0]).toContain("close enough");
  });

  it("excludes laps containing incidents or pit-road samples", () => {
    const count = 120;
    const reference = Array.from({ length: count }, (_, index) =>
      sample(index * 100, index, count, { race_incidents: 0 }));
    const incidentLap = Array.from({ length: count }, (_, index) =>
      sample(12_000 + index * 104, index, count, { race_incidents: index > 60 ? 1 : 0 }));
    const pitLap = Array.from({ length: count }, (_, index) =>
      sample(25_000 + index * 103, index, count, { race_on_pit_road: index > 80 ? 1 : 0 }));
    const result = generateDrivingInsights(
      [...reference, ...incidentLap, ...pitLap],
      [
        lap(1, 0, count - 1, 11_900),
        lap(2, count, count * 2 - 1, 12_376),
        lap(3, count * 2, count * 3 - 1, 12_257),
      ],
    );

    expect(result.analyzedLapNumber).toBeNull();
    expect(result.insights).toEqual([]);
  });
});
