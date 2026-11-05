import { createHash, randomUUID } from "node:crypto";
import type { CanonicalRaceState } from "@lapwing/game-adapter-kit";
import type { RecorderProvider, RecorderStartResult, RecorderStopResult } from "@lapwing/media";

interface ObsMessage {
  op: number;
  d?: Record<string, unknown>;
}

function obsAuth(password: string, salt: string, challenge: string): string {
  const secret = createHash("sha256").update(password + salt).digest("base64");
  return createHash("sha256").update(secret + challenge).digest("base64");
}

export class ObsWebSocketRecorder implements RecorderProvider {
  readonly id = "obs-websocket-v5";
  private socket: WebSocket | null = null;
  private pending = new Map<string, {
    resolve: (data: Record<string, unknown>) => void;
    reject: (error: Error) => void;
  }>();

  constructor(
    private readonly url = "ws://127.0.0.1:4455",
    private readonly password = "",
  ) {}

  private async connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    const socket = new WebSocket(this.url);
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("OBS WebSocket handshake timed out")), 10_000);
      socket.onerror = () => {
        clearTimeout(timeout);
        reject(new Error(`Unable to connect to OBS WebSocket at ${this.url}`));
      };
      socket.onmessage = (event) => {
        const message = JSON.parse(String(event.data)) as ObsMessage;
        if (message.op === 0) {
          const authentication = message.d?.authentication as { salt?: string; challenge?: string } | undefined;
          socket.send(JSON.stringify({
            op: 1,
            d: {
              rpcVersion: 1,
              ...(authentication?.salt && authentication.challenge
                ? { authentication: obsAuth(this.password, authentication.salt, authentication.challenge) }
                : {}),
            },
          }));
        } else if (message.op === 2) {
          clearTimeout(timeout);
          resolve();
        } else if (message.op === 7) {
          const requestId = String(message.d?.requestId ?? "");
          const waiting = this.pending.get(requestId);
          if (!waiting) return;
          this.pending.delete(requestId);
          const status = message.d?.requestStatus as { result?: boolean; comment?: string } | undefined;
          if (status?.result === false) {
            waiting.reject(new Error(status.comment ?? "OBS request failed"));
          } else {
            waiting.resolve((message.d?.responseData as Record<string, unknown>) ?? {});
          }
        }
      };
    });
  }

  private async request(type: string): Promise<Record<string, unknown>> {
    await this.connect();
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.socket!.send(JSON.stringify({
        op: 6,
        d: { requestType: type, requestId },
      }));
      setTimeout(() => {
        const waiting = this.pending.get(requestId);
        if (!waiting) return;
        this.pending.delete(requestId);
        reject(new Error(`OBS ${type} request timed out`));
      }, 15_000);
    });
  }

  async start(_race: CanonicalRaceState): Promise<RecorderStartResult> {
    await this.request("StartRecord");
    return { acknowledgedAt: new Date().toISOString() };
  }

  async stop(_race: CanonicalRaceState): Promise<RecorderStopResult> {
    const response = await this.request("StopRecord");
    const path = response.outputPath;
    if (typeof path !== "string" || path.length === 0) {
      throw new Error("OBS StopRecord did not return outputPath");
    }
    return { path, acknowledgedAt: new Date().toISOString() };
  }
}
