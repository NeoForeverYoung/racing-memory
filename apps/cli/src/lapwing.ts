#!/usr/bin/env bun

import { existsSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import packageJson from "../../../package.json";
import { suggestSessionSync } from "@/lib/syncSuggestion";
import { numberOption, parseArguments, type CommandSpec, type ParsedArguments } from "./args";
import { createBundle, validateBundleFiles } from "./bundleCommands";
import {
  createInspectReport,
  createMemoryDetectReport,
  loadTelemetry,
  loadTracks,
  renderMemoryClips,
} from "./core";
import { parseDurationSeconds } from "./duration";
import { CliError, fileError } from "./errors";
import { createSyntheticIbt } from "@lapwing/game-adapter-iracing/fixture";
import { createDefaultJob, writeJsonAtomic } from "./jobStore";
import { readSessionBundle, resolveBundlePath } from "./jobStore";
import { renderMemoryReel } from "./reel";
import type { MemoryHighlightKind } from "@lapwing/telemetry-core";
import { analyzeBundle, defaultReportDirectory, renderReport } from "./report";
import { generateBundleInsights } from "./insights";
import { runPipeline } from "./pipelineRunner";
import { createPipelineHandlers } from "./pipelineHandlers";
import { captureWatch } from "./captureCommand";
import { renderSessionAssets } from "./sessionAssets";

const MEMORY_KINDS = new Set<MemoryHighlightKind>([
  "best_lap",
  "overtake",
  "incident",
  "finish",
]);

const COMMON_VALUE_FLAGS = ["report"] as const;
const COMMON_BOOLEAN_FLAGS = ["compact"] as const;

const SPECS = {
  inspect: { positionals: 1, valueFlags: [...COMMON_VALUE_FLAGS, "tracks"], booleanFlags: COMMON_BOOLEAN_FLAGS },
  "bundle create": {
    positionals: 2,
    valueFlags: [...COMMON_VALUE_FLAGS, "output", "job", "game", "stable-ms", "timeout-ms", "ffprobe"],
    booleanFlags: COMMON_BOOLEAN_FLAGS,
  },
  "bundle validate": { positionals: 1, valueFlags: COMMON_VALUE_FLAGS, booleanFlags: COMMON_BOOLEAN_FLAGS },
  "sync suggest": {
    positionals: 1,
    valueFlags: [...COMMON_VALUE_FLAGS, "tracks"],
    booleanFlags: COMMON_BOOLEAN_FLAGS,
  },
  analyze: { positionals: 1, valueFlags: COMMON_VALUE_FLAGS, booleanFlags: COMMON_BOOLEAN_FLAGS },
  "report render": {
    positionals: 1,
    valueFlags: [...COMMON_VALUE_FLAGS, "output", "images"],
    booleanFlags: COMMON_BOOLEAN_FLAGS,
  },
  "session render": {
    positionals: 1,
    valueFlags: [...COMMON_VALUE_FLAGS, "output", "ffmpeg", "ffprobe", "video-codec", "pre-roll", "post-roll", "opt-sections"],
    booleanFlags: COMMON_BOOLEAN_FLAGS,
  },
  "coach insights": { positionals: 1, valueFlags: COMMON_VALUE_FLAGS, booleanFlags: COMMON_BOOLEAN_FLAGS },
  run: {
    positionals: 1,
    valueFlags: [...COMMON_VALUE_FLAGS, "from"],
    booleanFlags: [...COMMON_BOOLEAN_FLAGS, "resume", "dry-run"],
  },
  "capture watch": {
    positionals: 0,
    valueFlags: [
      ...COMMON_VALUE_FLAGS,
      "provider",
      "output",
      "telemetry",
      "video",
      "events",
      "telemetry-directory",
      "obs-url",
      "obs-password-env",
      "stable-ms",
    ],
    booleanFlags: COMMON_BOOLEAN_FLAGS,
  },
  "memory detect": { positionals: 1, valueFlags: [...COMMON_VALUE_FLAGS, "tracks"], booleanFlags: COMMON_BOOLEAN_FLAGS },
  "memory reel": {
    positionals: 1,
    valueFlags: [...COMMON_VALUE_FLAGS, "tracks", "output", "duration", "ffmpeg", "ffprobe"],
    booleanFlags: [...COMMON_BOOLEAN_FLAGS, "accept-low-confidence"],
  },
  "memory render": {
    positionals: 2,
    valueFlags: [...COMMON_VALUE_FLAGS, "tracks", "output", "kind", "sync-offset-ms", "sync-rate", "ffmpeg", "ffprobe"],
    booleanFlags: COMMON_BOOLEAN_FLAGS,
  },
  "fixture ibt": {
    positionals: 0,
    valueFlags: [...COMMON_VALUE_FLAGS, "output", "duration", "tick-rate", "lap-duration"],
    booleanFlags: COMMON_BOOLEAN_FLAGS,
  },
} satisfies Record<string, CommandSpec>;

type CommandName = keyof typeof SPECS;

function parseKinds(raw?: string): Set<MemoryHighlightKind> | undefined {
  if (!raw || raw === "all") return undefined;
  const kinds = new Set<MemoryHighlightKind>();
  for (const value of raw.split(",")) {
    if (!MEMORY_KINDS.has(value as MemoryHighlightKind)) {
      throw new CliError("INVALID_KIND", `Unknown memory kind: ${value}`);
    }
    kinds.add(value as MemoryHighlightKind);
  }
  return kinds;
}

/** Re-throw a pure-module validation error as a usage error (exit 2). */
function asArgumentError<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError("INVALID_ARGUMENT", error instanceof Error ? error.message : String(error));
  }
}

