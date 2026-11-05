export type MemoryHighlightKind = "best_lap" | "overtake" | "incident" | "finish";

export interface MemoryHighlight {
  id: string;
  kind: MemoryHighlightKind;
  atMs: number;
  startMs: number;
  endMs: number;
  score: number;
  title: string;
  detail?: string;
  lapNumber?: number;
  position?: number;
}
