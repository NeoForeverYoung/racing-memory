import { describe, expect, it } from "vitest";
import type { CanonicalSession } from "@lapwing/telemetry-core";
import { canonicalSessionToParsedData } from "./canonicalTelemetryBridge";

describe("canonicalSessionToParsedData", () => {
  it("does not fabricate GPS for a track-progress session", () => {
    const session: CanonicalSession = {
      source: { game: "fixture", format: "jsonl" },
      capabilities: ["telemetry.track-progress"],
      frames: [{ t: 0, spatial: { kind: "track", progress: 0.5 }, channels: {} }],
    };

    expect(canonicalSessionToParsedData(session)).toBeNull();
  });

  it("bridges geo frames to the legacy ParsedData model", () => {
    const session: CanonicalSession = {
      source: { game: "fixture", format: "jsonl" },
      capabilities: ["telemetry.geo"],
      frames: [{
        t: 250,
        spatial: { kind: "geo", lat: 51, lon: -1, altitudeM: 100 },
        channels: { speed_mps: 10, rpm: 7000 },
      }],
    };

    const parsed = canonicalSessionToParsedData(session);
    expect(parsed?.samples[0]).toMatchObject({ lat: 51, lon: -1, speedKph: 36 });
    expect(parsed?.samples[0].extraFields).toEqual({ rpm: 7000, altitude: 100 });
  });
});
