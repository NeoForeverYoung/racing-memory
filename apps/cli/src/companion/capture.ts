import { resolve } from "node:path";
import type {
  AdapterTelemetryFinalizer as TelemetryFinalizer,
  CanonicalRaceState,
  CompanionEvent,
  GameSource,
} from "@lapwing/game-adapter-kit";
import {
  fitVideoTimeline,
  type RecorderProvider,
  type RecorderStartResult,
  type RecorderStopResult,
} from "@lapwing/media";
import { createBundle } from "../bundleCommands";
import { readSessionBundle, waitForStableFile, writeJsonAtomic } from "../jobStore";

export interface CaptureOptions {
  outputBundle: string;
  stableWindowMs?: number;
  onEvent?: (event: CompanionEvent) => void;
}
export async function runCaptureSession(
  game: GameSource,
  recorder: RecorderProvider,
  telemetry: TelemetryFinalizer,
  options: CaptureOptions,
): Promise<string> {
  let joined: CanonicalRaceState | undefined;
  let green: CanonicalRaceState | undefined;
  let finished: CanonicalRaceState | undefined;
  let recordingStarted: RecorderStartResult | undefined;
  let recordingStopped: RecorderStopResult | undefined;
  for await (const race of game.events()) {
    options.onEvent?.({ version: 1, event: "race.lifecycle", race });
    joined ??= race;
    if (race.state === "green" && !recordingStarted) {
      green = race;
      recordingStarted = await recorder.start(race);
      options.onEvent?.({ version: 1, event: "recording.started", race });
    }
    if (race.state === "finished") {
      finished = race;
      if (!recordingStarted) {
        green = race;
        recordingStarted = await recorder.start(race);
      }
      recordingStopped = await recorder.stop(race);
      options.onEvent?.({ version: 1, event: "recording.stopped", path: recordingStopped.path, race });
      break;
    }
  }
  if (!joined || !green || !finished || !recordingStarted || !recordingStopped) {
    throw new Error("Capture source ended before a complete race lifecycle was observed");
  }

  const telemetryPath = await telemetry.waitForTelemetry(finished);
  const stableWindowMs = options.stableWindowMs ?? 2_000;
  await Promise.all([
    waitForStableFile(telemetryPath, { stableMs: stableWindowMs }),
    waitForStableFile(recordingStopped.path, { stableMs: stableWindowMs }),
  ]);
  options.onEvent?.({
    version: 1,
    event: "telemetry.finalized",
    path: telemetryPath,
    finalizedAt: new Date().toISOString(),
  });
  await createBundle({
    telemetryPath,
    videoPaths: [recordingStopped.path],
    outputPath: options.outputBundle,
    game: game.id,
    stableMs: stableWindowMs,
  });
  const bundle = await readSessionBundle(options.outputBundle);
  const endVideoSec = bundle.videos[0]?.durationSec ?? Math.max(
    0,
    ((finished.sessionTimeSeconds ?? 0) - (green.sessionTimeSeconds ?? 0)),
  );
  const startAckDelayMs = Math.max(
    0,
    Date.parse(recordingStarted.acknowledgedAt) - Date.parse(green.wallClock),
  );
  const anchors = [
    {
      sessionMs: (green.sessionTimeSeconds ?? 0) * 1000 + startAckDelayMs,
      videoSec: 0,
      source: "companion-start" as const,
      wallClock: recordingStarted.acknowledgedAt,
    },
    {
      sessionMs: (finished.sessionTimeSeconds ?? 0) * 1000,
      videoSec: endVideoSec,
      source: "companion-stop" as const,
      wallClock: recordingStopped.acknowledgedAt,
    },
  ];
  const fit = fitVideoTimeline(anchors[0], [anchors[1]]);
  const sessionSpanSec = Math.max(0, (anchors[1].sessionMs - anchors[0].sessionMs) / 1_000);
  const observedRate = sessionSpanSec > 0 ? endVideoSec / sessionSpanSec : 1;
  const plausibleClockRate = observedRate >= 0.5 && observedRate <= 2;
  bundle.sessionId = finished.sessionId;
  bundle.game = finished.game;
  bundle.lifecycle = {
    joinedAt: joined.wallClock,
    greenAt: green.wallClock,
    finishedAt: finished.wallClock,
  };
  bundle.metadata = {
    driver: finished.driver ?? green.driver,
    vehicle: finished.vehicle ?? green.vehicle,
    track: finished.track ?? green.track,
    course: finished.course ?? green.course,
    sessionType: finished.sessionType ?? green.sessionType,
  };
  bundle.sync = {
    ...fit,
    confidence: plausibleClockRate ? "high" : "low",
    evidence: [
      "OBS start and stop acknowledgements paired with iRacing SessionTime.",
      ...(!plausibleClockRate ? [`Observed video/session rate ${observedRate.toFixed(3)} is implausible.`] : []),
    ],
    requiresReview: !plausibleClockRate,
    anchors,
  };
  bundle.provenance = {
    producer: "lapwing-windows-companion",
    captureConfig: `${game.id}+${recorder.id}`,
  };
  await writeJsonAtomic(options.outputBundle, bundle);
  options.onEvent?.({
    version: 1,
    event: "bundle.created",
    path: resolve(options.outputBundle),
    sessionId: bundle.sessionId,
  });
  return resolve(options.outputBundle);
}
