import { describe, expect, it, vi } from "vitest";

vi.mock("../bundleCommands", () => ({ createBundle: vi.fn(async () => undefined) }));
vi.mock("../jobStore", () => ({
  readSessionBundle: vi.fn(async () => ({ videos: [{ durationSec: 120 }] })),
  waitForStableFile: vi.fn(async () => undefined),
  writeJsonAtomic: vi.fn(async () => undefined),
}));

import { runCaptureSession } from "./capture";

const base = (state: string, t: number) => ({
  game: "iracing",
  state,
  sessionId: "test-session",
  sessionTimeSeconds: t,
  wallClock: new Date(1_700_000_000_000 + t * 1000).toISOString(),
  monotonicMs: t * 1000,
});

describe("stale terminal state while a track loads", () => {
  it("ignores a finished event that arrives before any green flag", async () => {
    const states = ["connecting", "live", "finished", "live", "green", "finished"];
    const game = {
      id: "iracing",
      events: async function* () {
        for (const [index, state] of states.entries()) yield base(state, index * 30);
      },
    };
    const calls: string[] = [];
    const recorder = {
      id: "obs",
      start: async (race: { state: string }) => {
        calls.push(`start:${race.state}`);
        return { acknowledgedAt: new Date(1_700_000_150_000).toISOString() };
      },
      stop: async (race: { state: string }) => {
        calls.push(`stop:${race.state}`);
        return {
          path: "E:/Temp/fake.mp4",
          acknowledgedAt: new Date(1_700_000_300_000).toISOString(),
        };
      },
    };
    const telemetry = { waitForTelemetry: async () => "E:/Temp/fake.ibt" };

    await runCaptureSession(game as never, recorder as never, telemetry as never, {
      outputBundle: "E:/Temp/stale-test/session.bundle.json",
      stableWindowMs: 0,
    });

    expect(calls).toEqual(["start:green", "stop:finished"]);
  });
});
