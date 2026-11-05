import type { GpsSample, Lap, ParsedData } from "@/types/racing";
import { channelKeyFor } from "@/lib/channels";
import type { MemoryHighlight } from "@lapwing/telemetry-core";
export type { MemoryHighlight, MemoryHighlightKind } from "@lapwing/telemetry-core";

const WINDOW_BEFORE_MS = 12_000;
const WINDOW_AFTER_MS = 5_000;
const OVERTAKE_COOLDOWN_MS = 3_000;

function windowFor(
  durationMs: number,
  value: Omit<MemoryHighlight, "startMs" | "endMs">,
): MemoryHighlight {
  return {
    ...value,
    startMs: Math.max(0, value.atMs - WINDOW_BEFORE_MS),
    endMs: Math.min(durationMs, value.atMs + WINDOW_AFTER_MS),
  };
}

function channel(sample: GpsSample, name: string): number | undefined {
  const value = sample.extraFields[name] ?? sample.extraFields[channelKeyFor(name)];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function fastestLap(laps: Lap[]): Lap | undefined {
  return laps
    .filter((lap) => !lap.incomplete && lap.lapTimeMs > 0)
    .reduce<Lap | undefined>(
      (best, lap) => (!best || lap.lapTimeMs < best.lapTimeMs ? lap : best),
      undefined,
    );
}

function formatLapTime(milliseconds: number): string {
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = (milliseconds - minutes * 60_000) / 1000;
  return `${minutes}:${seconds.toFixed(3).padStart(6, "0")}`;
}

export function detectMemoryHighlights(
  data: Pick<ParsedData, "samples" | "duration">,
  laps: Lap[],
): MemoryHighlight[] {
  const durationMs = Math.max(0, data.duration);
  const highlights: MemoryHighlight[] = [];
  const best = fastestLap(laps);

  if (best) {
    highlights.push(windowFor(durationMs, {
      id: `best-lap-${best.lapNumber}`,
      kind: "best_lap",
      atMs: best.endTime,
      score: 100,
      title: "Best lap",
      detail: `Lap ${best.lapNumber} · ${formatLapTime(best.lapTimeMs)}`,
      lapNumber: best.lapNumber,
    }));
  }

  let previousPosition: number | undefined;
  let previousIncidents: number | undefined;
  let previousOnPitRoad = false;
  let lastOvertakeAt = -Infinity;

  for (const sample of data.samples) {
    const position = channel(sample, "race_position");
    const incidents = channel(sample, "race_incidents");
    const onPitRoad = (channel(sample, "race_on_pit_road") ?? 0) > 0;

    if (
      position != null &&
      previousPosition != null &&
      position > 0 &&
      position < previousPosition &&
      previousPosition - position <= 4 &&
      !onPitRoad &&
      !previousOnPitRoad &&
      sample.t - lastOvertakeAt >= OVERTAKE_COOLDOWN_MS
    ) {
      highlights.push(windowFor(durationMs, {
        id: `overtake-${Math.round(sample.t)}-${position}`,
        kind: "overtake",
        atMs: sample.t,
        score: 80,
        title: "Overtake",
        detail: `P${previousPosition} → P${position}`,
      }));
      lastOvertakeAt = sample.t;
    }

    if (incidents != null && previousIncidents != null && incidents > previousIncidents) {
      highlights.push(windowFor(durationMs, {
        id: `incident-${Math.round(sample.t)}-${incidents}`,
        kind: "incident",
        atMs: sample.t,
        score: 60,
        title: "Incident",
        detail: `${previousIncidents}x → ${incidents}x`,
      }));
    }

    if (position != null && position > 0) previousPosition = position;
    if (incidents != null) previousIncidents = incidents;
    previousOnPitRoad = onPitRoad;
  }

  const lastSample = data.samples.at(-1);
  if (lastSample && durationMs > 0) {
    const position = channel(lastSample, "race_position");
    highlights.push(windowFor(durationMs, {
      id: `finish-${Math.round(durationMs)}`,
      kind: "finish",
      atMs: durationMs,
      score: 90,
      title: "Finish",
      detail: position && position > 0 ? `Finished P${position}` : undefined,
      position: position && position > 0 ? position : undefined,
    }));
  }

  return highlights.sort((a, b) => a.atMs - b.atMs || b.score - a.score);
}

export function totalHighlightDuration(highlights: MemoryHighlight[]): number {
  return highlights.reduce(
    (total, highlight) => total + Math.max(0, highlight.endMs - highlight.startMs),
    0,
  );
}
