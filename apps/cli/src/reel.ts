import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  planMemoryStory,
  sessionMsToVideoSec,
  videoCoverageMs,
  type MemoryStoryPlan,
} from "@lapwing/media";
import type { LoadedTelemetry } from "./core";
import { probeVideoDuration, runBinary } from "./core";
import { CliError } from "./errors";

export interface MemoryReelReport {
  schemaVersion: 1;
  command: "memory reel";
  outputPath: string;
  edlPath: string;
  videoPath: string;
  syncOffsetMs: number;
  syncRate: number;
  story: MemoryStoryPlan;
}

function concatPath(path: string): string {
  return path.replace(/'/g, "'\\''");
}

export function renderMemoryReel(options: {
  loaded: LoadedTelemetry;
  videoPath: string;
  outputPath: string;
  durationMs: number;
  syncOffsetMs?: number;
  syncRate?: number;
  ffmpeg?: string;
  ffprobe?: string;
}): MemoryReelReport {
  const ffmpeg = options.ffmpeg ?? "ffmpeg";
  runBinary(ffmpeg, ["-version"]);
  const videoPath = resolve(options.videoPath);
  const outputPath = resolve(options.outputPath);
  const syncOffsetMs = options.syncOffsetMs ?? 0;
  const syncRate = options.syncRate ?? 1;
  const videoDurationSec = probeVideoDuration(videoPath, options.ffprobe);
  const coverage = videoCoverageMs(syncOffsetMs, videoDurationSec, syncRate);
  const outsideVideo: MemoryStoryPlan["rejected"] = [];
  const availableHighlights = options.loaded.highlights.flatMap((highlight) => {
    const startMs = Math.max(highlight.startMs, coverage.startMs);
    const endMs = Math.min(highlight.endMs, coverage.endMs);
    if (endMs <= startMs) {
      outsideVideo.push({ highlightId: highlight.id, reason: "outside-video" });
      return [];
    }
    return [{
      ...highlight,
      startMs,
      endMs,
      atMs: Math.max(startMs, Math.min(endMs, highlight.atMs)),
    }];
  });
  const story = planMemoryStory(availableHighlights, options.durationMs);
  story.rejected.push(...outsideVideo);
  if (story.segments.length === 0) {
    throw new CliError("NO_HIGHLIGHTS", "No highlight segments are available for a reel.", 1);
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  const temporary = mkdtempSync(join(tmpdir(), "lapwing-reel-"));
  try {
    const clips = story.segments.flatMap((segment, index) => {
      const startSec = Math.max(0, sessionMsToVideoSec(segment.startMs, syncOffsetMs, syncRate));
      const endSec = Math.min(
        videoDurationSec,
        sessionMsToVideoSec(segment.endMs, syncOffsetMs, syncRate),
      );
      if (endSec <= startSec) return [];
      const clipPath = join(temporary, `${String(index).padStart(3, "0")}.mp4`);
      runBinary(ffmpeg, [
        "-v", "error", "-y",
        "-ss", startSec.toFixed(3),
        "-i", videoPath,
        "-t", (endSec - startSec).toFixed(3),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        clipPath,
      ]);
      return [clipPath];
    });
    if (clips.length === 0) {
      throw new CliError("SYNC_OUTSIDE_VIDEO", "Every selected highlight falls outside the video.", 1);
    }
    const concatFile = join(temporary, "concat.txt");
    writeFileSync(concatFile, clips.map((path) => `file '${concatPath(path)}'`).join("\n"));
    runBinary(ffmpeg, [
      "-v", "error", "-y",
      "-f", "concat", "-safe", "0", "-i", concatFile,
      "-c", "copy", "-movflags", "+faststart",
      outputPath,
    ]);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }

  const edlPath = `${outputPath}.edl.json`;
  writeFileSync(edlPath, `${JSON.stringify(story, null, 2)}\n`);
  return {
    schemaVersion: 1,
    command: "memory reel",
    outputPath,
    edlPath,
    videoPath,
    syncOffsetMs,
    syncRate,
    story,
  };
}
