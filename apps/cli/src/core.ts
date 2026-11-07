import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { parseDatalogContent } from "@/lib/datalogParser";
import { autoDetectCourse } from "@/lib/courseDetection";
import {
  detectMemoryHighlights,
} from "@/lib/racingMemoryHighlights";
import type { MemoryHighlight, MemoryHighlightKind } from "@lapwing/telemetry-core";
import { defaultTracksFromJson, type DefaultTracksJson } from "@/lib/trackStorage";
import { sessionMsToVideoSec } from "@lapwing/media";
import { CliError, fileError } from "./errors";
import type { Lap, ParsedData, Track } from "@/types/racing";
import { defaultCliAssets } from "./assets";

export interface LoadedTelemetry {
  absolutePath: string;
  format: string;
  data: ParsedData;
  laps: Lap[];
  lapSource: "track" | "waypoint" | "none";
  trackName: string | null;
  trackShortName: string | null;
  courseName: string | null;
  trackLayout: Array<{ lat: number; lon: number }> | null;
  highlights: MemoryHighlight[];
}

export interface InspectReport {
  schemaVersion: 1;
  command: "inspect";
  telemetry: {
    path: string;
    format: string;
    sampleCount: number;
    durationMs: number;
    startDate: string | null;
    bounds: ParsedData["bounds"];
    channels: Array<{ name: string; label?: string; unit?: string }>;
    parserStats: ParsedData["parserStats"] | null;
  };
  laps: {
    source: LoadedTelemetry["lapSource"];
    track: string | null;
    course: string | null;
    count: number;
    fastestLapMs: number | null;
  };
}

export interface MemoryDetectReport {
  schemaVersion: 1;
  command: "memory detect";
  telemetry: InspectReport["telemetry"];
  laps: InspectReport["laps"];
  highlights: MemoryHighlight[];
}

export interface RenderedClip {
  highlight: MemoryHighlight;
  outputPath: string | null;
  videoStartSec: number;
  videoEndSec: number;
  status: "rendered" | "outside-video";
}

export interface MemoryRenderReport extends Omit<MemoryDetectReport, "command"> {
  command: "memory render";
  video: {
    path: string;
    durationSec: number;
    syncOffsetMs: number;
    syncRate: number;
  };
  clips: RenderedClip[];
}

function bufferFromFile(path: string): ArrayBuffer {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch (error) {
    throw fileError(path, error);
  }
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** Read a `tracks.json`-shaped file (the bundled one by default) into Track[]. */
export function loadTracks(path = defaultCliAssets().tracksPath): Track[] {
  let json: DefaultTracksJson;
  try {
    json = JSON.parse(readFileSync(path, "utf8")) as DefaultTracksJson;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new CliError("PARSE_FAILED", `Invalid tracks JSON in ${path}: ${error.message}`, 1);
    }
    throw fileError(path, error);
  }
  return defaultTracksFromJson(json);
}

function sentinelTrack(data: ParsedData): Track[] {
  const first = data.samples[0];
  if (!first) return [];

  // With no tracks at all, autoDetectCourse returns null; a far-away sentinel
  // makes it fall through to its waypoint model instead.
  const farLat = first.lat >= 0 ? -89 : 89;
  const farLon = first.lon >= 0 ? -179 : 179;
  return [{
    name: "CLI waypoint sentinel",
    isUserDefined: false,
    courses: [{
      name: "CLI waypoint sentinel",
      startFinishA: { lat: farLat, lon: farLon },
      startFinishB: { lat: farLat + 0.00001, lon: farLon },
      isUserDefined: false,
    }],
  }];
}

export function loadTelemetry(inputPath: string, tracks: Track[] = loadTracks()): LoadedTelemetry {
  const absolutePath = resolve(inputPath);
  const buffer = bufferFromFile(absolutePath);
  let data: ParsedData;
  try {
    data = parseDatalogContent(buffer);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new CliError("PARSE_FAILED", `Could not parse ${absolutePath}: ${reason}`, 1);
  }
  // Same detection the app runs on import: nearest known track/course first,
  // waypoint mode when the session isn't at a known venue.
  const detection = autoDetectCourse(data.samples, tracks.length > 0 ? tracks : sentinelTrack(data));
  const laps = detection?.laps ?? [];
  const lapSource = laps.length === 0 ? "none" : detection?.isWaypointMode ? "waypoint" : "track";
  return {
    absolutePath,
    format: extname(absolutePath).slice(1).toLowerCase() || "unknown",
    data,
    laps,
    lapSource,
    trackName: lapSource === "track" ? detection!.track.name : null,
    trackShortName: lapSource === "track" ? detection!.track.shortName ?? null : null,
    courseName: lapSource === "track" ? detection!.course.name : null,
    trackLayout: lapSource === "track" ? detection!.course.layout ?? null : null,
    highlights: detectMemoryHighlights(data, laps),
  };
}

function fastestLapMs(laps: Lap[]): number | null {
  const ranked = laps.filter((lap) => !lap.incomplete && lap.lapTimeMs > 0);
  return ranked.length > 0 ? Math.min(...ranked.map((lap) => lap.lapTimeMs)) : null;
}

function telemetryReport(loaded: LoadedTelemetry): InspectReport["telemetry"] {
  return {
    path: loaded.absolutePath,
    format: loaded.format,
    sampleCount: loaded.data.samples.length,
    durationMs: loaded.data.duration,
    startDate: loaded.data.startDate?.toISOString() ?? null,
    bounds: loaded.data.bounds,
    channels: loaded.data.fieldMappings.map(({ name, label, unit }) => ({ name, label, unit })),
    parserStats: loaded.data.parserStats ?? null,
  };
}

