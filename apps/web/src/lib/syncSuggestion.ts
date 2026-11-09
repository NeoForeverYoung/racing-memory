import type { ParsedData } from "@/types/racing";
import type { SessionBundleV1, SessionSync } from "@lapwing/telemetry-core";
import { fitVideoTimeline } from "./videoTimeline";

export interface SyncSuggestion extends SessionSync {
  method: "existing" | "companion-anchors" | "file-time" | "none";
}

export function suggestSessionSync(
  bundle: SessionBundleV1,
  telemetry: Pick<ParsedData, "startDate"> & Partial<Pick<ParsedData, "duration">>,
): SyncSuggestion {
  const anchors = bundle.sync?.anchors ?? [];
  if (anchors.length > 0) {
    const [primary, ...extra] = anchors;
    const fitted = fitVideoTimeline(primary, extra);
    return {
      ...fitted,
      method: "companion-anchors",
      confidence: bundle.sync?.confidence ?? (anchors.length >= 2 ? "high" : "medium"),
      evidence: bundle.sync?.evidence.length
        ? bundle.sync.evidence
        : [`${anchors.length} companion synchronization anchor(s)`],
      requiresReview: bundle.sync?.requiresReview ?? (anchors.length < 2),
      anchors,
    };
  }
  if (bundle.sync) return { ...bundle.sync, method: "existing" };

  const videoStartedAt = bundle.videos[0]?.startedAt;
  if (telemetry.startDate && videoStartedAt) {
    const videoStart = Date.parse(videoStartedAt);
    if (Number.isFinite(videoStart)) {
      const syncOffsetMs = videoStart - telemetry.startDate.getTime();
      const videoDurationMs = (bundle.videos[0]?.durationSec ?? 0) * 1000;
      if (
        Number.isFinite(telemetry.duration)
        && telemetry.duration! > 0
        && videoDurationMs > 0
        && (syncOffsetMs >= telemetry.duration! || syncOffsetMs + videoDurationMs <= 0)
      ) {
        return {
          syncOffsetMs: 0,
          syncRate: 1,
          method: "none",
          confidence: "low",
          evidence: ["File timestamps imply no overlap between telemetry and video; defaulted to aligned starts for manual review."],
          requiresReview: true,
          anchors: [],
        };
      }
      return {
        syncOffsetMs,
        syncRate: 1,
        method: "file-time",
        confidence: "low",
        evidence: ["Compared telemetry startDate with video startedAt metadata."],
        requiresReview: true,
        anchors: [],
      };
    }
  }

  return {
    syncOffsetMs: 0,
    syncRate: 1,
    method: "none",
    confidence: "low",
    evidence: ["No synchronization anchors or usable timestamps were available."],
    requiresReview: true,
    anchors: [],
  };
}
