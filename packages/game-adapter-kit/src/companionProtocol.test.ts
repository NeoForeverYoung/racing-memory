import { describe, expect, it } from "vitest";
import {
  encodeCompanionMessage,
  parseCompanionCommand,
  parseRaceLifecycleEvent,
} from "./companionProtocol";

describe("companion protocol", () => {
  it("round-trips lifecycle JSONL", () => {
    const line = encodeCompanionMessage({
      version: 1,
      event: "race.lifecycle",
      race: {
        game: "iracing",
        state: "green",
        sessionId: "race-1",
        sessionTimeSeconds: 12,
        wallClock: "2026-11-04T00:00:00.000Z",
        monotonicMs: 1234,
      },
    });
    expect(parseRaceLifecycleEvent(line).state).toBe("green");
  });

  it("strictly validates commands", () => {
    expect(parseCompanionCommand(JSON.stringify({
      version: 1,
      id: "1",
      command: "capture.start",
      outputDirectory: "C:\\captures",
    })).command).toBe("capture.start");
    expect(() => parseCompanionCommand('{"version":2,"id":"1","command":"capture.stop"}')).toThrow();
  });
});
