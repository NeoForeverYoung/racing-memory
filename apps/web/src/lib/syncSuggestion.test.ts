import { describe, expect, it } from "vitest";
import { suggestSessionSync } from "./syncSuggestion";
import type { SessionBundleV1 } from "@lapwing/telemetry-core";

function bundle(): SessionBundleV1 {
  return {
    schemaVersion: 1,
    sessionId: "s1",
    game: "iracing",
    createdAt: "2026-11-04T08:00:00.000Z",
    telemetry: { path: "race.ibt" },
    videos: [{ path: "race.mp4", startedAt: "2026-11-04T08:00:05.000Z" }],
    lifecycle: {},
  };
}

describe("suggestSessionSync", () => {
  it("uses file timestamps only as low-confidence evidence", () => {
    const suggestion = suggestSessionSync(bundle(), { startDate: new Date("2026-11-04T08:00:00.000Z") });
    expect(suggestion).toMatchObject({
      method: "file-time",
      syncOffsetMs: 5_000,
      syncRate: 1,
      confidence: "low",
      requiresReview: true,
    });
  });

  it("fits two companion anchors with high confidence", () => {
    const value = bundle();
    value.sync = {
      syncOffsetMs: 0,
      syncRate: 1,
      confidence: "high",
      requiresReview: false,
      evidence: [],
      anchors: [
        { sessionMs: 1_000, videoSec: 0, source: "companion-start" },
        { sessionMs: 101_000, videoSec: 100, source: "companion-stop" },
      ],
    };
    expect(suggestSessionSync(value, { startDate: undefined })).toMatchObject({
      method: "companion-anchors",
      syncOffsetMs: 1_000,
      syncRate: 1,
      confidence: "high",
      requiresReview: false,
    });
  });

  it("preserves a companion quality downgrade on implausible anchors", () => {
    const value = bundle();
    value.sync = {
      syncOffsetMs: 1_000,
      syncRate: 1,
      confidence: "low",
      requiresReview: true,
      evidence: ["Observed video/session rate is implausible."],
      anchors: [
        { sessionMs: 1_000, videoSec: 0, source: "companion-start" },
        { sessionMs: 101_000, videoSec: 10, source: "companion-stop" },
      ],
    };
    expect(suggestSessionSync(value, { startDate: undefined })).toMatchObject({
      method: "companion-anchors",
      confidence: "low",
      requiresReview: true,
      evidence: ["Observed video/session rate is implausible."],
    });
  });
});
