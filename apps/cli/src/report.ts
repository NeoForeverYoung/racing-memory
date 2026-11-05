import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { analyzeSession, type SessionAnalytics } from "@/lib/sessionAnalytics";
import {
  renderScorecardHtml,
  renderScorecardSvg,
  type ScorecardInsight,
  type ScorecardVariant,
} from "@/lib/scorecardRenderer";
import { readIracingSessionMetadata } from "@lapwing/game-adapter-iracing/parser";
import { generateDrivingInsights, type DrivingInsightsResult } from "@/lib/drivingInsights";
import { defaultCliAssets } from "./assets";
import { readSessionBundle } from "./jobStore";
import { loadTelemetry } from "./core";

export interface SessionAnalysisResult {
  analytics: SessionAnalytics;
  trackPoints: Array<{ lat: number; lon: number }>;
  drivingInsights: DrivingInsightsResult;
}

async function reportTrackPoints(
  loaded: ReturnType<typeof loadTelemetry>,
): Promise<Array<{ lat: number; lon: number }>> {
  if (loaded.trackLayout && loaded.trackLayout.length >= 2) return loaded.trackLayout;
  if (loaded.trackShortName && loaded.courseName) {
    try {
      const drawings = JSON.parse(await readFile(defaultCliAssets().drawingsPath, "utf8")) as Record<
        string,
        Array<{ lat: number; lon: number }>
      >;
      const drawing = drawings[`${loaded.trackShortName}/${loaded.courseName}`];
      if (drawing?.length >= 2) return drawing;
    } catch {
      // A missing optional drawing never blocks a report; GPS is authoritative fallback.
    }
  }
  return loaded.data.samples.map(({ lat, lon }) => ({ lat, lon }));
}

export async function analyzeBundle(bundlePath: string): Promise<SessionAnalysisResult> {
  const absoluteBundle = resolve(bundlePath);
  const bundle = await readSessionBundle(absoluteBundle);
  const telemetryPath = resolve(dirname(absoluteBundle), bundle.telemetry.path);
  const loaded = loadTelemetry(telemetryPath);
  const bundleMetadata = bundle.metadata ?? {};
  const sourceMetadata = telemetryPath.toLowerCase().endsWith(".ibt")
    ? readIracingSessionMetadata(await readFile(telemetryPath).then((bytes) => Uint8Array.from(bytes).buffer))
    : {};
  const metadata = {
    ...sourceMetadata,
    ...bundleMetadata,
    track: bundleMetadata.track ?? sourceMetadata.track ?? loaded.trackName ?? undefined,
    course: bundleMetadata.course ?? sourceMetadata.course ?? loaded.courseName ?? undefined,
  };
  const analytics = analyzeSession(loaded.data, loaded.laps, metadata);
  return {
    analytics,
    trackPoints: await reportTrackPoints(loaded),
    drivingInsights: generateDrivingInsights(loaded.data.samples, loaded.laps),
  };
}

export async function renderReport(
  bundlePath: string,
  outputDirectory: string,
  imageCount: number,
  insights: ScorecardInsight[] = [],
): Promise<{ outputDirectory: string; files: string[]; analytics: SessionAnalytics }> {
  const output = resolve(outputDirectory);
  const analysis = await analyzeBundle(bundlePath);
  const { default: sharp } = await import("sharp");
  await mkdir(output, { recursive: true });
  const files: string[] = [];
  const variants: ScorecardVariant[] = ["summary", "track", "laps", "insights"];
  const reportInsights = insights.length > 0 ? insights : analysis.drivingInsights.insights.map((insight) => ({
    title: insight.title,
    detail: insight.advice,
    confidence: insight.confidence === "high" ? 0.9 : insight.confidence === "medium" ? 0.65 : 0.35,
  }));
  const input = { ...analysis, insights: reportInsights };
  const count = Math.max(0, Math.floor(imageCount));
  for (let index = 0; index < count; index++) {
    const variant = variants[index % variants.length];
    const suffix = index < variants.length ? variant : `${variant}-${index + 1}`;
    const svgName = `scorecard-${suffix}.svg`;
    const pngName = `scorecard-${suffix}.png`;
    const svg = renderScorecardSvg(input, variant);
    await writeFile(join(output, svgName), svg, "utf8");
    await sharp(Buffer.from(svg)).png().toFile(join(output, pngName));
    files.push(svgName, pngName);
  }
  await writeFile(join(output, "analytics.json"), `${JSON.stringify(analysis.analytics, null, 2)}\n`, "utf8");
  await writeFile(join(output, "index.html"), renderScorecardHtml(input), "utf8");
  files.push("analytics.json", "index.html");
  return { outputDirectory: output, files, analytics: analysis.analytics };
}

export function defaultReportDirectory(bundlePath: string): string {
  return resolve(dirname(bundlePath), `${basename(bundlePath, ".json")}-report`);
}