function serialize(value: unknown, compact: boolean): string {
  return `${JSON.stringify(value, null, compact ? undefined : 2)}\n`;
}

/** Check a --report target up front so a slow render is never wasted on a bad path. */
function reportPath(parsed: ParsedArguments): string | undefined {
  const raw = parsed.values.get("report");
  if (!raw) return undefined;
  const path = resolve(raw);
  if (!existsSync(dirname(path))) {
    throw new CliError("INVALID_ARGUMENT", `--report directory does not exist: ${dirname(path)}`);
  }
  return path;
}

function emit(parsed: ParsedArguments, report: unknown, path: string | undefined): void {
  const compact = parsed.flags.has("compact");
  const text = serialize(report, compact);
  process.stdout.write(text);
  if (!path) return;
  try {
    writeFileSync(path, text);
  } catch (error) {
    throw fileError(path, error);
  }
}

function tracksFor(parsed: ParsedArguments) {
  const path = parsed.values.get("tracks");
  return path ? loadTracks(resolve(path)) : loadTracks();
}

function usage(): string {
  return `LapWing headless CLI ${packageJson.version}

Usage:
  lapwing inspect <telemetry>
  lapwing bundle create <telemetry> <video> --output <session.bundle.json>
  lapwing bundle validate <session.bundle.json>
  lapwing sync suggest <session.bundle.json>
  lapwing analyze <session.bundle.json>
  lapwing memory detect <telemetry>
  lapwing memory reel <session.bundle.json> --duration 60s --output <reel.mp4>
  lapwing memory render <telemetry> <video> --output <directory>
  lapwing report render <session.bundle.json> --images 4 --output <directory>
  lapwing session render <session.bundle.json> --output <directory>
  lapwing coach insights <session.bundle.json>
  lapwing run <job.json> [--resume] [--from <step>] [--dry-run]
  lapwing capture watch --provider mock --telemetry <file.ibt> --video <file.mp4> --output <bundle.json>
  lapwing fixture ibt --duration <30s|8m|1h> --output <file.ibt>
  lapwing version

Common options:
  --compact                 Emit compact JSON
  --report <path>           Also write the JSON report to a file
  --tracks <tracks.json>    Track database for lap detection
                            (default: the bundled public/tracks.json)

memory render options:
  --kind <all|kind,...>     best_lap,overtake,incident,finish
  --sync-offset-ms <ms>     Session time aligned with video time zero
  --sync-rate <ratio>       Video/session clock ratio (default 1)
  --ffmpeg <binary>         FFmpeg executable (default ffmpeg)
  --ffprobe <binary>        ffprobe executable (default ffprobe)
  --video-codec <codec>     FFmpeg video codec (default libx264; macOS h264_videotoolbox is faster)

session render options:
  --output <directory>      New directory for memento + deterministic video edits
  --pre-roll <seconds>      Lead-in before the fastest available lap (default 5)
  --post-roll <seconds>     Tail after the fastest available lap (default 5)
  --opt-sections <count>    OPT composition sections, 2-50 (default 10)
  --ffmpeg <binary>         FFmpeg executable (default ffmpeg)
  --ffprobe <binary>        ffprobe executable (default ffprobe)

fixture ibt options:
  --tick-rate <hz>          Integer samples per second, 1-60 (default 10)
  --lap-duration <seconds>  Synthetic lap length, >= 5 (default scales with duration)

Exit codes: 0 success, 2 usage/argument error, 1 runtime failure.
Errors are one JSON document on stderr: {"schemaVersion":1,"error":{"code","message"}}.
`;
}

