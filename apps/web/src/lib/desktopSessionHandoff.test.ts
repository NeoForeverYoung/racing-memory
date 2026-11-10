import { describe, expect, it } from "vitest";
import {
  desktopSessionToken,
  stageDesktopVideo,
  takeStagedDesktopVideo,
} from "./desktopSessionHandoff";

describe("desktop session video handoff", () => {
  it("uses the server-injected token when the first browser navigation loses its query", () => {
    expect(desktopSessionToken("", "injected-token")).toBe("injected-token");
    expect(desktopSessionToken("?desktopSession=query-token", "injected-token")).toBe("query-token");
  });

  it("locks a reviewed timeline and consumes it once", () => {
    stageDesktopVideo({
      telemetryUrl: "/telemetry",
      telemetryFileName: "race.ibt",
      video: { url: "/video", fileName: "race.mp4" },
      sync: { offsetMs: 1200, rate: 1.001, confidence: "reviewed", requiresReview: false },
    });
    expect(takeStagedDesktopVideo("race.ibt")).toMatchObject({
      syncOffsetMs: 1200,
      syncRate: 1.001,
      lockSync: true,
    });
    expect(takeStagedDesktopVideo("race.ibt")).toBeNull();
  });

  it("keeps a low-confidence timeline editable", () => {
    stageDesktopVideo({
      telemetryUrl: "/telemetry",
      telemetryFileName: "review.ibt",
      video: { url: "/video", fileName: "review.mp4" },
      sync: { offsetMs: 0, rate: 1, confidence: "low", requiresReview: true },
    });
    expect(takeStagedDesktopVideo("review.ibt")?.lockSync).toBe(false);
  });
});
