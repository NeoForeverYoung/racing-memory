export type GameCapability =
  | "telemetry.file"
  | "telemetry.live"
  | "telemetry.geo"
  | "telemetry.world"
  | "telemetry.track-progress"
  | "timing.game-laps"
  | "timing.geometry-laps"
  | "clock.session"
  | "race.position"
  | "race.class-position"
  | "race.incidents"
  | "race.pit"
  | "metadata.driver"
  | "metadata.vehicle"
  | "metadata.track";

export type SpatialSample =
  | { kind: "geo"; lat: number; lon: number; altitudeM?: number }
  | { kind: "world"; x: number; y: number; z?: number }
  | { kind: "track"; progress: number; distanceM?: number };

export interface TelemetryFrame {
  /** Milliseconds since the beginning of the captured session. */
  t: number;
  spatial?: SpatialSample;
  channels: Record<string, number>;
}

export interface LapTiming {
  number: number;
  startMs: number;
  endMs: number;
  timeMs: number;
  valid?: boolean;
  sectorsMs?: number[];
}

export interface CanonicalSessionMetadata {
  driver?: string;
  vehicle?: string;
  track?: string;
  course?: string;
  sessionType?: string;
  startedAt?: string;
}

export interface CanonicalSession {
  source: {
    game: string;
    format: string;
    adapterVersion?: string;
  };
  frames: TelemetryFrame[];
  laps?: LapTiming[];
  metadata?: CanonicalSessionMetadata;
  capabilities: GameCapability[];
  warnings?: string[];
}

export function hasCapability(
  session: Pick<CanonicalSession, "capabilities">,
  capability: GameCapability,
): boolean {
  return session.capabilities.includes(capability);
}

export function validateCanonicalSession(session: CanonicalSession): string[] {
  const errors: string[] = [];
  if (!session.source.game.trim()) errors.push("source.game must be non-empty.");
  if (!session.source.format.trim()) errors.push("source.format must be non-empty.");

  let previousTime = -Infinity;
  session.frames.forEach((frame, index) => {
    if (!Number.isFinite(frame.t) || frame.t < 0) {
      errors.push(`frames[${index}].t must be a non-negative finite number.`);
    }
    if (frame.t < previousTime) errors.push(`frames[${index}].t is before the previous frame.`);
    previousTime = frame.t;
    if (frame.spatial?.kind === "geo") {
      if (
        !Number.isFinite(frame.spatial.lat)
        || !Number.isFinite(frame.spatial.lon)
        || Math.abs(frame.spatial.lat) > 90
        || Math.abs(frame.spatial.lon) > 180
      ) {
        errors.push(`frames[${index}].spatial contains invalid coordinates.`);
      }
    } else if (frame.spatial?.kind === "track") {
      if (!Number.isFinite(frame.spatial.progress) || frame.spatial.progress < 0 || frame.spatial.progress > 1) {
        errors.push(`frames[${index}].spatial.progress must be between 0 and 1.`);
      }
    }
    for (const [channel, value] of Object.entries(frame.channels)) {
      if (!channel.trim() || !Number.isFinite(value)) {
        errors.push(`frames[${index}].channels contains an invalid value.`);
        break;
      }
    }
  });

  if (hasCapability(session, "telemetry.geo") && !session.frames.some((frame) => frame.spatial?.kind === "geo")) {
    errors.push("telemetry.geo capability requires at least one geo frame.");
  }
  if (hasCapability(session, "timing.game-laps") && !session.laps?.length) {
    errors.push("timing.game-laps capability requires lap timing.");
  }
  return errors;
}
