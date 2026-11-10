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

export type ObsReadiness = {
  installed: boolean;
  installPath: string | null;
  websocketOk: boolean;
  detail: string;
};

export type DesktopState = {
  settings: DesktopSettings;
  sessions: LocalSessionRecord[];
  engineReady: boolean;
  engineError?: string | null;
};

export function obsReadinessSummary(
  readiness: ObsReadiness | null,
  settings: DesktopSettings,
): { good: boolean; value: string; detail: string } {
  if (!settings.obsUrl.trim()) {
    return {
      good: false,
      value: "未配置",
      detail: "在设置中填写 OBS WebSocket 地址；OBS Studio 需单独安装，不包含在便携包内。",
    };
  }
  if (!readiness) {
    return { good: false, value: "检测中…", detail: "正在探测 OBS WebSocket…" };
  }
  const installNote = readiness.installed
    ? "已在本机常见路径检测到 OBS。"
    : "未在常见路径检测到 OBS（便携安装仍可能可用）。";
  return {
    good: readiness.websocketOk,
    value: readiness.websocketOk ? "已连接" : readiness.installed ? "未连接" : "需安装",
    detail: `${installNote} ${readiness.detail}`,
  };
}

export function captureReady(
  state: Pick<DesktopState, "engineReady" | "settings">,
  obs: ObsReadiness | null,
): boolean {
  return state.engineReady && setupReady(state.settings) && Boolean(obs?.websocketOk);
}

export const DELIVERY_STEPS = [
  { id: "inspect", label: "资料检查" },
  { id: "sync", label: "视频同步" },
  { id: "analyze", label: "圈速分析" },
  { id: "memory", label: "回忆片段检测" },
  { id: "reel", label: "Racing Memory Reel" },
  { id: "assets", label: "最快圈 / OPT / 纪念图" },
  { id: "report", label: "赛后报告与成绩单" },
  { id: "insights", label: "驾驶建议" },
  { id: "training", label: "下次练习卡" },
] as const;

export type DeliveryStepId = typeof DELIVERY_STEPS[number]["id"];
export type DeliveryStepProgress = {
  step: DeliveryStepId;
  status: "pending" | "started" | "completed" | "skipped" | "failed";
  percent: number;
  message?: string;
};
export type DeliveryProgress = Partial<Record<DeliveryStepId, DeliveryStepProgress>>;

const USER_ASSET_EXTENSIONS = new Set([".html", ".jpeg", ".jpg", ".mp4", ".png", ".webp"]);

function extension(path: string): string {
  const match = path.toLowerCase().match(/\.[a-z0-9]+$/);
  return match?.[0] ?? "";
}

export function visibleSessionAssets(assets: LocalSessionAsset[]): LocalSessionAsset[] {
  return assets.filter((asset) => asset.available && USER_ASSET_EXTENSIONS.has(extension(asset.path)));
}

export function isPreviewableImage(path: string): boolean {
  return [".jpeg", ".jpg", ".png", ".webp"].includes(extension(path));
}

export function assetDisplayLabel(asset: LocalSessionAsset): string {
  const name = asset.path.split(/[\\/]/).at(-1)?.toLowerCase() ?? "";
  if (name.includes("fastest-available-lap")) return "最快完整圈";
  if (name.includes("opt-composite")) return "OPT 合成圈";
  if (name === "reel.mp4") return "Racing Memory 回忆视频";
  if (name.includes("session-memento")) return "Session 纪念图";
  if (name.startsWith("scorecard-")) return "赛后成绩单";
  if (name === "index.html") return "完整赛后报告";
  return asset.kind;
}

export function parseDeliveryProgress(message: string): DeliveryStepProgress | null {
  let value: unknown;
  try {
    value = JSON.parse(message);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const event = value as Record<string, unknown>;
  if (event.type !== "progress" || typeof event.step !== "string") return null;
  if (!DELIVERY_STEPS.some(({ id }) => id === event.step)) return null;
  const status = event.status;
  if (!["started", "running", "completed", "skipped", "failed"].includes(String(status))) return null;
  const rawPercent = typeof event.percent === "number"
    ? event.percent * 100
    : status === "completed" || status === "skipped" ? 100 : 0;
  return {
    step: event.step as DeliveryStepId,
    status: status === "running" ? "started" : status as DeliveryStepProgress["status"],
    percent: Math.max(0, Math.min(100, Math.round(rawPercent))),
    message: typeof event.message === "string" ? event.message : undefined,
  };
}

export function deliveryOverallPercent(progress: DeliveryProgress): number {
  const total = DELIVERY_STEPS.reduce((sum, { id }) => sum + (progress[id]?.percent ?? 0), 0);
  return Math.round(total / DELIVERY_STEPS.length);
}

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
