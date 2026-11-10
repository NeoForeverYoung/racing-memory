import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { videoCoverageMs, videoSecToSessionMs } from "@lapwing/media";
import { nativeLapSpans, type NativeLapSpan } from "@lapwing/game-adapter-iracing/native-laps";
import type { GpsSample } from "@/types/racing";
import type { SessionAnalytics } from "@/lib/sessionAnalytics";
import { analyzeBundle } from "./report";
import { loadTelemetry, probeVideoDuration, runBinary } from "./core";
import { CliError } from "./errors";
import { emitProgress } from "./progress";
import { readSessionBundle, resolveBundlePath, writeJsonAtomic } from "./jobStore";
import { rasterizeSvg } from "./svgRasterizer";

export { nativeLapSpans };
export type { NativeLapSpan };

const LAP = "custom:lap_number";
const PROGRESS = "lap_dist_pct";
const INCIDENTS = "race_incidents";
const PIT = "race_on_pit_road";

interface OptChunk {
  section: string;
  lap: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  incidentFree: boolean;
}

export interface SessionAssetReport {
  schemaVersion: 1;
  command: "session render";
  outputDirectory: string;
  mementoPath: string;
  optCompositePath: string;
  fastestAvailablePath: string;
  manifestPath: string;
  fastestSession: { lap: number | null; timeMs: number | null };
  fastestAvailable: NativeLapSpan;
  video: { path: string; durationSec: number; syncOffsetMs: number; syncRate: number };
  opt: { sections: number; estimatedDurationMs: number; chunks: OptChunk[] };
}

function field(sample: GpsSample, key: string): number | undefined {
  return sample.extraFields[key] ?? sample.extraFields[`custom:${key}`];
}

function finite(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function interpolate(samples: GpsSample[], target: number): GpsSample | null {
  if (samples.length === 0) return null;
  const first = samples[0];
  const last = samples.at(-1)!;
  const firstProgress = field(first, PROGRESS);
  const lastProgress = field(last, PROGRESS);
  if (!finite(firstProgress) || !finite(lastProgress)) return null;
  if (target <= firstProgress) return first;
  for (let index = 1; index < samples.length; index++) {
    const previous = samples[index - 1];
    const current = samples[index];
    const previousProgress = field(previous, PROGRESS);
    const currentProgress = field(current, PROGRESS);
    if (!finite(previousProgress) || !finite(currentProgress) || currentProgress < target) continue;
    const fraction = (target - previousProgress) / (currentProgress - previousProgress || 1);
    return {
      ...current,
      t: previous.t + (current.t - previous.t) * fraction,
      extraFields: {
        ...current.extraFields,
        [INCIDENTS]: Math.max(field(previous, INCIDENTS) ?? 0, field(current, INCIDENTS) ?? 0),
        [PIT]: Math.max(field(previous, PIT) ?? 0, field(current, PIT) ?? 0),
      },
    };
  }
  // iRacing's final GPS sample usually lands a few thousandths of a percent
  // before 100 after filtering; it is still the lap endpoint for a video cut.
  return target <= lastProgress + 0.02 ? last : null;
}

function timeText(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const minutes = Math.floor(ms / 60_000);
  const seconds = (ms / 1000 - minutes * 60).toFixed(3).padStart(6, "0");
  return `${minutes}:${seconds}`;
}

function xml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function trackPolyline(points: Array<{ lat: number; lon: number }>): string {
  const reduced = points.filter((_, index) => index % Math.max(1, Math.ceil(points.length / 140)) === 0);
  const lats = reduced.map((point) => point.lat);
  const lons = reduced.map((point) => point.lon);
  const minLat = Math.min(...lats); const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons); const maxLon = Math.max(...lons);
  const scale = Math.min(1460 / (maxLon - minLon || 1), 680 / (maxLat - minLat || 1));
  return reduced.map((point) => `${(350 + (point.lon - minLon) * scale).toFixed(1)},${(1940 - (point.lat - minLat) * scale).toFixed(1)}`).join(" ");
}

