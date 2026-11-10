import { describe, expect, it } from "vitest";
import { createSyntheticIbt } from "@lapwing/game-adapter-iracing/fixture";
import { parseIracingFile } from "@lapwing/game-adapter-iracing/parser";
import { normalizeChannels } from "@/lib/channels";
import type { GpsSample } from "@/types/racing";
import { fastestAvailableClipWindow, fastestLapClipEndSessionMs, isSpanAvailableForVideoClip, nativeLapSpans } from "./sessionAssets";
import { videoCoverageMs } from "@lapwing/media";

function sample(t: number, lap: number, progress: number, lastLapTime?: number): GpsSample {
  return {
    t, lat: 0, lon: 0, speedMps: 0, speedMph: 0, speedKph: 0,
    extraFields: {
      "custom:lap_number": lap,
      lap_dist_pct: progress,
      ...(lastLapTime == null ? {} : { "custom:lap_last_lap_time": lastLapTime }),
    },
  };
}

describe("nativeLapSpans", () => {
  it("keeps recording until after iRacing publishes Last", () => {
    const [lap] = nativeLapSpans([
      sample(0, 1, 0, 0),
      sample(900, 1, 99.9, 0),
      sample(1_000, 2, 0, 0),
      sample(3_600, 2, 2, 90.123),
    ]);

    expect(lap).toMatchObject({
      endMs: 1_000,
      officialTimeMs: 90_123,
      officialTimePublishedAtMs: 3_600,
    });
    expect(fastestAvailableClipWindow({
      span: lap,
      videoDurationSec: 30,
      preRollSec: 0,
      postRollSec: 5,
      syncOffsetMs: 0,
      syncRate: 1,
    })).toEqual({ startSec: 0, endSec: 8.6 });
  });

  it("keeps the post-roll tail after the finish line even when Last telemetry leads the HUD", () => {
    expect(fastestAvailableClipWindow({
      span: { startMs: 0, endMs: 10_000, officialTimePublishedAtMs: 10_200 },
      videoDurationSec: 120,
      preRollSec: 0,
      postRollSec: 5,
      syncOffsetMs: 0,
      syncRate: 1,
    })).toEqual({ startSec: 0, endSec: 15.2 });
    expect(fastestAvailableClipWindow({
      span: { startMs: 0, endMs: 10_000, officialTimePublishedAtMs: 9_500 },
      videoDurationSec: 120,
      preRollSec: 0,
      postRollSec: 5,
      syncOffsetMs: 0,
      syncRate: 1,
    })).toEqual({ startSec: 0, endSec: 15 });
    expect(fastestLapClipEndSessionMs({
      span: { startMs: 0, endMs: 10_000, officialTimePublishedAtMs: 10_200 },
      videoDurationSec: 12,
      postRollSec: 5,
      syncOffsetMs: 0,
      syncRate: 1,
    })).toBe(12_000);
  });

  it("detects Last after the line when consecutive laps share the same time", () => {
    const lapDurationSec = 90.123;
    const [lap] = nativeLapSpans([
      sample(0, 1, 0, 0),
      sample(89_900, 1, 88, 0),
      sample(90_000, 2, 0, lapDurationSec),
      sample(95_000, 2, 2, lapDurationSec),
    ]);

    expect(lap).toMatchObject({
      officialTimeMs: 90_123,
      officialTimePublishedAtMs: 90_000,
    });
  });

  it("rejects laps whose finish line is beyond video coverage", () => {
    const postRollSec = 5;
    const videoDurationSec = 1286.856;
    const syncOffsetMs = 0;
    const syncRate = 1;
    const coverage = videoCoverageMs(syncOffsetMs, videoDurationSec, syncRate);
  const outside = {
      lap: 14,
      startMs: 1_190_683,
      endMs: 1_329_367,
      durationMs: 138_683,
      startIndex: 0,
      endIndex: 1,
      officialTimeMs: 138_696,
      officialTimePublishedAtMs: 1_331_217,
      startProgress: 0,
      endProgress: 100,
      incidents: 0,
      onPitRoad: false,
      complete: true,
    };
    const inside = {
      ...outside,
      lap: 11,
      startMs: 500_000,
      endMs: 614_383,
      durationMs: 114_383,
      officialTimePublishedAtMs: 619_383,
    };
    const options = { videoDurationSec, preRollSec: 5, postRollSec, syncOffsetMs, syncRate, coverage };
    expect(isSpanAvailableForVideoClip(outside, options)).toBe(false);
    expect(isSpanAvailableForVideoClip(inside, options)).toBe(true);
  });

  it("finds complete native laps in the synthetic IBT fixture", () => {
    const fixture = createSyntheticIbt({ durationSec: 120, tickRate: 5, lapDurationSec: 30 });
    const data = normalizeChannels(parseIracingFile(fixture.bytes.buffer));

    expect(nativeLapSpans(data.samples).filter((lap) => lap.complete)).toHaveLength(4);
  });
});
