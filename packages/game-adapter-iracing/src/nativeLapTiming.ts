import type { GpsSample } from "@lapwing/telemetry-core";

const LAP = "custom:lap_number";
const PROGRESS = "lap_dist_pct";
const INCIDENTS = "race_incidents";
const PIT = "race_on_pit_road";
const LAST_LAP_TIME = "custom:lap_last_lap_time";

export interface NativeLapSpan {
  lap: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  startIndex: number;
  endIndex: number;
  /** iRacing's settled result, published just after the finish line. */
  officialTimeMs: number | null;
  officialTimePublishedAtMs: number | null;
  startProgress: number;
  endProgress: number;
  incidents: number;
  onPitRoad: boolean;
  complete: boolean;
}

function field(sample: GpsSample, key: string): number | undefined {
  return sample.extraFields[key] ?? sample.extraFields[`custom:${key}`];
}

function finite(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Split iRacing's native lap counter into authoritative lap windows. */
export function nativeLapSpans(samples: GpsSample[]): NativeLapSpan[] {
  const groups: Array<{ lap: number; startIndex: number; samples: GpsSample[] }> = [];
  samples.forEach((sample, sampleIndex) => {
    const lap = field(sample, LAP);
    if (!finite(lap) || lap < 1) return;
    const current = groups.at(-1);
    if (!current || current.lap !== Math.round(lap)) {
      groups.push({ lap: Math.round(lap), startIndex: sampleIndex, samples: [sample] });
    } else {
      current.samples.push(sample);
    }
  });

  return groups.map((group, index) => {
    const first = group.samples[0];
    const last = group.samples.at(-1)!;
    const next = groups[index + 1];
    const startProgress = field(first, PROGRESS) ?? 0;
    const endProgress = field(last, PROGRESS) ?? 0;
    const endMs = next?.samples[0].t ?? last.t;
    const beforeFinish = group.samples.filter((sample) => (field(sample, PROGRESS) ?? 0) < 0.9);
    const previousLastLap = field(beforeFinish.at(-1) ?? first, LAST_LAP_TIME);
    const lapDurationSec = (endMs - first.t) / 1000;
    const officialSample = next?.samples
      .filter((sample) => sample.t >= endMs && sample.t <= endMs + 10_000)
      .find((sample) => {
        const value = field(sample, LAST_LAP_TIME);
        if (!finite(value) || value <= 0) return false;
        return value !== previousLastLap || Math.abs(value - lapDurationSec) < 0.25;
      });
    const officialTimeSec = officialSample ? field(officialSample, LAST_LAP_TIME) : undefined;

    return {
      lap: group.lap,
      startMs: first.t,
      endMs,
      durationMs: endMs - first.t,
      startIndex: group.startIndex,
      endIndex: next ? next.startIndex : samples.length - 1,
      officialTimeMs: finite(officialTimeSec) ? officialTimeSec * 1000 : null,
      officialTimePublishedAtMs: officialSample?.t ?? null,
      startProgress,
      endProgress,
      incidents: Math.max(...group.samples.map((sample) => field(sample, INCIDENTS) ?? 0)),
      onPitRoad: group.samples.some((sample) => (field(sample, PIT) ?? 0) !== 0),
      complete: Boolean(next) && startProgress <= 2 && endProgress >= 98,
    };
  });
}
