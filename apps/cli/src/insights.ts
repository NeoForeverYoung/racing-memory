import { dirname, resolve } from "node:path";
import { generateDrivingInsights, type DrivingInsightsResult } from "@/lib/drivingInsights";
import { readSessionBundle } from "./jobStore";
import { loadTelemetry } from "./core";

export async function generateBundleInsights(bundlePath: string): Promise<DrivingInsightsResult> {
  const absoluteBundle = resolve(bundlePath);
  const bundle = await readSessionBundle(absoluteBundle);
  const telemetryPath = resolve(dirname(absoluteBundle), bundle.telemetry.path);
  const loaded = loadTelemetry(telemetryPath);
  return generateDrivingInsights(loaded.data.samples, loaded.laps);
}
