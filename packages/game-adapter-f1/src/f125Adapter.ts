import type { CanonicalSession, LapTiming, TelemetryFrame } from "@lapwing/telemetry-core";
import type { GameAdapter, TelemetryInput } from "@lapwing/game-adapter-kit";
import { decodeF1UdpCapture } from "./capture";
import { decodeF125Packet, type F125Packet } from "./protocol/f125";

interface MutableFrame {
  t: number;
  world?: { x: number; y: number; z: number };
  channels: Record<string, number>;
}

/** Replays a raw F1 25 capture into only the canonical fields proven by its packets. */
export function parseF125Capture(input: ArrayBuffer | Uint8Array): CanonicalSession {
  const datagrams = decodeF1UdpCapture(input);
  const frames = new Map<number, MutableFrame>();
  const warnings: string[] = [];
  const laps: LapTiming[] = [];
  let startedAt: number | undefined;
  let driver: string | undefined;
  let trackLengthM: number | undefined;
  let lastCompletedLap = 0;

  for (const datagram of datagrams) {
    try {
      const packet = decodeF125Packet(datagram.bytes);
      startedAt ??= datagram.receivedAtMs;
      const frame = frameFor(frames, packet, datagram.receivedAtMs - startedAt);
      if (packet.kind === "motion") {
        frame.world = packet.world;
        Object.assign(frame.channels, {
          velocity_x_mps: packet.velocity.x,
          velocity_y_mps: packet.velocity.y,
          velocity_z_mps: packet.velocity.z,
          g_lateral: packet.gForce.lateral,
          g_longitudinal: packet.gForce.longitudinal,
          g_vertical: packet.gForce.vertical,
        });
      } else if (packet.kind === "telemetry") {
        Object.assign(frame.channels, {
          speed_mps: packet.speedKph / 3.6,
          rpm: packet.rpm,
          gear: packet.gear,
          throttle: packet.throttle,
          brake: packet.brake,
          steering: packet.steering,
          drs: packet.drs ? 1 : 0,
        });
      } else if (packet.kind === "session") {
        trackLengthM = packet.trackLengthM || trackLengthM;
        Object.assign(frame.channels, { track_length_m: packet.trackLengthM, weather_code: packet.weather });
      } else if (packet.kind === "lap") {
        const progress = trackLengthM && packet.lapDistanceM >= 0 ? packet.lapDistanceM / trackLengthM : undefined;
        Object.assign(frame.channels, {
          lap_distance_m: packet.lapDistanceM,
          total_distance_m: packet.totalDistanceM,
          race_position: packet.carPosition,
          current_lap: packet.currentLap,
          pit_status: packet.pitStatus,
          sector: packet.sector,
          penalties_s: packet.penaltiesS,
          ...(progress != null && progress >= 0 && progress <= 1 ? { track_progress: progress } : {}),
        });
        if (packet.currentLap > lastCompletedLap && packet.lastLapTimeMs > 0 && packet.lastLapTimeMs < frame.t) {
          laps.push({ number: packet.currentLap - 1, startMs: frame.t - packet.lastLapTimeMs, endMs: frame.t, timeMs: packet.lastLapTimeMs, valid: !packet.currentLapInvalid });
          lastCompletedLap = packet.currentLap;
        }
      } else if (packet.kind === "participants") {
        driver = packet.player.name || driver;
      }
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error));
    }
  }

  const canonicalFrames: TelemetryFrame[] = [...frames.values()]
    .sort((a, b) => a.t - b.t)
    .filter((frame) => Object.keys(frame.channels).length > 0 || frame.world != null)
    .map((frame) => ({ t: frame.t, ...(frame.world ? { spatial: { kind: "world" as const, ...frame.world } } : {}), channels: frame.channels }));

  return {
    source: { game: "EA SPORTS F1 25", format: "f1udp/2025" },
    capabilities: ["telemetry.file", "telemetry.world", "telemetry.track-progress", "race.position", "race.pit", ...(laps.length ? ["timing.game-laps" as const] : []), ...(driver ? ["metadata.driver" as const] : [])],
    frames: canonicalFrames,
    ...(laps.length ? { laps } : {}),
    ...(driver ? { metadata: { driver } } : {}),
    ...(warnings.length ? { warnings } : {}),
  };
}

function frameFor(frames: Map<number, MutableFrame>, packet: F125Packet, t: number): MutableFrame {
  const key = packet.header.overallFrameIdentifier;
  const found = frames.get(key);
  if (found) return found;
  const frame = { t, channels: {} };
  frames.set(key, frame);
  return frame;
}

export const f125Adapter: GameAdapter = {
  id: "f1-25",
  displayName: "EA SPORTS F1 25 (UDP)",
  capabilities: ["telemetry.file", "telemetry.live", "telemetry.world", "telemetry.track-progress", "timing.game-laps", "race.position", "race.pit", "metadata.driver"],
  detectFile(input) { return input.extension?.toLowerCase() === ".f1udp"; },
  async parseFile(input: TelemetryInput) { return parseF125Capture(await input.arrayBuffer()); },
};
