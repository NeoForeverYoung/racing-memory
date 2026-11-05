import type { CanonicalSession, TelemetryFrame } from "@lapwing/telemetry-core";
import type { GameAdapter, TelemetryInput } from "@lapwing/game-adapter-kit";
import {
  isIracingFormat,
  parseIracingFile,
  readIracingSessionMetadata,
} from "./iracingParser";
export { IbtDirectoryFinalizer } from "./ibtDirectoryFinalizer";
export { WindowsIracingSource } from "./windowsIracingSource";

function legacyToCanonical(input: ArrayBuffer): CanonicalSession {
  const parsed = parseIracingFile(input);
  const metadata = readIracingSessionMetadata(input);
  const frames: TelemetryFrame[] = parsed.samples.map((sample) => ({
    t: sample.t,
    spatial: { kind: "geo", lat: sample.lat, lon: sample.lon },
    channels: {
      speed_mps: sample.speedMps,
      ...(sample.heading == null ? {} : { heading_deg: sample.heading }),
      ...sample.extraFields,
    },
  }));
  return {
    source: { game: "iracing", format: "ibt" },
    capabilities: [
      "telemetry.file",
      "telemetry.live",
      "telemetry.geo",
      "telemetry.track-progress",
      "clock.session",
      "race.position",
      "race.class-position",
      "race.incidents",
      "race.pit",
      "metadata.driver",
      "metadata.vehicle",
      "metadata.track",
    ],
    frames,
    metadata,
  };
}

async function bytes(input: TelemetryInput): Promise<ArrayBuffer> {
  return input.arrayBuffer();
}

export const iracingAdapter: GameAdapter = {
  id: "iracing",
  displayName: "iRacing",
  capabilities: [
    "telemetry.file",
    "telemetry.live",
    "telemetry.geo",
    "telemetry.track-progress",
    "clock.session",
    "race.position",
    "race.class-position",
    "race.incidents",
    "race.pit",
    "metadata.driver",
    "metadata.vehicle",
    "metadata.track",
  ],
  async detectFile(input) {
    if (input.extension?.toLowerCase() === ".ibt") return true;
    return isIracingFormat(await bytes(input));
  },
  async parseFile(input) {
    return legacyToCanonical(await bytes(input));
  },
  async readMetadata(input) {
    return readIracingSessionMetadata(await bytes(input));
  },
};

export * from "./iracingParser";
export * from "./windowsIracingSource";
