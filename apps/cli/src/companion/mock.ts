import type {
  AdapterTelemetryFinalizer as TelemetryFinalizer,
  CanonicalRaceState,
  GameSource,
} from "@lapwing/game-adapter-kit";
import type {
  RecorderProvider,
  RecorderStartResult,
  RecorderStopResult,
} from "@lapwing/media";

export class MockIracingSource implements GameSource {
  readonly id = "iracing";

  constructor(
    private readonly metadata: Partial<CanonicalRaceState> = {},
    private readonly intervalMs = 0,
  ) {}

  async *events(): AsyncIterable<CanonicalRaceState> {
    const states = [
      { state: "connecting" as const, sessionTimeSeconds: 0 },
      { state: "live" as const, sessionTimeSeconds: 10 },
      { state: "green" as const, sessionTimeSeconds: 20 },
      { state: "finished" as const, sessionTimeSeconds: 140 },
    ];
    const base = Date.now();
    for (const [index, item] of states.entries()) {
      if (this.intervalMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.intervalMs));
      }
      yield {
        game: "iracing",
        sessionId: "mock-session",
        wallClock: new Date(base + index * 1_000).toISOString(),
        monotonicMs: index * 1_000,
        ...this.metadata,
        ...item,
      };
    }
  }
}

export class MockRecorder implements RecorderProvider {
  readonly id = "mock-obs";

  constructor(private readonly videoPath: string) {}

  async start(): Promise<RecorderStartResult> {
    return { acknowledgedAt: new Date().toISOString() };
  }

  async stop(): Promise<RecorderStopResult> {
    return { path: this.videoPath, acknowledgedAt: new Date().toISOString() };
  }
}

export class FixedTelemetryFinalizer implements TelemetryFinalizer {
  constructor(private readonly telemetryPath: string) {}

  async waitForTelemetry(): Promise<string> {
    return this.telemetryPath;
  }
}