async function main(argv: string[]): Promise<void> {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(usage());
    return;
  }
  if (argv[0] === "version" || argv[0] === "--version") {
    process.stdout.write(serialize({ schemaVersion: 1, command: "version", version: packageJson.version }, true));
    return;
  }

  const singleWord = argv[0] === "inspect" || argv[0] === "analyze" || argv[0] === "run";
  const name = (singleWord ? argv[0] : `${argv[0]} ${argv[1] ?? ""}`) as CommandName;
  if (!(name in SPECS)) {
    throw new CliError("UNKNOWN_COMMAND", `Unknown command: ${argv.slice(0, 2).join(" ")}`);
  }
  const parsed = parseArguments(argv.slice(singleWord ? 1 : 2), SPECS[name]);
  const report = reportPath(parsed);

  if (name === "bundle create") {
    const [telemetry, video] = parsed.positional;
    const output = parsed.values.get("output");
    if (!telemetry || !video || !output) {
      throw new CliError("MISSING_INPUT", "bundle create requires telemetry, video, and --output.");
    }
    const bundle = await createBundle({
      telemetryPath: telemetry,
      videoPaths: [video],
      outputPath: output,
      game: parsed.values.get("game"),
      stableMs: numberOption(parsed, "stable-ms"),
      timeoutMs: numberOption(parsed, "timeout-ms"),
      ffprobe: parsed.values.get("ffprobe"),
    });
    const jobPath = parsed.values.get("job");
    if (jobPath) {
      const job = createDefaultJob({
        bundlePath: resolve(output),
        outputDirectory: resolve(dirname(resolve(jobPath)), "output"),
      });
      writeJsonAtomic(jobPath, job);
    }
    emit(parsed, { schemaVersion: 1, command: name, bundle, jobPath: jobPath ? resolve(jobPath) : null }, report);
    return;
  }

  if (name === "bundle validate") {
    const bundle = parsed.positional[0];
    if (!bundle) throw new CliError("MISSING_INPUT", "bundle validate requires a session bundle.");
    const result = validateBundleFiles(bundle);
    emit(parsed, { schemaVersion: 1, command: name, ...result }, report);
    if (!result.valid) process.exitCode = 1;
    return;
  }

  if (name === "sync suggest") {
    const bundlePath = parsed.positional[0];
    if (!bundlePath) throw new CliError("MISSING_INPUT", "sync suggest requires a session bundle.");
    const bundle = readSessionBundle(resolve(bundlePath));
    const loaded = loadTelemetry(resolveBundlePath(resolve(bundlePath), bundle.telemetry.path), tracksFor(parsed));
    const suggestion = suggestSessionSync(bundle, loaded.data);
    emit(parsed, { schemaVersion: 1, command: name, suggestion }, report);
    return;
  }

  if (name === "analyze") {
    const bundlePath = parsed.positional[0];
    if (!bundlePath) throw new CliError("MISSING_INPUT", "analyze requires a session bundle.");
    const analysis = await analyzeBundle(bundlePath);
    emit(parsed, { schemaVersion: 1, command: name, analytics: analysis.analytics }, report);
    return;
  }

  if (name === "report render") {
    const bundlePath = parsed.positional[0];
    if (!bundlePath) throw new CliError("MISSING_INPUT", "report render requires a session bundle.");
    const images = numberOption(parsed, "images", 4);
    if (!Number.isInteger(images) || images < 0 || images > 100) {
      throw new CliError("INVALID_ARGUMENT", "--images must be an integer between 0 and 100.");
    }
    const output = parsed.values.get("output") ?? defaultReportDirectory(bundlePath);
    emit(parsed, {
      schemaVersion: 1,
      command: name,
      ...(await renderReport(bundlePath, output, images)),
    }, report);
    return;
  }

  if (name === "session render") {
    const bundlePath = parsed.positional[0];
    const output = parsed.values.get("output");
    if (!bundlePath || !output) throw new CliError("MISSING_INPUT", "session render requires a bundle and --output <directory>.");
    emit(parsed, await renderSessionAssets({
      bundlePath,
      outputDirectory: output,
      ffmpeg: parsed.values.get("ffmpeg"),
      ffprobe: parsed.values.get("ffprobe"),
      videoCodec: parsed.values.get("video-codec"),
      preRollSec: numberOption(parsed, "pre-roll", 5),
      postRollSec: numberOption(parsed, "post-roll", 5),
      optSections: numberOption(parsed, "opt-sections", 10),
    }), report);
    return;
  }

  if (name === "coach insights") {
    const bundlePath = parsed.positional[0];
    if (!bundlePath) throw new CliError("MISSING_INPUT", "coach insights requires a session bundle.");
    emit(parsed, {
      schemaVersion: 1,
      command: name,
      ...(await generateBundleInsights(bundlePath)),
    }, report);
    return;
  }

  if (name === "run") {
    const manifestPath = parsed.positional[0];
    if (!manifestPath) throw new CliError("MISSING_INPUT", "run requires a job manifest.");
    const manifest = await runPipeline({
      manifestPath,
      handlers: createPipelineHandlers(),
      resume: parsed.flags.has("resume"),
      fromStep: parsed.values.get("from"),
      dryRun: parsed.flags.has("dry-run"),
    });
    emit(parsed, { schemaVersion: 1, command: name, dryRun: parsed.flags.has("dry-run"), manifest }, report);
    return;
  }

  if (name === "capture watch") {
    const provider = parsed.values.get("provider") ?? "mock";
    if (provider !== "mock" && provider !== "iracing" && provider !== "iracing-jsonl") {
      throw new CliError("INVALID_ARGUMENT", "--provider must be mock, iracing, or iracing-jsonl.");
    }
    const output = parsed.values.get("output");
    if (!output) throw new CliError("MISSING_OUTPUT", "capture watch requires --output <bundle.json>.");
    const result = await captureWatch({
      provider,
      output,
      telemetry: parsed.values.get("telemetry"),
      video: parsed.values.get("video"),
      events: parsed.values.get("events"),
      telemetryDirectory: parsed.values.get("telemetry-directory"),
      obsUrl: parsed.values.get("obs-url"),
      obsPasswordEnv: parsed.values.get("obs-password-env"),
      stableWindowMs: numberOption(parsed, "stable-ms"),
    });
    emit(parsed, { schemaVersion: 1, command: name, ...result }, report);
    return;
  }

  if (name === "memory reel") {
    const bundlePath = parsed.positional[0];
    const output = parsed.values.get("output");
    if (!bundlePath || !output) {
      throw new CliError("MISSING_INPUT", "memory reel requires a bundle and --output <reel.mp4>.");
    }
    const absoluteBundle = resolve(bundlePath);
    const bundle = readSessionBundle(absoluteBundle);
    const video = bundle.videos[0];
    if (!video) throw new CliError("MISSING_INPUT", "The session bundle has no video.", 1);
    const loaded = loadTelemetry(resolveBundlePath(absoluteBundle, bundle.telemetry.path), tracksFor(parsed));
    const suggestion = suggestSessionSync(bundle, loaded.data);
    if (suggestion.confidence === "low" && !parsed.flags.has("accept-low-confidence")) {
      throw new CliError(
        "SYNC_LOW_CONFIDENCE",
        "Synchronization confidence is low; review it or pass --accept-low-confidence.",
        1,
      );
    }
    const reel = renderMemoryReel({
      loaded,
      videoPath: resolveBundlePath(absoluteBundle, video.path),
      outputPath: output,
      durationMs: parseDurationSeconds(parsed.values.get("duration") ?? "60s") * 1_000,
      syncOffsetMs: suggestion.syncOffsetMs,
      syncRate: suggestion.syncRate,
      ffmpeg: parsed.values.get("ffmpeg"),
      ffprobe: parsed.values.get("ffprobe"),
    });
    emit(parsed, { ...reel, sync: suggestion }, report);
    return;
  }

  if (name === "inspect" || name === "memory detect") {
    const telemetry = parsed.positional[0];
    if (!telemetry) throw new CliError("MISSING_INPUT", `${name} requires a telemetry file.`);
    const loaded = loadTelemetry(telemetry, tracksFor(parsed));
    emit(parsed, name === "inspect" ? createInspectReport(loaded) : createMemoryDetectReport(loaded), report);
    return;
  }

  if (name === "memory render") {
    const [telemetry, video] = parsed.positional;
    const output = parsed.values.get("output");
    if (!telemetry || !video || !output) {
      throw new CliError(
        "MISSING_INPUT",
        "memory render requires telemetry, video, and --output <directory>.",
      );
    }
    const syncOffsetMs = numberOption(parsed, "sync-offset-ms", 0);
    const syncRate = numberOption(parsed, "sync-rate", 1);
    if (syncRate <= 0) throw new CliError("INVALID_ARGUMENT", "--sync-rate must be greater than 0.");
    const kinds = parseKinds(parsed.values.get("kind"));
    emit(parsed, renderMemoryClips({
      loaded: loadTelemetry(telemetry, tracksFor(parsed)),
      videoPath: video,
      outputDirectory: output,
      syncOffsetMs,
      syncRate,
      kinds,
      ffmpeg: parsed.values.get("ffmpeg"),
      ffprobe: parsed.values.get("ffprobe"),
    }), report);
    return;
  }

  // fixture ibt
  const output = parsed.values.get("output");
  if (!output) throw new CliError("MISSING_OUTPUT", "fixture ibt requires --output <file.ibt>.");
  const fixture = asArgumentError(() => createSyntheticIbt({
    durationSec: parseDurationSeconds(parsed.values.get("duration") ?? "8m"),
    tickRate: numberOption(parsed, "tick-rate", 10),
    lapDurationSec: numberOption(parsed, "lap-duration"),
  }));
  const outputPath = resolve(output);
  try {
    writeFileSync(outputPath, fixture.bytes);
  } catch (error) {
    throw fileError(outputPath, error);
  }
  emit(parsed, {
    schemaVersion: 1,
    command: "fixture ibt",
    outputPath,
    bytes: fixture.bytes.byteLength,
    events: fixture.events,
  }, report);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const known = error instanceof CliError;
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({
    schemaVersion: 1,
    error: {
      code: known ? error.code : "COMMAND_FAILED",
      message,
    },
  })}\n`);
  process.exitCode = known ? error.exitCode : 1;
});
