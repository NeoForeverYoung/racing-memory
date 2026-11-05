import { describe, expect, it } from "vitest";
import type { GpsSample, Lap } from "@/types/racing";
import { detectMemoryHighlights, totalHighlightDuration } from "./highlights";

function sample(t: number, position: number, incidents: number, onPitRoad = false): GpsSample {
  return {
    t,
    lat: 1,
    lon: 1,
    speedMps: 30,
    speedMph: 67,
    speedKph: 108,
    extraFields: {
      race_position: position,
      race_incidents: incidents,
      race_on_pit_road: onPitRoad ? 1 : 0,
    },
  };
}

function lap(lapNumber: number, startTime: number, endTime: number): Lap {
  return {
    lapNumber,
    startTime,
    endTime,
    lapTimeMs: endTime - startTime,
    maxSpeedMph: 100,
    maxSpeedKph: 161,
    minSpeedMph: 30,
    minSpeedKph: 48,
    startIndex: 0,
    endIndex: 1,
  };
}

describe("detectMemoryHighlights", () => {
  it("finds the final best lap, overtakes, incidents and finish", () => {
    const highlights = detectMemoryHighlights({
      duration: 120_000,
      samples: [
        sample(0, 10, 0),
        sample(20_000, 9, 0),
        sample(21_000, 8, 0), // suppressed by the overtake cooldown
        sample(30_000, 8, 2),
        sample(40_000, 7, 2, true), // pit-road position gain is ignored
        sample(120_000, 7, 2),
      ],
    }, [
      lap(1, 0, 61_000),
      lap(2, 61_000, 120_000),
    ]);

    expect(highlights.map((highlight) => highlight.kind)).toEqual([
      "overtake",
      "incident",
      "best_lap",
      "finish",
    ]);
    expect(highlights.find((highlight) => highlight.kind === "best_lap")).toMatchObject({
      lapNumber: 2,
      detail: "Lap 2 · 0:59.000",
      score: 100,
    });
    expect(highlights.find((highlight) => highlight.kind === "overtake")?.detail).toBe("P10 → P9");
    // The UI localizes "Finished P7" from the structured position, not the English detail.
    expect(highlights.find((highlight) => highlight.kind === "finish")).toMatchObject({
      endMs: 120_000,
      position: 7,
    });
  });

  it("clamps windows and ignores incomplete laps", () => {
    const incomplete = { ...lap(1, 0, 5_000), incomplete: true };
    const highlights = detectMemoryHighlights({
      duration: 5_000,
      samples: [sample(0, 1, 0), sample(5_000, 1, 0)],
    }, [incomplete]);

    expect(highlights).toHaveLength(1);
    expect(highlights[0]).toMatchObject({ kind: "finish", startMs: 0, endMs: 5_000 });
    expect(totalHighlightDuration(highlights)).toBe(5_000);
  });
});
