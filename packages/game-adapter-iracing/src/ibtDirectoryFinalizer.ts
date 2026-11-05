import { readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { AdapterTelemetryFinalizer, CanonicalRaceState } from "@lapwing/game-adapter-kit";

async function waitUntilStable(path: string, stableWindowMs: number): Promise<void> {
  let previous = -1;
  let stableSince = Date.now();
  while (Date.now() - stableSince < stableWindowMs) {
    const size = (await stat(path)).size;
    if (size !== previous) {
      previous = size;
      stableSince = Date.now();
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, Math.min(500, stableWindowMs)));
  }
}

export class IbtDirectoryFinalizer implements AdapterTelemetryFinalizer {
  constructor(
    private readonly directory: string,
    private readonly timeoutMs = 120_000,
    private readonly stableWindowMs = 2_000,
  ) {}

  async waitForTelemetry(session: CanonicalRaceState): Promise<string> {
    const deadline = Date.now() + this.timeoutMs;
    while (Date.now() < deadline) {
      const names = (await readdir(this.directory)).filter((name) => name.toLowerCase().endsWith(".ibt"));
      const candidates = await Promise.all(names.map(async (name) => {
        const path = resolve(this.directory, name);
        return { path, stats: await stat(path) };
      }));
      const newest = candidates
        .filter(({ stats }) => stats.mtimeMs >= Date.parse(session.wallClock) - 60_000)
        .sort((left, right) => right.stats.mtimeMs - left.stats.mtimeMs)[0];
      if (newest) {
        await waitUntilStable(newest.path, this.stableWindowMs);
        return newest.path;
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 500));
    }
    throw new Error(`Timed out waiting for a finalized .ibt file in ${resolve(this.directory)}`);
  }
}
