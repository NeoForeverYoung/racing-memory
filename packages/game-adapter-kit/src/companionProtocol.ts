export const COMPANION_PROTOCOL_VERSION = 1 as const;

export type RaceLifecycleState = "connecting" | "live" | "green" | "finished";

export interface CanonicalRaceState {
  game: string;
  state: RaceLifecycleState;
  sessionId: string;
  sessionTimeSeconds?: number;
  wallClock: string;
  monotonicMs: number;
  driver?: string;
  vehicle?: string;
  track?: string;
  course?: string;
  sessionType?: string;
  racePosition?: number;
  classPosition?: number;
  incidents?: number;
  onPitRoad?: boolean;
  lapDistPct?: number;
}

export type CompanionCommand =
  | { version: 1; id: string; command: "capture.start"; outputDirectory: string }
  | { version: 1; id: string; command: "capture.stop" }
  | { version: 1; id: string; command: "capture.status" };

export type CompanionEvent =
  | { version: 1; event: "companion.ready"; capabilities: string[] }
  | { version: 1; event: "race.lifecycle"; race: CanonicalRaceState }
  | { version: 1; event: "recording.started"; path?: string; race: CanonicalRaceState }
  | { version: 1; event: "recording.stopped"; path: string; race: CanonicalRaceState }
  | { version: 1; event: "telemetry.finalized"; path: string; finalizedAt: string }
  | { version: 1; event: "bundle.created"; path: string; sessionId: string }
  | { version: 1; event: "companion.error"; code: string; message: string; recoverable: boolean };

export function encodeCompanionMessage(message: CompanionCommand | CompanionEvent): string {
  return `${JSON.stringify(message)}\n`;
}

export function parseCompanionCommand(line: string): CompanionCommand {
  const value = JSON.parse(line) as Partial<CompanionCommand>;
  if (value.version !== COMPANION_PROTOCOL_VERSION || typeof value.id !== "string") {
    throw new Error("Unsupported or malformed companion command");
  }
  if (
    value.command !== "capture.start"
    && value.command !== "capture.stop"
    && value.command !== "capture.status"
  ) {
    throw new Error("Unknown companion command");
  }
  if (value.command === "capture.start" && typeof value.outputDirectory !== "string") {
    throw new Error("capture.start requires outputDirectory");
  }
  return value as CompanionCommand;
}

export function parseRaceLifecycleEvent(line: string): CanonicalRaceState {
  const value = JSON.parse(line) as Partial<CompanionEvent>;
  if (value.version !== COMPANION_PROTOCOL_VERSION || value.event !== "race.lifecycle") {
    throw new Error("Expected a race.lifecycle event");
  }
  const race = (value as { race?: Partial<CanonicalRaceState> }).race;
  if (
    !race
    || typeof race.game !== "string"
    || typeof race.sessionId !== "string"
    || !["connecting", "live", "green", "finished"].includes(race.state ?? "")
    || typeof race.wallClock !== "string"
    || typeof race.monotonicMs !== "number"
  ) {
    throw new Error("Malformed canonical race state");
  }
  return race as CanonicalRaceState;
}
