import type { MemoryHighlight } from "@lapwing/telemetry-core";

export interface StorySegment {
  startMs: number;
  endMs: number;
  highlightIds: string[];
  kinds: MemoryHighlight["kind"][];
  score: number;
}

export interface RejectedHighlight {
  highlightId: string;
  reason: "duration-budget" | "duplicate-window" | "outside-video";
}

export interface MemoryStoryPlan {
  targetDurationMs: number;
  actualDurationMs: number;
  segments: StorySegment[];
  rejected: RejectedHighlight[];
}

function duration(segments: StorySegment[]): number {
  return segments.reduce((total, segment) => total + segment.endMs - segment.startMs, 0);
}

function mergeSegments(segments: StorySegment[]): StorySegment[] {
  const ordered = [...segments].sort((left, right) => left.startMs - right.startMs);
  const merged: StorySegment[] = [];
  for (const segment of ordered) {
    const previous = merged.at(-1);
    if (!previous || segment.startMs > previous.endMs) {
      merged.push({ ...segment, highlightIds: [...segment.highlightIds], kinds: [...segment.kinds] });
      continue;
    }
    previous.endMs = Math.max(previous.endMs, segment.endMs);
    previous.score = Math.max(previous.score, segment.score);
    previous.highlightIds.push(...segment.highlightIds.filter((id) => !previous.highlightIds.includes(id)));
    previous.kinds.push(...segment.kinds.filter((kind) => !previous.kinds.includes(kind)));
  }
  return merged;
}

function candidate(highlight: MemoryHighlight): StorySegment {
  return {
    startMs: highlight.startMs,
    endMs: highlight.endMs,
    highlightIds: [highlight.id],
    kinds: [highlight.kind],
    score: highlight.score,
  };
}

export function planMemoryStory(
  highlights: MemoryHighlight[],
  targetDurationMs: number,
): MemoryStoryPlan {
  if (!Number.isFinite(targetDurationMs) || targetDurationMs <= 0) {
    throw new Error("targetDurationMs must be greater than 0.");
  }
  const selected: StorySegment[] = [];
  const rejected: RejectedHighlight[] = [];
  const seenKinds = new Set<MemoryHighlight["kind"]>();
  const remaining = [...highlights];

  while (remaining.length > 0) {
    remaining.sort((left, right) => {
      const leftDiversity = seenKinds.has(left.kind) ? 0 : 25;
      const rightDiversity = seenKinds.has(right.kind) ? 0 : 25;
      return right.score + rightDiversity - (left.score + leftDiversity) || left.atMs - right.atMs;
    });
    const highlight = remaining.shift()!;
    const before = mergeSegments(selected);
    const after = mergeSegments([...selected, candidate(highlight)]);
    const added = duration(after) - duration(before);
    if (added <= 0) {
      rejected.push({ highlightId: highlight.id, reason: "duplicate-window" });
      continue;
    }
    if (duration(after) <= targetDurationMs) {
      selected.push(candidate(highlight));
      seenKinds.add(highlight.kind);
    } else {
      rejected.push({ highlightId: highlight.id, reason: "duration-budget" });
    }
  }

  if (selected.length === 0 && highlights.length > 0) {
    const best = [...highlights].sort((a, b) => b.score - a.score)[0];
    const half = targetDurationMs / 2;
    selected.push({
      ...candidate(best),
      startMs: Math.max(best.startMs, best.atMs - half),
      endMs: Math.min(best.endMs, best.atMs + half),
    });
    const index = rejected.findIndex((item) => item.highlightId === best.id);
    if (index >= 0) rejected.splice(index, 1);
  }

  const segments = mergeSegments(selected);
  return {
    targetDurationMs,
    actualDurationMs: duration(segments),
    segments,
    rejected,
  };
}
