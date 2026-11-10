export interface DesktopSessionDescriptor {
  telemetryUrl: string;
  telemetryFileName: string;
  video?: {
    url: string;
    fileName: string;
  };
  sync?: {
    offsetMs: number;
    rate: number;
    confidence?: string;
    requiresReview?: boolean;
  };
  autoUseWaypoint?: boolean;
}

export interface StagedDesktopVideo {
  sessionFileName: string;
  url: string;
  fileName: string;
  syncOffsetMs: number;
  syncRate: number;
  lockSync: boolean;
}

let pendingVideo: StagedDesktopVideo | null = null;

export function desktopSessionToken(search: string, injectedToken?: string | null): string | null {
  return new URLSearchParams(search).get("desktopSession") || injectedToken || null;
}

export function stageDesktopVideo(descriptor: DesktopSessionDescriptor): void {
  if (!descriptor.video) return;
  pendingVideo = {
    sessionFileName: descriptor.telemetryFileName,
    url: descriptor.video.url,
    fileName: descriptor.video.fileName,
    syncOffsetMs: descriptor.sync?.offsetMs ?? 0,
    syncRate: descriptor.sync?.rate ?? 1,
    lockSync: descriptor.sync?.requiresReview !== true
      && (descriptor.sync?.confidence === "high" || descriptor.sync?.confidence === "reviewed"),
  };
}

export function takeStagedDesktopVideo(sessionFileName: string): StagedDesktopVideo | null {
  if (pendingVideo?.sessionFileName !== sessionFileName) return null;
  const video = pendingVideo;
  pendingVideo = null;
  return video;
}
