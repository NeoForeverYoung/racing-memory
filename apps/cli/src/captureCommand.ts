import { resolve } from "node:path";
import { encodeCompanionMessage, type CompanionEvent } from "@lapwing/game-adapter-kit";
import { IbtDirectoryFinalizer } from "@lapwing/game-adapter-iracing/ibt-finalizer";
import { runCaptureSession } from "./companion/capture";
import { JsonlGameSource } from "./companion/jsonlGameSource";
import { FixedTelemetryFinalizer, MockIracingSource, MockRecorder } from "./companion/mock";
import { ObsWebSocketRecorder } from "@lapwing/windows-companion/obs";
import { CliError } from "./errors";

export interface CaptureWatchOptions {
  provider: "mock" | "iracing" | "iracing-jsonl";
  output: string;
  telemetry?: string;
  video?: string;
  events?: string;
  telemetryDirectory?: string;
  obsUrl?: string;
  obsPasswordEnv?: string;
  stableWindowMs?: number;
}

function emit(event: CompanionEvent): void {
  process.stderr.write(encodeCompanionMessage(event));
}

async function captureWatchInternal(options: CaptureWatchOptions): Promise<{ bundle: string }> {
  if (options.provider === "mock") {
    if (!options.telemetry || !options.video) {
      throw new Error("mock capture requires --telemetry and --video");
    }
    const bundle = await runCaptureSession(
      new MockIracingSource(),
      new MockRecorder(resolve(options.video)),
      new FixedTelemetryFinalizer(resolve(options.telemetry)),
      {
        outputBundle: resolve(options.output),
        stableWindowMs: options.stableWindowMs,
        onEvent: emit,
      },
    );
    return { bundle };
  }

  if (process.platform !== "win32") {
    throw new Error("The iRacing + OBS capture providers are Windows-only; use --provider mock for CI.");
  }
  if (!options.telemetryDirectory) {
    throw new Error(`${options.provider} capture requires --telemetry-directory`);
  }
  if (options.provider === "iracing-jsonl" && !options.events) {
    throw new Error("iracing-jsonl capture requires --events");
  }
  const gameSource = options.provider === "iracing"
    ? new (await import("@lapwing/game-adapter-iracing/windows-source")).WindowsIracingSource()
    : new JsonlGameSource(resolve(options.events!));
  const password = process.env[options.obsPasswordEnv ?? "OBS_WEBSOCKET_PASSWORD"] ?? "";
  const bundle = await runCaptureSession(
    gameSource,
    new ObsWebSocketRecorder(options.obsUrl, password),
    new IbtDirectoryFinalizer(resolve(options.telemetryDirectory)),
    {
      outputBundle: resolve(options.output),
      stableWindowMs: options.stableWindowMs,
      onEvent: emit,
    },
  );
  return { bundle };
}

export async function captureWatch(options: CaptureWatchOptions): Promise<{ bundle: string }> {
  try {
    return await captureWatchInternal(options);
  } catch (error) {
    emit({
      version: 1,
      event: "companion.error",
      code: error instanceof CliError ? error.code : "CAPTURE_FAILED",
      message: error instanceof Error ? error.message : String(error),
      recoverable: error instanceof CliError && error.code === "WATCH_TIMEOUT",
    });
    throw error;
  }
}
