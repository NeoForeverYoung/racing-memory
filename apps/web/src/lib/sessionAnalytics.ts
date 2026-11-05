import { calculateOptimalLap } from "./lapCalculation";
import type { Lap, ParsedData } from "@/types/racing";
import type { SessionBundleMetadata } from "@lapwing/telemetry-core";

export interface SessionAnalytics {
  metadata: SessionBundleMetadata;
  sampleCount: number;
  durationMs: number;
  completeLapCount: number;
  fastestLapMs: number | null;
  fastestLapNumber: number | null;
  averageLapMs: number | null;
  medianLapMs: number | null;
  optimalLapMs: number | null;
  sectors: Array<{ index: number; bestMs: number; averageMs: number }>;
  consistencyStdDevMs: number | null;
  excludedLapNumbers: number[];
  dataQuality: {
    acceptedRows: number;
    rejectedRows: number;
    acceptanceRate: number;
  } | null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function standardDeviation(values: number[]): number | null {
  if (values.length < 2) return null;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length);
}

export function analyzeSession(
  data: Pick<ParsedData, "samples" | "duration" | "parserStats">,
  laps: Lap[],
  metadata: SessionBundleMetadata = {},
): SessionAnalytics {
  const complete = laps.filter((lap) => !lap.incomplete && lap.lapTimeMs > 0);
  const times = complete.map((lap) => lap.lapTimeMs);
  const center = median(times);
  // Exclude extreme timing failures from averages while retaining every valid
  // lap when there are too few observations to establish an outlier baseline.
  const comparable = center != null && times.length >= 4
    ? complete.filter((lap) => lap.lapTimeMs >= center * 0.5 && lap.lapTimeMs <= center * 1.5)
    : complete;
  const comparableTimes = comparable.map((lap) => lap.lapTimeMs);
  const fastest = comparable.reduce<Lap | null>(
    (best, lap) => !best || lap.lapTimeMs < best.lapTimeMs ? lap : best,
    null,
  );
  const optimal = calculateOptimalLap(comparable);
  const sectorCount = Math.max(0, ...comparable.map((lap) => lap.sectorTimes?.length ?? 0));
  const sectors = Array.from({ length: sectorCount }, (_, index) => {
    const values = comparable
      .map((lap) => lap.sectorTimes?.[index])
      .filter((value): value is number => value != null && value > 0);
    return values.length > 0 ? {
      index: index + 1,
      bestMs: Math.min(...values),
      averageMs: values.reduce((sum, value) => sum + value, 0) / values.length,
    } : null;
  }).filter((sector): sector is { index: number; bestMs: number; averageMs: number } => sector != null);
  const stats = data.parserStats;
  const rejectedRows = stats
    ? Object.values(stats.rejected).reduce((sum, value) => sum + value, 0)
    : 0;
  return {
    metadata,
    sampleCount: data.samples.length,
    durationMs: data.duration,
    completeLapCount: complete.length,
    fastestLapMs: fastest?.lapTimeMs ?? null,
    fastestLapNumber: fastest?.lapNumber ?? null,
    averageLapMs: comparableTimes.length > 0
      ? comparableTimes.reduce((sum, value) => sum + value, 0) / comparableTimes.length
      : null,
    medianLapMs: median(comparableTimes),
    optimalLapMs: optimal?.optimalTimeMs ?? null,
    sectors,
    consistencyStdDevMs: standardDeviation(comparableTimes),
    excludedLapNumbers: complete
      .filter((lap) => !comparable.includes(lap))
      .map((lap) => lap.lapNumber),
    dataQuality: stats ? {
      acceptedRows: stats.acceptedRows,
      rejectedRows,
      acceptanceRate: stats.totalRows > 0 ? stats.acceptedRows / stats.totalRows : 0,
    } : null,
  };
}
