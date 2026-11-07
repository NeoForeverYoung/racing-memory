import type { DrivingInsight, DrivingInsightsResult, InsightConfidence } from "@/lib/drivingInsights";

export interface TrainingCard {
  schemaVersion: 1;
  title: string;
  detail: string;
  exercise: string;
  completionCriteria: string;
  baselineTimeLossMs: number;
  targetTimeLossMs: number;
  confidence: InsightConfidence;
  source: {
    insightId: string;
    lapNumber: number;
    referenceLapNumber: number;
    distanceMeters: number;
  };
  evidence: DrivingInsight["evidence"];
}

export interface TrainingCardResult {
  schemaVersion: 1;
  card: TrainingCard | null;
  reason: string | null;
}

const CONFIDENCE_RANK: Record<InsightConfidence, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

function targetLossMs(lossMs: number): number {
  return Math.max(100, Math.round(lossMs / 2));
}

function exerciseFor(insight: DrivingInsight): string {
  switch (insight.kind) {
    case "braking":
      return "下一次同车同赛道练习时，连续完成 5 个干净圈，只关注这一个刹车区的制动释放与入弯稳定性。";
    case "throttle":
      return "下一次同车同赛道练习时，连续完成 5 个干净圈，只关注这个区间的平顺回油与出弯牵引。";
    case "corner-speed":
      return "下一次同车同赛道练习时，连续完成 5 个干净圈，只关注该区间的线路与最低速度，不要同时改动多个驾驶动作。";
    case "sector":
      return "下一次同车同赛道练习时，连续完成 5 个干净圈，先回看这个 Sector 内最慢的一个区间，再只练一个明确动作。";
  }
}

export function selectTrainingCard(result: DrivingInsightsResult): TrainingCardResult {
  const candidate = [...result.insights]
    .filter((insight) => insight.timeLossMs > 0 && Number.isFinite(insight.timeLossMs))
    .sort((left, right) => {
      const confidence = CONFIDENCE_RANK[right.confidence] - CONFIDENCE_RANK[left.confidence];
      return confidence !== 0 ? confidence : right.timeLossMs - left.timeLossMs;
    })[0];

  if (!candidate) {
    return {
      schemaVersion: 1,
      card: null,
      reason: result.warnings[0] ?? "这场 Session 没有足够可靠的圈间比较证据，暂不生成训练建议。",
    };
  }

  const target = targetLossMs(candidate.timeLossMs);
  return {
    schemaVersion: 1,
    card: {
      schemaVersion: 1,
      title: candidate.title,
      detail: `第 ${candidate.lapNumber} 圈在此区间比参考第 ${candidate.referenceLapNumber} 圈慢约 ${candidate.timeLossMs} ms。${candidate.advice}`,
      exercise: exerciseFor(candidate),
      completionCriteria: `下次在相同车辆和赛道条件下复测，目标是将该区间损失从 ${candidate.timeLossMs} ms 降至 ${target} ms 或更少；至少保留 5 个完整、无事故圈作为样本。`,
      baselineTimeLossMs: candidate.timeLossMs,
      targetTimeLossMs: target,
      confidence: candidate.confidence,
      source: {
        insightId: candidate.id,
        lapNumber: candidate.lapNumber,
        referenceLapNumber: candidate.referenceLapNumber,
        distanceMeters: candidate.distanceMeters,
      },
      evidence: candidate.evidence,
    },
    reason: null,
  };
}
