import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Download, Flag, Gauge, Loader2, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSessionContext } from "@/contexts/SessionContext";
import { formatLapTime } from "@/lib/lapCalculation";
import { sessionMsToVideoSec } from "@/lib/videoTimeline";
import { startVideoExport, type ExportSource } from "@/lib/videoExport";
import type { PluginPanelProps } from "@/plugins/panels";
import {
  detectMemoryHighlights,
  totalHighlightDuration,
  type MemoryHighlight,
  type MemoryHighlightKind,
} from "./highlights";

const ICONS = {
  best_lap: Trophy,
  overtake: Gauge,
  incident: AlertTriangle,
  finish: Flag,
} satisfies Record<MemoryHighlightKind, typeof Trophy>;

function formatClock(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function MemoryPanel({ data, laps }: PluginPanelProps) {
  const { t } = useTranslation("plugins");
  const { videoState } = useSessionContext();
  const [exporting, setExporting] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const highlights = useMemo(
    () => data ? detectMemoryHighlights(data, laps) : [],
    [data, laps],
  );

  if (!data) {
    return <p className="text-sm text-muted-foreground">{t("racingMemory.noSession")}</p>;
  }

  if (highlights.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("racingMemory.noHighlights")}</p>;
  }

  const reelDuration = totalHighlightDuration(highlights);

  // The detector's title/detail strings are English (shared with the headless
  // CLI's JSON output); the panel rebuilds the worded ones from structured fields.
  const localizedDetail = (highlight: MemoryHighlight): string | undefined => {
    if (highlight.kind === "best_lap") {
      const lap = laps.find((item) => item.lapNumber === highlight.lapNumber);
      return lap
        ? t("racingMemory.detailBestLap", { lap: lap.lapNumber, time: formatLapTime(lap.lapTimeMs) })
        : highlight.detail;
    }
    if (highlight.kind === "finish") {
      return highlight.position ? t("racingMemory.detailFinish", { position: highlight.position }) : undefined;
    }
    return highlight.detail;
  };
  const canExport = Boolean(videoState.videoUrl && !videoState.nativeSource);

  const exportHighlight = async (highlight: MemoryHighlight) => {
    if (!videoState.videoUrl || videoState.nativeSource || exporting) return;
    setExporting(highlight.id);
    setProgress(0);
    setError(null);

    let video: HTMLVideoElement;
    try {
      video = await loadExportVideo(videoState.videoUrl);
    } catch {
      setExporting(null);
      setError(t("racingMemory.errVideoOpen"));
      return;
    }
    const totalDuration = videoState.videoDuration || video.duration;
    const startTime = Math.max(
      0,
      sessionMsToVideoSec(highlight.startMs, videoState.syncOffsetMs, videoState.syncRate),
    );
    const endTime = Math.min(
      totalDuration,
      sessionMsToVideoSec(highlight.endMs, videoState.syncOffsetMs, videoState.syncRate),
    );
    if (endTime <= startTime) {
      video.removeAttribute("src");
      video.load();
      setExporting(null);
      setError(t("racingMemory.errOutsideVideo"));
      return;
    }
    const chunks = videoState.exportChunks.length > 0
      ? videoState.exportChunks
      : [{ url: videoState.videoUrl, startOffsetSec: 0, durationSec: totalDuration }];
    const source: ExportSource = {
      liveVideo: video,
      chunks,
      totalDuration,
      fileName: videoState.videoFileName ?? undefined,
    };
    const dispose = () => {
      video.removeAttribute("src");
      video.load();
      setExporting(null);
    };

    startVideoExport(source, null, {
      includeOverlays: false,
      quality: "standard",
      range: "full",
      destination: "device",
      startTime,
      endTime,
    }, {
      onProgress: setProgress,
      onComplete: (blob) => {
        downloadHighlight(blob, highlight);
        dispose();
      },
      onError: (message) => {
        setError(message);
        dispose();
      },
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <Summary label={t("racingMemory.moments")} value={String(highlights.length)} />
        <Summary label={t("racingMemory.reelLength")} value={formatClock(reelDuration)} />
        <Summary label={t("racingMemory.bestScore")} value={String(Math.max(...highlights.map((item) => item.score)))} />
      </div>

      <ol className="space-y-2">
        {highlights.map((highlight) => {
          const Icon = ICONS[highlight.kind];
          const detail = localizedDetail(highlight);
          return (
            <li key={highlight.id} className="flex items-center gap-3 rounded-md border border-border px-3 py-2">
              <Icon className="h-4 w-4 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{t(`racingMemory.kind.${highlight.kind}`)}</p>
                {detail && <p className="truncate text-xs text-muted-foreground">{detail}</p>}
              </div>
              <div className="text-right">
                <p className="text-xs font-mono text-foreground">{formatClock(highlight.atMs)}</p>
                <p className="text-[10px] text-muted-foreground">
                  {formatClock(highlight.startMs)}–{formatClock(highlight.endMs)}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                disabled={!canExport || exporting !== null}
                title={canExport ? t("racingMemory.exportMoment") : t("racingMemory.syncFirst")}
                onClick={() => void exportHighlight(highlight)}
              >
                {exporting === highlight.id
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Download className="h-4 w-4" />}
              </Button>
            </li>
          );
        })}
      </ol>

      {exporting && <p className="text-xs text-muted-foreground">{t("racingMemory.exporting", { percent: Math.round(progress * 100) })}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
      {!canExport && <p className="text-xs text-muted-foreground">{t("racingMemory.syncHint")}</p>}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/50 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold text-foreground">{value}</p>
    </div>
  );
}

function loadExportVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.addEventListener("loadedmetadata", () => resolve(video), { once: true });
    video.addEventListener("error", () => reject(new Error("video metadata failed")), { once: true });
    video.src = url;
    video.load();
  });
}

function downloadHighlight(blob: Blob, highlight: MemoryHighlight): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `racing-memory-${highlight.kind}-${Math.round(highlight.atMs / 1000)}s.mp4`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