function mementoSvg(analytics: SessionAnalytics, points: Array<{ lat: number; lon: number }>): string {
  const meta = analytics.metadata;
  const trace = trackPolyline(points);
  const lap = analytics.fastestLapNumber == null ? "—" : `第 ${analytics.fastestLapNumber} 圈`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="2160" height="2700" viewBox="0 0 2160 2700">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#101116"/><stop offset="1" stop-color="#090a0d"/></linearGradient><radialGradient id="halo" cx="70%" cy="25%" r="65%"><stop stop-color="#e12637" stop-opacity=".28"/><stop offset="1" stop-color="#e12637" stop-opacity="0"/></radialGradient></defs>
  <rect width="2160" height="2700" fill="url(#bg)"/><rect width="2160" height="2700" fill="url(#halo)"/><rect width="2160" height="25" fill="#e12637"/>
  <g font-family="PingFang SC, Hiragino Sans GB, Arial Unicode MS, sans-serif"><text x="150" y="180" fill="#f5f5f6" font-size="65" font-weight="700">赛道记忆</text><text x="150" y="260" fill="#aeb0b8" font-size="36">${xml(meta.track ?? "未知赛道")}${meta.course ? ` · ${xml(meta.course)}` : ""}</text>
  <line x1="150" y1="320" x2="2010" y2="320" stroke="#3b3b41" stroke-width="2"/><text x="1080" y="535" fill="#aeb0b8" font-size="42" text-anchor="middle">本次 Session 最快圈</text>
  <text x="1080" y="805" fill="#fff" font-family="Arial, sans-serif" font-size="280" font-weight="700" text-anchor="middle">${timeText(analytics.fastestLapMs)}</text><rect x="690" y="865" width="780" height="82" rx="41" fill="#bb1c2d"/><text x="1080" y="920" fill="#fff" font-size="38" font-weight="700" text-anchor="middle">${lap} · iRacing 原生计时</text>
  <polyline points="${trace}" fill="none" stroke="#701624" stroke-width="58" opacity=".55" stroke-linecap="round" stroke-linejoin="round"/><polyline points="${trace}" fill="none" stroke="#f7f7f8" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/><polyline points="${trace}" fill="none" stroke="#e12637" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
  <g transform="translate(150 2200)"><text fill="#aeb0b8" font-size="31">车手</text><text y="72" fill="#fff" font-size="57" font-weight="700">${xml(meta.driver ?? "—")}</text><text x="700" fill="#aeb0b8" font-size="31">完整圈数</text><text x="700" y="72" fill="#fff" font-family="Arial" font-size="62" font-weight="700">${analytics.completeLapCount}</text><text x="1260" fill="#aeb0b8" font-size="31">平均圈速</text><text x="1260" y="72" fill="#fff" font-family="Arial" font-size="62" font-weight="700">${timeText(analytics.averageLapMs)}</text></g>
  <line x1="150" y1="2450" x2="2010" y2="2450" stroke="#3b3b41" stroke-width="2"/><text x="150" y="2550" fill="#fff" font-size="43" font-weight="700">${xml(meta.vehicle ?? "—")}</text><text x="150" y="2625" fill="#aeb0b8" font-size="31">${xml(meta.sessionType ?? "Session")} · 数据来自 iRacing 原生遥测记录</text></g></svg>`;
}

function concatQuote(path: string): string { return path.replaceAll("'", "'\\''"); }

function makeOptChunks(samples: GpsSample[], spans: NativeLapSpan[], sections: number): OptChunk[] {
  const byLap = new Map<number, GpsSample[]>();
  for (const sample of samples) {
    const lap = field(sample, LAP);
    if (finite(lap)) (byLap.get(Math.round(lap)) ?? byLap.set(Math.round(lap), []).get(Math.round(lap))!).push(sample);
  }
  const candidates = spans.filter((span) => span.complete && !span.onPitRoad);
  const chunks: OptChunk[] = [];
  for (let index = 0; index < sections; index++) {
    // `lap_dist_pct` is canonicalized from iRacing's 0..1 ratio to 0..100.
    const start = (index / sections) * 100; const end = ((index + 1) / sections) * 100;
    const choices = candidates.flatMap((span) => {
      const lapSamples = byLap.get(span.lap) ?? [];
      const from = interpolate(lapSamples, start); const to = interpolate(lapSamples, end);
      if (!from || !to || to.t <= from.t) return [];
      return [{ section: `${Math.round(start)}–${Math.round(end)}%`, lap: span.lap, startMs: from.t, endMs: to.t, durationMs: to.t - from.t, incidentFree: (field(from, INCIDENTS) ?? 0) === (field(to, INCIDENTS) ?? 0) }];
    }).sort((a, b) => a.durationMs - b.durationMs);
    const selected = choices.find((choice) => choice.incidentFree) ?? choices[0];
    if (!selected) throw new CliError("NO_COMPLETE_LAPS", "No complete, usable laps are available for OPT composition.", 1);
    chunks.push(selected);
  }
  return chunks;
}

function encodeVideo(codec: string): string[] {
  if (codec === "h264_videotoolbox") {
    return ["-c:v", codec, "-allow_sw", "1", "-b:v", "18M", "-maxrate", "22M", "-bufsize", "36M", "-pix_fmt", "yuv420p"];
  }
  return ["-c:v", codec, "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p"];
}

/** Session time (ms) the video must cover through for a fastest-lap export. */
export function fastestLapClipEndSessionMs(options: {
  span: Pick<NativeLapSpan, "startMs" | "endMs" | "officialTimePublishedAtMs">;
  videoDurationSec: number;
  postRollSec: number;
  syncOffsetMs: number;
  syncRate: number;
}): number {
  const { endSec } = fastestAvailableClipWindow({
    ...options,
    preRollSec: 0,
  });
  return videoSecToSessionMs(endSec, options.syncOffsetMs, options.syncRate);
}

/** True when the finish line and post-roll tail both fit inside the synced video window. */
export function isSpanAvailableForVideoClip(
  span: NativeLapSpan,
  options: {
    videoDurationSec: number;
    preRollSec: number;
    postRollSec: number;
    syncOffsetMs: number;
    syncRate: number;
    coverage: ReturnType<typeof videoCoverageMs>;
  },
): boolean {
  if (!span.complete || span.onPitRoad || span.startMs < options.coverage.startMs) return false;
  if (span.endMs > options.coverage.endMs) return false;
  const lineVideoSec = ((span.endMs - options.syncOffsetMs) * options.syncRate) / 1000;
  if (lineVideoSec > options.videoDurationSec) return false;
  const clip = fastestAvailableClipWindow({
    span,
    videoDurationSec: options.videoDurationSec,
    preRollSec: options.preRollSec,
    postRollSec: options.postRollSec,
    syncOffsetMs: options.syncOffsetMs,
    syncRate: options.syncRate,
  });
  if (clip.endSec + 0.02 < lineVideoSec + options.postRollSec) return false;
  const clipEndMs = fastestLapClipEndSessionMs({
    span,
    videoDurationSec: options.videoDurationSec,
    postRollSec: options.postRollSec,
    syncOffsetMs: options.syncOffsetMs,
    syncRate: options.syncRate,
  });
  return clipEndMs <= options.coverage.endMs;
}

export function fastestAvailableClipWindow(options: { span: Pick<NativeLapSpan, "startMs" | "endMs" | "officialTimePublishedAtMs">; videoDurationSec: number; preRollSec: number; postRollSec: number; syncOffsetMs: number; syncRate: number }): { startSec: number; endSec: number } {
  const startSec = Math.max(0, ((options.span.startMs - options.syncOffsetMs) * options.syncRate) / 1000 - options.preRollSec);
  const lineVideoSec = ((options.span.endMs - options.syncOffsetMs) * options.syncRate) / 1000;
  const settledVideoSec = options.span.officialTimePublishedAtMs != null
    ? ((options.span.officialTimePublishedAtMs - options.syncOffsetMs) * options.syncRate) / 1000
    : lineVideoSec;
  // `Last` can trail the line on video even when telemetry already moved; keep
  // the configured tail after the line and, when later, after telemetry `Last`.
  const endSec = Math.min(
    options.videoDurationSec,
    Math.max(lineVideoSec + options.postRollSec, settledVideoSec + options.postRollSec),
  );
  return { startSec, endSec };
}

function renderFastestAvailable(options: { ffmpeg: string; videoCodec: string; videoPath: string; outputPath: string; span: NativeLapSpan; videoDurationSec: number; preRollSec: number; postRollSec: number; syncOffsetMs: number; syncRate: number }): { startSec: number; endSec: number } {
  const clip = fastestAvailableClipWindow(options);
  runBinary(options.ffmpeg, ["-v", "error", "-y", "-ss", clip.startSec.toFixed(3), "-i", options.videoPath, "-t", (clip.endSec - clip.startSec).toFixed(3), ...encodeVideo(options.videoCodec), "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", options.outputPath]);
  return clip;
}

function renderOptComposite(options: { ffmpeg: string; videoCodec: string; videoPath: string; outputPath: string; chunks: OptChunk[]; syncOffsetMs: number; syncRate: number }): void {
  const temp = mkdtempSync(join(tmpdir(), "lapwing-opt-"));
  try {
    const parts = options.chunks.map((chunk, index) => {
      const path = join(temp, `${String(index).padStart(2, "0")}.mp4`);
      const startSec = ((chunk.startMs - options.syncOffsetMs) * options.syncRate) / 1000;
      runBinary(options.ffmpeg, ["-v", "error", "-y", "-ss", startSec.toFixed(3), "-i", options.videoPath, "-t", (chunk.durationMs / 1000).toFixed(3), ...encodeVideo(options.videoCodec), "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", path]);
      emitProgress(
        "assets",
        "running",
        `Encoded OPT section ${index + 1} of ${options.chunks.length}.`,
        0.4 + ((index + 1) / options.chunks.length) * 0.55,
      );
      return path;
    });
    const concat = join(temp, "concat.txt");
    writeFileSync(concat, parts.map((path) => `file '${concatQuote(path)}'`).join("\n"));
    runBinary(options.ffmpeg, ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", concat, "-c", "copy", "-movflags", "+faststart", options.outputPath]);
    emitProgress("assets", "running", "OPT composite is ready.", 1);
  } finally { rmSync(temp, { recursive: true, force: true }); }
}

export async function renderSessionAssets(options: { bundlePath: string; outputDirectory: string; ffmpeg?: string; ffprobe?: string; videoCodec?: string; preRollSec?: number; postRollSec?: number; optSections?: number }): Promise<SessionAssetReport> {
  const absoluteBundle = resolve(options.bundlePath);
  const outputDirectory = resolve(options.outputDirectory);
  const bundle = readSessionBundle(absoluteBundle);
  const video = bundle.videos[0];
  if (!video) throw new CliError("MISSING_INPUT", "The session bundle has no video.");
  const ffmpeg = options.ffmpeg ?? process.env.RACING_MEMORY_FFMPEG ?? "ffmpeg";
  const videoCodec = options.videoCodec ?? "libx264";
  const syncOffsetMs = bundle.sync?.syncOffsetMs ?? 0;
  const syncRate = bundle.sync?.syncRate ?? 1;
  if (syncRate <= 0) throw new CliError("INVALID_ARGUMENT", "Bundle sync rate must be greater than zero.");
  runBinary(ffmpeg, ["-version"]);
  const videoPath = resolveBundlePath(absoluteBundle, video.path);
  const videoDurationSec = probeVideoDuration(videoPath, options.ffprobe);
  const telemetryPath = resolveBundlePath(absoluteBundle, bundle.telemetry.path);
  const loaded = loadTelemetry(telemetryPath);
  const spans = nativeLapSpans(loaded.data.samples);
  const coverage = videoCoverageMs(syncOffsetMs, videoDurationSec, syncRate);
  const sections = options.optSections ?? 10;
  const preRollSec = options.preRollSec ?? 5;
  const postRollSec = options.postRollSec ?? 5;
  if (!Number.isInteger(sections) || sections < 2 || sections > 50) throw new CliError("INVALID_ARGUMENT", "--opt-sections must be an integer from 2 to 50.");
  if (!Number.isFinite(preRollSec) || preRollSec < 0) throw new CliError("INVALID_ARGUMENT", "--pre-roll must be zero or greater.");
  if (!Number.isFinite(postRollSec) || postRollSec < 0) throw new CliError("INVALID_ARGUMENT", "--post-roll must be zero or greater.");
  const available = spans.filter((span) => isSpanAvailableForVideoClip(span, {
    videoDurationSec,
    preRollSec,
    postRollSec,
    syncOffsetMs,
    syncRate,
    coverage,
  }));
  const lapTiming = (span: NativeLapSpan) => span.officialTimeMs ?? span.durationMs;
  const fastestAvailable = available.reduce<NativeLapSpan | null>((best, span) => !best || lapTiming(span) < lapTiming(best) ? span : best, null);
  if (!fastestAvailable) throw new CliError("NO_COMPLETE_LAPS", "The video does not cover a complete, usable native iRacing lap.", 1);
  const chunks = makeOptChunks(loaded.data.samples, available, sections);
  const analysis = await analyzeBundle(absoluteBundle);
  mkdirSync(outputDirectory, { recursive: true });
  const base = basename(telemetryPath, ".ibt").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "session";
  const mementoPath = join(outputDirectory, `${base}-session-memento.png`);
  const optCompositePath = join(outputDirectory, `${base}-opt-composite-${timeText(chunks.reduce((sum, chunk) => sum + chunk.durationMs, 0)).replace(":", "m").replace(".", "s")}.mp4`);
  const fastestAvailablePath = join(outputDirectory, `${base}-fastest-available-lap-${timeText(lapTiming(fastestAvailable)).replace(":", "m").replace(".", "s")}.mp4`);
  const manifestPath = join(outputDirectory, "session-assets.json");
  const svg = mementoSvg(analysis.analytics, analysis.trackPoints);
  const svgPath = join(outputDirectory, `${base}-session-memento.svg`);
  await writeFile(svgPath, svg, "utf8");
  await rasterizeSvg(svg, svgPath, mementoPath);
  emitProgress("assets", "running", "Session memento is ready.", 0.1);
  const fastestClip = renderFastestAvailable({ ffmpeg, videoCodec, videoPath, outputPath: fastestAvailablePath, span: fastestAvailable, videoDurationSec, preRollSec, postRollSec, syncOffsetMs, syncRate });
  emitProgress("assets", "running", "Fastest complete lap is ready.", 0.4);
  renderOptComposite({ ffmpeg, videoCodec, videoPath, outputPath: optCompositePath, chunks, syncOffsetMs, syncRate });
  const report: SessionAssetReport = { schemaVersion: 1, command: "session render", outputDirectory, mementoPath, optCompositePath, fastestAvailablePath, manifestPath, fastestSession: { lap: analysis.analytics.fastestLapNumber, timeMs: analysis.analytics.fastestLapMs }, fastestAvailable, video: { path: videoPath, durationSec: videoDurationSec, syncOffsetMs, syncRate }, opt: { sections, estimatedDurationMs: chunks.reduce((sum, chunk) => sum + chunk.durationMs, 0), chunks } };
  writeJsonAtomic(manifestPath, { ...report, fastestAvailableClip: fastestClip, note: analysis.analytics.fastestLapNumber === fastestAvailable.lap ? "The global fastest lap is present in this video." : "The global fastest lap is outside video coverage; fastestAvailable is intentionally labelled separately." });
  return report;
}
