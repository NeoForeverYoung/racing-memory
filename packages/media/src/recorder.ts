import type { CanonicalRaceState } from "@lapwing/game-adapter-kit";

export interface RecorderStartResult {
  acknowledgedAt: string;
}

export interface RecorderStopResult {
  path: string;
  acknowledgedAt: string;
}

export interface RecorderProvider {
  readonly id: string;
  start(race: CanonicalRaceState): Promise<RecorderStartResult>;
  stop(race: CanonicalRaceState): Promise<RecorderStopResult>;
}
