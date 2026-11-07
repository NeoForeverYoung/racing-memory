import { describe, expect, it } from "vitest";
import { deliveryLabel, sessionTitle, setupReady } from "./sessionModel";

describe("local desktop session presentation", () => {
  it("uses a useful fallback title without a course", () => {
    expect(sessionTitle({ track: "Watkins Glen", course: null, vehicle: "Ferrari 296 GT3" }))
      .toBe("Watkins Glen · Ferrari 296 GT3");
    expect(sessionTitle({ track: null, course: null, vehicle: null })).toBe("未命名赛道");
  });

  it("keeps the setup and delivery state actionable", () => {
    expect(setupReady({ dataRoot: "C:\\RacingMemoryData", telemetryDirectory: "C:\\iRacing", obsUrl: "ws://127.0.0.1:4455" })).toBe(true);
    expect(setupReady({ dataRoot: "", telemetryDirectory: "C:\\iRacing", obsUrl: "ws://127.0.0.1:4455" })).toBe(false);
    expect(deliveryLabel("failed")).toContain("重试");
  });
});
