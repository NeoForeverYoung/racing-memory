import type { GpsSample, Lap } from "@/types/racing";
import { detectBrakingZones } from "./brakingZones";
import { computePositionDelta, resampleByDistance } from "./lapDelta";
import { calculateDistanceArray } from "./referenceUtils";

export type InsightConfidence = "low" | "medium" | "high";

export interface DrivingInsight {
  id: string;
  kind: "sector" | "braking" | "corner-speed" | "throttle";
  title: string;
  advice: string;
  lapNumber: number;
  referenceLapNumber: number;
  distanceMeters: number;
  location: { lat: number; lon: number };
  timeLossMs: number;
  confidence: InsightConfidence;
  evidence: Array<{ metric: string; current: number; reference: number; unit: string }>;
}

export interface DrivingInsightsResult {
  referenceLapNumber: number | null;
  analyzedLapNumber: number | null;
  insights: DrivingInsight[];
  warnings: string[];
}

function lapSamples(samples: GpsSample[], lap: Lap): GpsSample[] {
  return samples.slice(lap.startIndex, lap.endIndex + 1);
}

function throttleAt(sample: GpsSample): number | null {
  for (const [key, value] of Object.entries(sample.extraFields)) {
    if (key.toLowerCase().includes("throttle")) return value;
  }
  return null;
}

function confidenceFor(samples: GpsSample[], matched: boolean): InsightConfidence {
  if (samples.length < 50) return "low";
  return matched && samples.some((sample) => throttleAt(sample) != null) ? "high" : "medium";
}

function firstIndexAtOrAfter(samples: GpsSample[], time: number): number {
  const index = samples.findIndex((sample) => sample.t >= time);
  return index < 0 ? samples.length - 1 : index;
}

function minimumSpeed(samples: GpsSample[], start: number, end: number): number {
  const values = samples
    .filter((sample) => sample.t >= start && sample.t <= end)
    .map((sample) => sample.speedMph);
  return values.length > 0 ? Math.min(...values) : 0;
}

function throttleRecoveryMs(samples: GpsSample[], after: number): number | null {
  const recovered = samples.find((sample) => sample.t >= after && (throttleAt(sample) ?? -Infinity) >= 80);
  return recovered ? recovered.t - samples[0].t : null;
}

