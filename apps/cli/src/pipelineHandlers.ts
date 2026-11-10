import { resolve } from "node:path";
import { suggestSessionSync } from "@/lib/syncSuggestion";
import { CliError } from "./errors";
import { createInspectReport, createMemoryDetectReport, loadTelemetry } from "./core";
import { generateBundleInsights } from "./insights";
import { resolveBundlePath } from "./jobStore";
import type { PipelineHandlers } from "./pipelineRunner";
import { renderMemoryReel } from "./reel";
import { analyzeBundle, renderReport } from "./report";
import { renderSessionAssets } from "./sessionAssets";
import { selectTrainingCard } from "./trainingCard";
import { createDeliveryManifest } from "./deliveryManifest";

function optionNumber(options: Record<string, unknown>, key: string, fallback: number): number {
  const value = options[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function createPipelineHandlers(): PipelineHandlers {
  return {
    inspect: ({ bundle, bundlePath }) => {
      const loaded = loadTelemetry(resolveBundlePath(bundlePath, bundle.telemetry.path));
      return createInspectReport(loaded);
    },
    sync: ({ bundle, bundlePath }) => {
      const loaded = loadTelemetry(resolveBundlePath(bundlePath, bundle.telemetry.path));
      return suggestSessionSync(bundle, loaded.data);
    },
    analyze: async ({ bundlePath }) => ({ analytics: (await analyzeBundle(bundlePath)).analytics }),
    memory: ({ bundle, bundlePath }) => {
      const loaded = loadTelemetry(resolveBundlePath(bundlePath, bundle.telemetry.path));
      return createMemoryDetectReport(loaded);
    },
    reel: ({ bundle, bundlePath, outputDirectory, manifest }) => {
      const video = bundle.videos[0];
      if (!video) throw new CliError("MISSING_INPUT", "The session bundle has no video.", 1);
      const loaded = loadTelemetry(resolveBundlePath(bundlePath, bundle.telemetry.path));
      const suggestion = suggestSessionSync(bundle, loaded.data);
      if (suggestion.confidence === "low" && manifest.options.acceptLowConfidence !== true) {
        throw new CliError(
          "SYNC_LOW_CONFIDENCE",
          "Synchronization confidence is low; set job option acceptLowConfidence to true after review.",
          1,
        );
      }
      return renderMemoryReel({
        loaded,
        videoPath: resolveBundlePath(bundlePath, video.path),
        outputPath: resolve(outputDirectory, "reel.mp4"),
        durationMs: optionNumber(manifest.options, "durationSeconds", 60) * 1_000,
        syncOffsetMs: suggestion.syncOffsetMs,
        syncRate: suggestion.syncRate,
      });
    },
    assets: ({ bundlePath, outputDirectory, manifest }) => renderSessionAssets({
      bundlePath,
      outputDirectory: resolve(outputDirectory, "session-assets"),
      preRollSec: optionNumber(manifest.options, "preRollSeconds", 5),
      // Five seconds after the actual line keeps iRacing's `Last` HUD result
      // visible in the exported complete-lap clip.
      postRollSec: optionNumber(manifest.options, "postRollSeconds", 5),
      optSections: optionNumber(manifest.options, "optSections", 10),
    }),
    report: ({ bundlePath, outputDirectory, manifest }) =>
      renderReport(
        bundlePath,
        resolve(outputDirectory, "report"),
        optionNumber(manifest.options, "images", 1),
      ),
    insights: ({ bundlePath }) => generateBundleInsights(bundlePath),
    training: async ({ bundlePath }) => selectTrainingCard(await generateBundleInsights(bundlePath)),
    delivery: ({ bundlePath, outputDirectory }) => createDeliveryManifest({ bundlePath, outputDirectory }),
  };
}
