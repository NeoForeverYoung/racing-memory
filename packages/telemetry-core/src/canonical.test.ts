import { describe, expect, it } from "vitest";
import { hasCapability, validateCanonicalSession, type CanonicalSession } from "./canonical";

describe("canonical telemetry", () => {
  it("accepts a simulator session with track progress and no GPS", () => {
    const session: CanonicalSession = {
      source: { game: "fixture", format: "jsonl" },
      capabilities: ["telemetry.file", "telemetry.track-progress"],
      frames: [
        { t: 0, spatial: { kind: "track", progress: 0.1 }, channels: { speed_mps: 20 } },
        { t: 100, spatial: { kind: "track", progress: 0.2 }, channels: { speed_mps: 22 } },
      ],
    };

    expect(validateCanonicalSession(session)).toEqual([]);
    expect(hasCapability(session, "telemetry.geo")).toBe(false);
  });

  it("rejects a declared GPS capability when no frame contains GPS", () => {
    const session: CanonicalSession = {
      source: { game: "fixture", format: "jsonl" },
      capabilities: ["telemetry.geo"],
      frames: [{ t: 0, channels: {} }],
    };

    expect(validateCanonicalSession(session)).toContain(
      "telemetry.geo capability requires at least one geo frame.",
    );
  });
});