function lapReport(loaded: LoadedTelemetry): InspectReport["laps"] {
  return {
    source: loaded.lapSource,
    track: loaded.trackName,
    course: loaded.courseName,
    count: loaded.laps.length,
    fastestLapMs: fastestLapMs(loaded.laps),
  };
}

export function createInspectReport(loaded: LoadedTelemetry): InspectReport {
  return {
    schemaVersion: 1,
    command: "inspect",
    telemetry: telemetryReport(loaded),
    laps: lapReport(loaded),
  };
}

export function createMemoryDetectReport(loaded: LoadedTelemetry): MemoryDetectReport {
  return {
    schemaVersion: 1,
    command: "memory detect",
    telemetry: telemetryReport(loaded),
    laps: lapReport(loaded),
    highlights: loaded.highlights,
  };
}

export function runBinary(binary: string, args: string[]): string {
  const result = spawnSync(binary, args, { encoding: "utf8" });
  if (result.error) {
    const missing = (result.error as NodeJS.ErrnoException).code === "ENOENT";
    throw new CliError(
      missing ? "BINARY_NOT_FOUND" : "BINARY_FAILED",
      `Unable to run ${binary}: ${result.error.message}`,
      1,
    );
  }
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`;
    throw new CliError("BINARY_FAILED", `${binary} failed: ${detail}`, 1);
  }
  return result.stdout;
}

export function probeVideoDuration(videoPath: string, ffprobe = process.env.RACING_MEMORY_FFPROBE ?? "ffprobe"): number {
  const output = runBinary(ffprobe, [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "json",
    resolve(videoPath),
  ]);
  const duration = Number((JSON.parse(output) as { format?: { duration?: string } }).format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new CliError("BINARY_FAILED", "ffprobe did not return a valid video duration.", 1);
  }
  return duration;
}

export function planHighlightClips(
  highlights: MemoryHighlight[],
  videoDurationSec: number,
  syncOffsetMs = 0,
  syncRate = 1,
  kinds?: Set<MemoryHighlightKind>,
): Array<Omit<RenderedClip, "outputPath" | "status">> {
  if (!Number.isFinite(syncRate) || syncRate <= 0) {
    throw new CliError("INVALID_ARGUMENT", "syncRate must be a positive finite number.");
  }
  return highlights
    .filter((highlight) => !kinds || kinds.has(highlight.kind))
    .map((highlight) => ({
      highlight,
      videoStartSec: Math.max(
        0,
        sessionMsToVideoSec(highlight.startMs, syncOffsetMs, syncRate),
      ),
      videoEndSec: Math.min(
        videoDurationSec,
        sessionMsToVideoSec(highlight.endMs, syncOffsetMs, syncRate),
      ),
    }));
}

function safeClipName(index: number, highlight: MemoryHighlight): string {
  const eventSeconds = Math.round(highlight.atMs / 1000);
  return `${String(index + 1).padStart(2, "0")}-${highlight.kind}-${eventSeconds}s.mp4`;
}

export function renderMemoryClips(options: {
  loaded: LoadedTelemetry;
  videoPath: string;
  outputDirectory: string;
  syncOffsetMs?: number;
  syncRate?: number;
  kinds?: Set<MemoryHighlightKind>;
  ffmpeg?: string;
  ffprobe?: string;
}): MemoryRenderReport {
  const videoPath = resolve(options.videoPath);
  const outputDirectory = resolve(options.outputDirectory);
  const syncOffsetMs = options.syncOffsetMs ?? 0;
  const syncRate = options.syncRate ?? 1;
  if (!Number.isFinite(syncRate) || syncRate <= 0) {
    throw new CliError("INVALID_ARGUMENT", "syncRate must be a positive finite number.");
  }
  // Fail before probing or creating directories if the encoder isn't runnable.
  runBinary(options.ffmpeg ?? process.env.RACING_MEMORY_FFMPEG ?? "ffmpeg", ["-version"]);
  const durationSec = probeVideoDuration(videoPath, options.ffprobe);
  const plans = planHighlightClips(
    options.loaded.highlights,
    durationSec,
    syncOffsetMs,
    syncRate,
    options.kinds,
  );
  mkdirSync(outputDirectory, { recursive: true });

  const clips: RenderedClip[] = plans.map((plan, index) => {
    if (plan.videoEndSec <= plan.videoStartSec) {
      return { ...plan, outputPath: null, status: "outside-video" };
    }

    const outputPath = resolve(outputDirectory, safeClipName(index, plan.highlight));
    runBinary(options.ffmpeg ?? process.env.RACING_MEMORY_FFMPEG ?? "ffmpeg", [
      "-v", "error",
      "-y",
      "-ss", plan.videoStartSec.toFixed(3),
      "-i", videoPath,
      "-t", (plan.videoEndSec - plan.videoStartSec).toFixed(3),
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "24",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "128k",
      "-movflags", "+faststart",
      outputPath,
    ]);
    return { ...plan, outputPath, status: "rendered" };
  });

  return {
    ...createMemoryDetectReport(options.loaded),
    command: "memory render",
    video: { path: videoPath, durationSec, syncOffsetMs, syncRate },
    clips,
  };
}
