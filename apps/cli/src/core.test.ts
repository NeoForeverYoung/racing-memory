import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { loadTelemetry, loadTracks, planHighlightClips } from "./core";
import { parseDurationSeconds } from "./duration";
import type { MemoryHighlight } from "@lapwing/telemetry-core";
import { defaultCliAssets } from "./assets";

const incident: MemoryHighlight = {
  id: "incident-180000-2",
  kind: "incident",
  atMs: 180_000,
  startMs: 168_000,
  endMs: 185_000,
  score: 60,
  title: "Incident",
};

describe("parseDurationSeconds", () => {
  it("accepts agent-friendly duration suffixes", () => {
    expect(parseDurationSeconds("500ms")).toBe(0.5);
    expect(parseDurationSeconds("30s")).toBe(30);
    expect(parseDurationSeconds("8m")).toBe(480);
    expect(parseDurationSeconds("1.5h")).toBe(5400);
  });

  it("rejects malformed durations", () => {
    expect(() => parseDurationSeconds("eight minutes")).toThrow(/Invalid duration/);
  });
});

describe("planHighlightClips", () => {
  it("maps and clamps session windows onto video time", () => {
    expect(planHighlightClips([incident], 180, 10_000, 1)).toEqual([{
      highlight: incident,
      videoStartSec: 158,
      videoEndSec: 175,
    }]);
  });

  it("filters highlight kinds and validates sync rate", () => {
    expect(planHighlightClips([incident], 200, 0, 1, new Set(["finish"]))).toEqual([]);
    expect(() => planHighlightClips([incident], 200, 0, 0)).toThrow(/syncRate/);
  });
});

describe("loadTelemetry", () => {
  const sample = (name: string) => join(defaultCliAssets().sampleDirectory, name);

  it("detects laps against the bundled track database, like the app", () => {
    // Regression: the CLI used to force waypoint mode, splitting each ~55 s
    // OKC lap into ~8 s / ~48 s halves.
    const loaded = loadTelemetry(sample("okc-tillotson-data.dovex"));
    expect(loaded.lapSource).toBe("track");
    expect(loaded.trackName).toBe("Orlando Kart Center");
    expect(loaded.courseName).toBe("Normal");
    const fastest = Math.min(...loaded.laps.map((lap) => lap.lapTimeMs));
    expect(fastest).toBeGreaterThan(50_000);
  });

  it("falls back to waypoint mode with no track database", () => {
    const loaded = loadTelemetry(sample("okc-tillotson-data.dovex"), []);
    expect(loaded.lapSource).toBe("waypoint");
    expect(loaded.trackName).toBeNull();
  });

  it("loads the bundled tracks.json", () => {
    expect(loadTracks().some((track) => track.name === "Orlando Kart Center")).toBe(true);
  });

  it("reports missing files with a stable error code", () => {
    expect(() => loadTelemetry("/nonexistent/session.ibt")).toThrow(
      expect.objectContaining({ code: "FILE_NOT_FOUND" }),
    );
  });
});
