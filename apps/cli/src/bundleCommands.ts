import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import type { SessionBundleV1 } from "@lapwing/telemetry-core";
import { probeVideoDuration } from "./core";
import {
  hashFile,
  readSessionBundle,
  resolveBundlePath,
  waitForStableFile,
  writeJsonAtomic,
} from "./jobStore";
import { CliError } from "./errors";

function inferGame(path: string): string {
  return path.toLowerCase().endsWith(".ibt") ? "iracing" : "unknown";
}

function isoFromMtime(path: string): string {
  return statSync(path).mtime.toISOString();
}

export async function createBundle(options: {
  telemetryPath: string;
  videoPaths: string[];
  outputPath: string;
  game?: string;
  stableMs?: number;
  timeoutMs?: number;
  ffprobe?: string;
}): Promise<SessionBundleV1> {
  const outputPath = resolve(options.outputPath);
  const baseDirectory = dirname(outputPath);
  const telemetryPath = resolve(options.telemetryPath);
  const videoPaths = options.videoPaths.map((path) => resolve(path));
  await Promise.all([telemetryPath, ...videoPaths].map((path) =>
    waitForStableFile(path, { stableMs: options.stableMs, timeoutMs: options.timeoutMs })
  ));

  const telemetryStat = statSync(telemetryPath);
  const bundle: SessionBundleV1 = {
    schemaVersion: 1,
    sessionId: randomUUID(),
    game: options.game ?? inferGame(telemetryPath),
    createdAt: new Date().toISOString(),
    telemetry: {
      path: relative(baseDirectory, telemetryPath) || telemetryPath,
      finalizedAt: isoFromMtime(telemetryPath),
      sizeBytes: telemetryStat.size,
      sha256: hashFile(telemetryPath),
    },
    videos: videoPaths.map((video) => {
      const stat = statSync(video);
      return {
        path: relative(baseDirectory, video) || video,
        finalizedAt: stat.mtime.toISOString(),
        startedAt: stat.birthtime.toISOString(),
        durationSec: probeVideoDuration(video, options.ffprobe),
        sizeBytes: stat.size,
        sha256: hashFile(video),
      };
    }),
    lifecycle: {},
    provenance: { producer: "lapwing-cli" },
  };
  writeJsonAtomic(outputPath, bundle);
  return bundle;
}

export function validateBundleFiles(bundlePath: string): {
  bundle: SessionBundleV1;
  files: Array<{ path: string; exists: boolean; hashMatches: boolean | null }>;
  valid: boolean;
} {
  const absoluteBundle = resolve(bundlePath);
  const bundle = readSessionBundle(absoluteBundle);
  const inputs = [bundle.telemetry, ...bundle.videos];
  const files = inputs.map((file) => {
    const path = resolveBundlePath(absoluteBundle, file.path);
    const exists = existsSync(path);
    const hashMatches = exists && file.sha256 ? hashFile(path) === file.sha256 : null;
    return { path, exists, hashMatches };
  });
  return {
    bundle,
    files,
    valid: files.every((file) => file.exists && file.hashMatches !== false),
  };
}

export function assertBundleFiles(bundlePath: string): ReturnType<typeof validateBundleFiles> {
  const result = validateBundleFiles(bundlePath);
  const missing = result.files.find((file) => !file.exists);
  if (missing) throw new CliError("FILE_NOT_FOUND", `Bundle input not found: ${missing.path}`, 1);
  const mismatched = result.files.find((file) => file.hashMatches === false);
  if (mismatched) throw new CliError("HASH_MISMATCH", `Bundle input changed: ${mismatched.path}`, 1);
  return result;
}
