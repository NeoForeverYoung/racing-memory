import { Trophy } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { formatLapTime } from "@/lib/lapCalculation";
import type { SnapshotPromptState } from "@/hooks/useLapSnapshots";

interface LapSnapshotPromptDialogProps {
  prompt: SnapshotPromptState | null;
  onConfirm: () => void;
  onDismiss: () => void;
}

/**
 * "New course fastest lap" prompt, shown when an engine is assigned to a session
 * whose best lap beats (or has no) stored snapshot for that engine + course.
 */
export function LapSnapshotPromptDialog({ prompt, onConfirm, onDismiss }: LapSnapshotPromptDialogProps) {
  const { t } = useTranslation("session");
  const candidate = prompt?.candidate;
  return (
    <Dialog open={!!prompt} onOpenChange={(open) => !open && onDismiss()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-racing-lapBest" />
            {prompt?.kind === "faster" ? t("snapshotPrompt.titleFaster") : t("snapshotPrompt.titleSave")}
          </DialogTitle>
          <DialogDescription>
            {candidate && (
              <Trans
                t={t}
                i18nKey="snapshotPrompt.description"
                values={{ engine: candidate.engine, track: candidate.trackName, course: candidate.courseName }}
                components={{ strong: <strong /> }}
              />
            )}
          </DialogDescription>
        </DialogHeader>

        {candidate && (
          <div className="space-y-1.5 rounded-md border border-border bg-muted/30 px-3 py-2.5 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{t("snapshotPrompt.lap", { number: candidate.sourceLapNumber })}</span>
              <span className="font-mono font-medium text-foreground">{formatLapTime(candidate.lapTimeMs)}</span>
            </div>
            {prompt?.existing && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{t("snapshotPrompt.previousBest")}</span>
                <span className="font-mono text-muted-foreground line-through">
                  {formatLapTime(prompt.existing.lapTimeMs)}
                </span>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onDismiss}>{t("snapshotPrompt.notNow")}</Button>
          <Button onClick={onConfirm}>{prompt?.kind === "faster" ? t("snapshotPrompt.update") : t("snapshotPrompt.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
