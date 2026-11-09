import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanonicalRaceState } from "@lapwing/game-adapter-kit";
import { ObsWebSocketRecorder } from "./obsRecorder";

class FakeWebSocket {
  static readonly OPEN = 1;
  static instances: FakeWebSocket[] = [];
  static failedRequest: string | null = null;

  readyState = FakeWebSocket.OPEN;
  closed = false;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(_url: string) {
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => this.emit({ op: 0, d: {} }));
  }

  send(payload: string): void {
    const message = JSON.parse(payload) as {
      op: number;
      d?: { requestId?: string; requestType?: string };
    };
    if (message.op === 1) {
      queueMicrotask(() => this.emit({ op: 2, d: {} }));
      return;
    }
    if (message.op !== 6) return;
    const requestType = message.d?.requestType;
    queueMicrotask(() => this.emit({
      op: 7,
      d: {
        requestId: message.d?.requestId,
        requestStatus: FakeWebSocket.failedRequest === requestType
          ? { result: false, comment: `${requestType} failed` }
          : { result: true },
        responseData: requestType === "StopRecord" ? { outputPath: "C:\\Videos\\race.mp4" } : {},
      },
    }));
  }

  close(): void {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.();
  }

  private emit(message: object): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

const race: CanonicalRaceState = {
  game: "iracing",
  sessionId: "race-1",
  state: "green",
  sessionTimeSeconds: 20,
  wallClock: "2026-11-09T00:00:00.000Z",
  monotonicMs: 2_000,
};

describe("ObsWebSocketRecorder", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    FakeWebSocket.failedRequest = null;
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("closes the OBS socket after recording stops", async () => {
    const recorder = new ObsWebSocketRecorder();

    await recorder.start(race);
    expect(FakeWebSocket.instances[0]?.closed).toBe(false);
    await expect(recorder.stop({ ...race, state: "finished" })).resolves.toMatchObject({
      path: "C:\\Videos\\race.mp4",
    });

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0]?.closed).toBe(true);
  });

  it("closes the OBS socket when a request fails", async () => {
    FakeWebSocket.failedRequest = "StartRecord";
    const recorder = new ObsWebSocketRecorder();

    await expect(recorder.start(race)).rejects.toThrow("StartRecord failed");

    expect(FakeWebSocket.instances[0]?.closed).toBe(true);
  });
});
