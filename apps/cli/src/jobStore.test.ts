import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDefaultJob, createDeliveryJob, hashValue, readJobManifest, writeJsonAtomic } from "./jobStore";
import { runPipeline } from "./pipelineRunner";

describe("jobStore", () => {
  it("writes manifests atomically and reads them back", () => {
    const directory = mkdtempSync(join(tmpdir(), "lapwing-job-"));
    const path = join(directory, "job.json");
    const manifest = createDefaultJob({
      bundlePath: join(directory, "bundle.json"),
      outputDirectory: join(directory, "output"),
    });
    writeJsonAtomic(path, manifest);
    expect(readJobManifest(path)).toEqual(manifest);
    expect(readFileSync(path, "utf8")).toContain('"schemaVersion": 1');
    expect(manifest.steps.map((step) => step.id)).toContain("training");
    expect(manifest.steps.find((step) => step.id === "training")?.dependsOn).toEqual(["insights"]);
  });

  it("omits the retired reel step from the full delivery preset", () => {
    const job = createDeliveryJob({
      bundlePath: "/tmp/session.bundle.json",
      outputDirectory: "/tmp/delivery",
      preset: "full",
    });
    const ids = job.steps.map((step) => step.id);
    expect(ids).not.toContain("reel");
    expect(ids).toContain("assets");
    expect(ids).toContain("report");
    expect(job.steps.find((step) => step.id === "delivery")?.dependsOn).toEqual([
      "assets",
      "report",
      "training",
    ]);
  });

  it("uses stable hashes for equivalent values", () => {
    expect(hashValue({ b: 2, a: 1 })).toBe(hashValue({ a: 1, b: 2 }));
  });

  it("keeps scorecard delivery independent from video steps", () => {
    const job = createDeliveryJob({
      bundlePath: "/tmp/session.bundle.json",
      outputDirectory: "/tmp/delivery",
      preset: "scorecard",
    });
    expect(job.options.deliveryPreset).toBe("scorecard");
    expect(job.steps.map((step) => step.id)).toEqual([
      "inspect",
      "analyze",
      "report",
      "insights",
      "training",
      "delivery",
    ]);
    expect(job.steps.some((step) => step.id === "sync" || step.id === "reel" || step.id === "assets")).toBe(false);
  });
});

describe("runPipeline", () => {
  it("checkpoints steps and resumes unchanged artifacts", async () => {
    const directory = mkdtempSync(join(tmpdir(), "lapwing-pipeline-"));
    const bundlePath = join(directory, "bundle.json");
    const manifestPath = join(directory, "job.json");
    writeFileSync(join(directory, "session.ibt"), "telemetry");
    writeFileSync(bundlePath, JSON.stringify({
      schemaVersion: 1,
      sessionId: "s1",
      game: "iracing",
      createdAt: "2026-11-04T08:00:00.000Z",
      telemetry: { path: "session.ibt" },
      videos: [],
      lifecycle: {},
    }));
    const manifest = createDefaultJob({
      bundlePath,
      outputDirectory: join(directory, "output"),
    });
    manifest.steps = manifest.steps.slice(0, 2);
    writeJsonAtomic(manifestPath, manifest);
    const calls: string[] = [];
    const handlers = {
      inspect: () => { calls.push("inspect"); return { ok: true }; },
      sync: () => { calls.push("sync"); return { ok: true }; },
    };
    const first = await runPipeline({ manifestPath, handlers });
    expect(first.status).toBe("succeeded");
    expect(calls).toEqual(["inspect", "sync"]);
    calls.length = 0;
    const resumed = await runPipeline({ manifestPath, handlers, resume: true });
    expect(resumed.status).toBe("succeeded");
    expect(calls).toEqual([]);
  });
});
