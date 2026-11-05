import { describe, expect, it } from "vitest";
import { isSessionBundleV1, validateSessionBundle, type SessionBundleV1 } from "./sessionBundle";

function bundle(): SessionBundleV1 {
  return {
    schemaVersion: 1,
    sessionId: "session-1",
    game: "iracing",
    createdAt: "2026-11-04T08:00:00.000Z",
    telemetry: { path: "session.ibt", finalizedAt: "2026-11-04T08:10:00.000Z" },
    videos: [{ path: "race.mp4", durationSec: 600 }],
    lifecycle: {},
    sync: {
      syncOffsetMs: 1_000,
      syncRate: 1,
      confidence: "high",
      evidence: ["companion start anchor"],
      requiresReview: false,
      anchors: [{ sessionMs: 1_000, videoSec: 0, source: "companion-start" }],
    },
  };
}

describe("SessionBundleV1", () => {
  it("accepts a complete session bundle", () => {
    expect(validateSessionBundle(bundle())).toEqual([]);
    expect(isSessionBundleV1(bundle())).toBe(true);
  });

  it("reports nested synchronization errors", () => {
    const invalid = bundle() as unknown as Record<string, unknown>;
    invalid.sync = { syncOffsetMs: 0, syncRate: 0, confidence: "certain", evidence: [], anchors: [] };
    expect(validateSessionBundle(invalid)).toEqual(expect.arrayContaining([
      "sync.syncRate must be greater than 0.",
      "sync.confidence must be high, medium, or low.",
      "sync.requiresReview must be boolean.",
    ]));
  });

  it("validates lifecycle, metadata, provenance, and warnings", () => {
    const invalid = bundle() as unknown as Record<string, unknown>;
    invalid.lifecycle = { greenAt: "not-a-date" };
    invalid.metadata = { vehicle: 42 };
    invalid.provenance = { producer: "" };
    invalid.warnings = ["ok", 1];
    expect(validateSessionBundle(invalid)).toEqual(expect.arrayContaining([
      "lifecycle.greenAt must be an ISO date.",
      "metadata.vehicle must be a string.",
      "provenance.producer must be a non-empty string.",
      "warnings must be an array of strings.",
    ]));
  });
});
