import { describe, expect, it } from "vitest";
import {
  deliveryLabel,
  deliveryOverallPercent,
  parseDeliveryProgress,
  sessionTitle,
  setupReady,
} from "./sessionModel";

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

  it("parses engine progress and computes the overall percentage", () => {
    const inspect = parseDeliveryProgress('{"type":"progress","step":"inspect","status":"completed","percent":1}');
    const sync = parseDeliveryProgress('{"type":"progress","step":"sync","status":"started"}');
    const reel = parseDeliveryProgress('{"type":"progress","step":"reel","status":"running","percent":0.47}');

    expect(inspect).toMatchObject({ step: "inspect", status: "completed", percent: 100 });
    expect(sync).toMatchObject({ step: "sync", status: "started", percent: 0 });
    expect(reel).toMatchObject({ step: "reel", status: "started", percent: 47 });
    expect(deliveryOverallPercent({ inspect: inspect!, sync: sync! })).toBe(11);
    expect(parseDeliveryProgress("not json")).toBeNull();
  });
});
