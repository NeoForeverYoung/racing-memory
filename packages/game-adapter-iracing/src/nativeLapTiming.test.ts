import { describe, expect, it } from "vitest";
import type { GpsSample } from "@lapwing/telemetry-core";
import { nativeLapSpans } from "./nativeLapTiming";

function sample(t: number, lap: number, progress: number, last: number): GpsSample {
  return {
    t, lat: 0, lon: 0, speedMps: 0, speedMph: 0, speedKph: 0,
    extraFields: {
      "custom:lap_number": lap,
      lap_dist_pct: progress,
      "custom:lap_last_lap_time": last,
      race_incidents: 0,
      race_on_pit_road: 0,
    },
  };
}

describe("nativeLapSpans", () => {
  it("requires the canonical 0–100 progress range for a complete lap", () => {
    const spans = nativeLapSpans([
      sample(0, 1, 0, -1),
      sample(60_000, 1, 1, -1),
      sample(60_100, 2, 0, 60),
    ]);

    expect(spans[0].complete).toBe(false);
  });

  it("associates the settled Last value from the next lap with the lap that ended", () => {
    const spans = nativeLapSpans([
      sample(0, 4, 0, 140),
      sample(140_000, 4, 100, 140),
      sample(140_100, 5, 0, 140),
      sample(278_500, 5, 100, 140),
      sample(278_600, 6, 0, 138.406),
    ]);

    expect(spans[1]).toMatchObject({
      lap: 5,
      complete: true,
      officialTimeMs: 138_406,
      startIndex: 2,
      endIndex: 4,
    });
  });

  it("does not reuse a previous lap time that settled late in the current lap", () => {
    const spans = nativeLapSpans([
      sample(0, 1, 0, 130),
      sample(130_000, 1, 100, 130),
      sample(130_100, 2, 0, 130),
      sample(131_000, 2, 80, 140),
      sample(280_000, 2, 100, 140),
      sample(280_100, 3, 0, 140),
      sample(280_500, 3, 1, 150),
    ]);

    expect(spans[1].officialTimeMs).toBe(150_000);
  });
});
