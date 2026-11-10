import { describe, expect, it } from "vitest";
import { validateDeliveryManifest, type DeliveryManifestV1 } from "./deliveryManifest";

function manifest(path = "report/index.html"): DeliveryManifestV1 {
  return {
    schemaVersion: 1,
    generatedAt: "2026-11-10T02:00:00.000Z",
    generator: { version: "5.0.0" },
    summary: { completeLapCount: 5 },
    diagnosticsDirectory: "artifacts",
    items: [{
      id: "report",
      role: "report",
      group: "report",
      title: "完整赛后报告",
      path,
      mediaType: "text/html",
      order: 10,
    }],
  };
}

describe("delivery manifest", () => {
  it("accepts safe user-facing delivery items", () => {
    expect(validateDeliveryManifest(manifest())).toEqual([]);
  });

  it("rejects absolute paths and paths escaping the delivery directory", () => {
    expect(validateDeliveryManifest(manifest("../session.bundle.json"))).toContain(
      "items[0].path must be a safe relative path.",
    );
    expect(validateDeliveryManifest(manifest("C:\\Users\\driver\\video.mp4"))).toContain(
      "items[0].path must be a safe relative path.",
    );
  });
});
