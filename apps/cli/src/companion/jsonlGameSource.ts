import { readFile } from "node:fs/promises";
import { parseRaceLifecycleEvent, type CanonicalRaceState } from "@lapwing/game-adapter-kit";
import type { GameSource } from "@lapwing/game-adapter-kit";

/**
 * Reads lifecycle events emitted by a Windows IRSDK process. Keeping shared
 * memory access out of the portable CLI lets the same downstream capture and
 * analysis pipeline support other games through the canonical event contract.
 */
export class JsonlGameSource implements GameSource {
  readonly id: string;

  constructor(
    private readonly path: string,
    game = "iracing",
  ) {
    this.id = game;
  }

  async *events(): AsyncIterable<CanonicalRaceState> {
    let consumed = 0;
    let partial = "";
    while (true) {
      let content: string;
      try {
        content = await readFile(this.path, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }
      if (content.length < consumed) {
        consumed = 0;
        partial = "";
      }
      const appended = content.slice(consumed);
      consumed = content.length;
      const lines = `${partial}${appended}`.split(/\r?\n/);
      partial = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = parseRaceLifecycleEvent(line);
        yield event;
        if (event.state === "finished") return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}
