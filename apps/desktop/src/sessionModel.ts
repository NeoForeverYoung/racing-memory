export type LocalTrainingCard = {
  title: string;
  detail: string;
  exercise: string;
  completionCriteria: string;
  baselineTimeLossMs: number;
  targetTimeLossMs: number;
  confidence: "low" | "medium" | "high";
  source: {
    insightId: string;
    lapNumber: number;
    referenceLapNumber: number;
    distanceMeters: number;
  };
};

export type LocalSessionAsset = {
  kind: string;
  path: string;
  available: boolean;
};

export type LocalSessionRecord = {
  id: string;
  createdAt: string;
  game: string;
  track?: string | null;
  course?: string | null;
  vehicle?: string | null;
  sessionType?: string | null;
  sessionDirectory: string;
  bundlePath: string;
  telemetryPath: string;
  telemetrySha256?: string | null;
  videoPath?: string | null;
  videoSha256?: string | null;
  videoAvailable: boolean;
  syncConfidence?: string | null;
  syncRequiresReview: boolean;
  deliveryStatus: "not_started" | "running" | "partial" | "succeeded" | "failed";
  deliveryError?: string | null;
  trainingCard?: LocalTrainingCard | null;
  trainingReason?: string | null;
  assets: LocalSessionAsset[];
};

export type DesktopSettings = {
  dataRoot: string;
  telemetryDirectory: string;
  obsUrl: string;
};

export type DesktopState = {
  settings: DesktopSettings;
  sessions: LocalSessionRecord[];
  engineReady: boolean;
  engineError?: string | null;
};

export function sessionTitle(session: Pick<LocalSessionRecord, "track" | "course" | "vehicle">): string {
  const location = [session.track, session.course].filter(Boolean).join(" · ");
  return [location || "未命名赛道", session.vehicle].filter(Boolean).join(" · ");
}

export function sessionDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "日期未知" : date.toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" });
}

export function deliveryLabel(status: LocalSessionRecord["deliveryStatus"]): string {
  return {
    not_started: "尚未生成赛后交付物",
    running: "正在生成赛后交付物",
    partial: "部分交付物已生成",
    succeeded: "赛后交付物已完成",
    failed: "生成失败，可重试",
  }[status];
}

export function setupReady(settings: DesktopSettings): boolean {
  return Boolean(settings.dataRoot.trim() && settings.telemetryDirectory.trim() && settings.obsUrl.trim());
}
