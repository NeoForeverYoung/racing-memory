import { describe, expect, it } from "vitest";
import type { CanonicalSession } from "@lapwing/telemetry-core";
import { validateAdapterFixture } from "./fixtureContract";

describe("validateAdapterFixture", () => {
  it("accepts a non-GPS game without inventing unsupported race evidence", () => {
    const session: CanonicalSession = {
      source: { game: "template", format: "fixture" },
      capabilities: ["telemetry.file", "telemetry.track-progress"],
      frames: [{ t: 0, spatial: { kind: "track", progress: 0.2 }, channels: {} }],
    };

    expect(validateAdapterFixture(session, {
      spatial: "track",
      gameLaps: false,
      racePosition: false,
      incidents: false,
    })).toEqual([]);
  });

  it("rejects a capability that a fixture says is unavailable", () => {
    const session: CanonicalSession = {
      source: { game: "template", format: "fixture" },
      capabilities: ["race.incidents"],
      frames: [{ t: 0, channels: {} }],
    };

    expect(validateAdapterFixture(session, {
      spatial: "none",
      incidents: false,
    })).toContain("fixture declares unsupported race.incidents.");
  });
});