export function generateDrivingInsights(samples: GpsSample[], laps: Lap[]): DrivingInsightsResult {
  const complete = laps
    .filter((lap) => !lap.incomplete && lap.lapTimeMs > 0 && lap.endIndex > lap.startIndex)
    .sort((a, b) => a.lapTimeMs - b.lapTimeMs);
  const reference = complete[0];
  const target = [...complete.slice(1)].sort((a, b) => b.lapNumber - a.lapNumber)[0];
  if (!reference || !target) {
    return {
      referenceLapNumber: reference?.lapNumber ?? null,
      analyzedLapNumber: null,
      insights: [],
      warnings: ["At least two complete laps are required for comparative driving insights."],
    };
  }

  const referenceSamples = lapSamples(samples, reference);
  const targetSamples = lapSamples(samples, target);
  if (referenceSamples.length < 3 || targetSamples.length < 3) {
    return {
      referenceLapNumber: reference.lapNumber,
      analyzedLapNumber: target.lapNumber,
      insights: [],
      warnings: ["The selected laps do not contain enough samples for reliable comparison."],
    };
  }
  const grid = resampleByDistance(referenceSamples, 5);
  const delta = computePositionDelta(targetSamples, grid, { maxMatchMeters: 40 });
  if (delta.reversed) {
    return {
      referenceLapNumber: reference.lapNumber,
      analyzedLapNumber: target.lapNumber,
      insights: [],
      warnings: ["The analyzed and reference laps appear to run in opposite directions."],
    };
  }
  const distances = calculateDistanceArray(targetSamples);
  const targetBraking = detectBrakingZones(targetSamples);
  const referenceBraking = detectBrakingZones(referenceSamples);
  const lossWindow = Math.max(10, Math.round(targetSamples.length * 0.2));
  const candidates = delta.delta
    .map((value, index) => {
      if (value == null) return null;
      const prior = delta.delta
        .slice(Math.max(0, index - lossWindow), index + 1)
        .filter((candidate): candidate is number => candidate != null);
      const baseline = prior.length > 0 ? Math.min(...prior) : value;
      return { value: value - baseline, cumulative: value, index };
    })
    .filter((entry): entry is { value: number; cumulative: number; index: number } =>
      entry != null && entry.value > 0.15)
    .sort((a, b) => b.value - a.value);
  const selected: typeof candidates = [];
  for (const candidate of candidates) {
    if (selected.every((entry) => Math.abs(entry.index - candidate.index) > targetSamples.length * 0.12)) {
      selected.push(candidate);
    }
    if (selected.length === 3) break;
  }

  const insights: DrivingInsight[] = selected.map((candidate, order) => {
    const targetSample = targetSamples[candidate.index];
    const referenceGridIndex = delta.matchIndex[candidate.index];
    const referenceIndex = grid.nativeIdx[referenceGridIndex] ?? 0;
    const referenceSample = referenceSamples[Math.min(referenceSamples.length - 1, referenceIndex)];
    const targetZone = targetBraking.find((zone) => targetSample.t >= zone.start.t && targetSample.t <= zone.end.t);
    const referenceZone = referenceBraking.find(
      (zone) => referenceSample.t >= zone.start.t && referenceSample.t <= zone.end.t,
    );
    const speedLossMph = referenceSample.speedMph - targetSample.speedMph;
    const brakingMatched = Boolean(targetZone && referenceZone);
    const evidence: DrivingInsight["evidence"] = [
      { metric: "regional time loss", current: candidate.value * 1000, reference: 0, unit: "ms" },
      { metric: "cumulative pace delta", current: candidate.cumulative * 1000, reference: 0, unit: "ms" },
      { metric: "speed", current: targetSample.speedMph, reference: referenceSample.speedMph, unit: "mph" },
    ];
    if (targetZone && referenceZone) {
      evidence.push({
        metric: "brake duration",
        current: targetZone.durationMs,
        reference: referenceZone.durationMs,
        unit: "ms",
      });
    }
    const currentThrottle = throttleAt(targetSample);
    const referenceThrottle = throttleAt(referenceSample);
    if (currentThrottle != null && referenceThrottle != null) {
      evidence.push({ metric: "throttle", current: currentThrottle, reference: referenceThrottle, unit: "%" });
    }

    let kind: DrivingInsight["kind"] = "corner-speed";
    let title = `Speed opportunity ${order + 1}`;
    let advice = speedLossMph > 2
      ? `Carry approximately ${speedLossMph.toFixed(1)} mph more at this point, using the fastest lap as the reference.`
      : `A ${Math.round(candidate.value * 1000)} ms loss develops through this section; compare its line and input traces before changing a specific control.`;
    if (targetZone && referenceZone && targetZone.durationMs > referenceZone.durationMs + 150) {
      kind = "braking";
      title = `Braking zone ${order + 1}`;
      advice = `The brake phase is ${Math.round(targetZone.durationMs - referenceZone.durationMs)} ms longer than the reference. Brake later or release more progressively.`;
    } else if (
      currentThrottle != null
      && referenceThrottle != null
      && referenceThrottle - currentThrottle > 10
    ) {
      kind = "throttle";
      title = `Throttle opportunity ${order + 1}`;
      advice = "Return to throttle earlier; the reference lap is already carrying materially more throttle here.";
    }
    return {
      id: `lap-${target.lapNumber}-opportunity-${order + 1}`,
      kind,
      title,
      advice,
      lapNumber: target.lapNumber,
      referenceLapNumber: reference.lapNumber,
      distanceMeters: distances[candidate.index] ?? 0,
      location: { lat: targetSample.lat, lon: targetSample.lon },
      timeLossMs: Math.round(candidate.value * 1000),
      confidence: confidenceFor(
        targetSamples,
        brakingMatched
          || speedLossMph > 2
          || (currentThrottle != null && referenceThrottle != null && referenceThrottle - currentThrottle > 10),
      ),
      evidence,
    };
  });

  for (let zoneIndex = 0; zoneIndex < Math.min(targetBraking.length, referenceBraking.length, 3); zoneIndex++) {
    const currentZone = targetBraking[zoneIndex];
    const referenceZone = referenceBraking[zoneIndex];
    const currentStartMs = currentZone.start.t - targetSamples[0].t;
    const referenceStartMs = referenceZone.start.t - referenceSamples[0].t;
    const currentMinMph = minimumSpeed(targetSamples, currentZone.start.t, currentZone.end.t);
    const referenceMinMph = minimumSpeed(referenceSamples, referenceZone.start.t, referenceZone.end.t);
    const currentThrottleMs = throttleRecoveryMs(targetSamples, currentZone.end.t);
    const referenceThrottleMs = throttleRecoveryMs(referenceSamples, referenceZone.end.t);
    const startDifferenceMs = currentStartMs - referenceStartMs;
    const speedDifferenceMph = referenceMinMph - currentMinMph;
    const throttleDifferenceMs = currentThrottleMs != null && referenceThrottleMs != null
      ? currentThrottleMs - referenceThrottleMs
      : 0;
    if (
      Math.abs(startDifferenceMs) < 100
      && speedDifferenceMph < 1
      && throttleDifferenceMs < 100
    ) continue;
    const currentIndex = firstIndexAtOrAfter(targetSamples, currentZone.end.t);
    const paceLossMs = Math.max(0, Math.round((delta.delta[currentIndex] ?? 0) * 1000));
    let kind: DrivingInsight["kind"] = "braking";
    let advice = startDifferenceMs < -100
      ? `Brake approximately ${Math.round(Math.abs(startDifferenceMs))} ms later, using the fastest lap as the reference.`
      : `The braking point is ${Math.round(startDifferenceMs)} ms later than the reference; prioritize a stable release and entry.`;
    if (speedDifferenceMph > 1) {
      kind = "corner-speed";
      advice = `Carry approximately ${speedDifferenceMph.toFixed(1)} mph more minimum speed through this braking zone.`;
    }
    if (throttleDifferenceMs > 100) {
      kind = "throttle";
      advice = `Return to at least 80% throttle approximately ${Math.round(throttleDifferenceMs)} ms earlier.`;
    }
    insights.push({
      id: `lap-${target.lapNumber}-brake-${zoneIndex + 1}`,
      kind,
      title: `Brake zone ${zoneIndex + 1}`,
      advice,
      lapNumber: target.lapNumber,
      referenceLapNumber: reference.lapNumber,
      distanceMeters: distances[firstIndexAtOrAfter(targetSamples, currentZone.start.t)] ?? 0,
      location: { lat: currentZone.start.lat, lon: currentZone.start.lon },
      timeLossMs: paceLossMs,
      confidence: confidenceFor(targetSamples, true),
      evidence: [
        { metric: "brake start", current: currentStartMs, reference: referenceStartMs, unit: "ms from lap start" },
        { metric: "minimum speed", current: currentMinMph, reference: referenceMinMph, unit: "mph" },
        ...(currentThrottleMs != null && referenceThrottleMs != null
          ? [{ metric: "80% throttle recovery", current: currentThrottleMs, reference: referenceThrottleMs, unit: "ms from lap start" }]
          : []),
      ],
    });
  }

  const sectorCount = Math.min(target.sectorTimes?.length ?? 0, reference.sectorTimes?.length ?? 0);
  for (let index = 0; index < sectorCount; index++) {
    const current = target.sectorTimes?.[index];
    const referenceTime = reference.sectorTimes?.[index];
    if (current == null || referenceTime == null || current - referenceTime < 100) continue;
    const boundary = target.sectorBoundaries?.[index] ?? target.startIndex;
    const sample = samples[Math.min(samples.length - 1, Math.max(0, boundary))];
    insights.push({
      id: `lap-${target.lapNumber}-sector-${index + 1}`,
      kind: "sector",
      title: `Sector ${index + 1}`,
      advice: `This sector is ${Math.round(current - referenceTime)} ms slower than the fastest lap; review its braking and exit traces first.`,
      lapNumber: target.lapNumber,
      referenceLapNumber: reference.lapNumber,
      distanceMeters: 0,
      location: { lat: sample.lat, lon: sample.lon },
      timeLossMs: Math.round(current - referenceTime),
      confidence: "medium",
      evidence: [{ metric: "sector time", current, reference: referenceTime, unit: "ms" }],
    });
  }

  insights.sort((left, right) => right.timeLossMs - left.timeLossMs);

  return {
    referenceLapNumber: reference.lapNumber,
    analyzedLapNumber: target.lapNumber,
    insights,
    warnings: insights.length === 0
      ? ["No time-loss region above 150 ms could be identified with sufficient evidence."]
      : [],
  };
}
