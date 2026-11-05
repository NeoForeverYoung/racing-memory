import { describe, expect, it } from "vitest";
import {
  createJobManifest,
  deriveJobStatus,
  stableStringify,
  validateJobManifest,
} from "./jobManifest";

describe("JobManifestV1", () => {
  it("creates a valid dependency graph", () => {
    const manifest = createJobManifest({
      jobId: "job-1",
      bundlePath: "/tmp/session.bundle.json",
      outputDirectory: "/tmp/output",
      now: "2026-11-04T08:00:00.000Z",
      steps: [
        { id: "inspect", command: "inspect" },
        { id: "memory", command: "memory detect", dependsOn: ["inspect"] },
      ],
    });
    expect(validateJobManifest(manifest)).toEqual([]);
    expect(deriveJobStatus(manifest.steps)).toBe("pending");
  });

  it("derives partial and successful job states", () => {
    const manifest = createJobManifest({
      jobId: "job-1",
      bundlePath: "bundle.json",
      outputDirectory: "output",
      steps: [
        { id: "a", command: "a" },
        { id: "b", command: "b" },
      ],
    });
    manifest.steps[0].status = "done";
    manifest.steps[1].status = "failed";
    expect(deriveJobStatus(manifest.steps)).toBe("partial");
    manifest.steps[1].status = "done";
    expect(deriveJobStatus(manifest.steps)).toBe("succeeded");
  });

  it("uses canonical key ordering for hashes", () => {
    expect(stableStringify({ b: 2, a: { d: 4, c: 3 } }))
      .toBe('{"a":{"c":3,"d":4},"b":2}');
  });

  it("rejects malformed checkpoint metadata", () => {
    const manifest = createJobManifest({
      jobId: "job-1",
      bundlePath: "bundle.json",
      outputDirectory: "output",
      steps: [{ id: "inspect", command: "inspect" }],
    }) as unknown as Record<string, unknown>;
    manifest.updatedAt = "invalid";
    manifest.artifacts = { inspect: 42 };
    (manifest.steps as Array<Record<string, unknown>>)[0].inputHash = "bad";
    expect(validateJobManifest(manifest)).toEqual(expect.arrayContaining([
      "updatedAt must be an ISO date.",
      "artifacts must be a string map.",
      "steps[0].inputHash must use the sha256:<64 hex> form.",
    ]));
  });
});
