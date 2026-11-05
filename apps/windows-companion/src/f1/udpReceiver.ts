import { randomUUID } from "node:crypto";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import dgram from "node:dgram";
import {
  encodeF1UdpCaptureHeader,
  encodeF1UdpCaptureRecord,
  type F1UdpDatagram,
} from "@lapwing/game-adapter-f1/capture";

export interface F1UdpReceiverOptions {
  port: number;
  bindAddress?: string;
  allowedSenders?: readonly string[];
  capturePath: string;
}

export interface F1UdpReceiverStats {
  received: number;
  rejected: number;
  bytes: number;
}

/**
 * Captures raw F1 UDP datagrams without interpreting them. Decoder selection is
 * deliberately deferred until a documented packet layout has a golden fixture.
 */
export class F1UdpReceiver {
  private readonly queue: F1UdpDatagram[] = [];
  private readonly waiters: Array<(result: IteratorResult<F1UdpDatagram>) => void> = [];
  private readonly allowedSenders: ReadonlySet<string>;
  private readonly socket = dgram.createSocket("udp4");
  private file: Awaited<ReturnType<typeof open>> | undefined;
  private temporaryPath: string | undefined;
  private started = false;
  private stopped = false;
  private writeChain: Promise<void> = Promise.resolve();
  private finishPromise: Promise<void> | undefined;
  private boundPort: number | undefined;
  private readonly values: F1UdpReceiverStats = { received: 0, rejected: 0, bytes: 0 };

  constructor(private readonly options: F1UdpReceiverOptions) {
    if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65_535) {
      throw new Error("F1 UDP receiver port must be an integer between 0 and 65535.");
    }
    this.allowedSenders = new Set(options.allowedSenders ?? []);
  }

  get stats(): Readonly<F1UdpReceiverStats> {
    return { ...this.values };
  }

  get port(): number | undefined {
    return this.boundPort;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await mkdir(dirname(this.options.capturePath), { recursive: true });
    this.temporaryPath = `${this.options.capturePath}.${randomUUID()}.partial`;
    this.file = await open(this.temporaryPath, "wx");
    await this.file.write(encodeF1UdpCaptureHeader());
    this.socket.on("message", (message, remote) => this.receive(new Uint8Array(message), remote.address));
    this.socket.on("error", (error) => { void this.finish(error).catch(() => undefined); });
    await new Promise<void>((resolve, reject) => {
      this.socket.once("error", reject);
      this.socket.bind(this.options.port, this.options.bindAddress ?? "127.0.0.1", resolve);
    });
    this.boundPort = this.socket.address().port;
  }

  async stop(): Promise<void> {
    await this.finish();
  }

  async *events(): AsyncIterable<F1UdpDatagram> {
    if (!this.started) await this.start();
    while (true) {
      const datagram = this.queue.shift();
      if (datagram) {
        yield datagram;
        continue;
      }
      if (this.stopped) return;
      const result = await new Promise<IteratorResult<F1UdpDatagram>>((resolve) => this.waiters.push(resolve));
      if (result.done) return;
      yield result.value;
    }
  }

  private receive(bytes: Uint8Array, sender: string): void {
    if (this.allowedSenders.size > 0 && !this.allowedSenders.has(sender)) {
      this.values.rejected += 1;
      return;
    }
    const datagram: F1UdpDatagram = { receivedAtMs: Date.now(), bytes: Uint8Array.from(bytes) };
    this.values.received += 1;
    this.values.bytes += bytes.byteLength;
    this.writeChain = this.writeChain.then(async () => {
      await this.file?.write(encodeF1UdpCaptureRecord(datagram));
    });
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: datagram, done: false });
    else this.queue.push(datagram);
  }

  private finish(error?: Error): Promise<void> {
    if (this.finishPromise) return this.finishPromise;
    this.finishPromise = this.finishInternal(error);
    return this.finishPromise;
  }

  private async finishInternal(error?: Error): Promise<void> {
    this.stopped = true;
    try {
      this.socket.close();
    } catch {
      // A bind failure can emit before the socket is running.
    }
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true });
    try {
      await this.writeChain;
      await this.file?.sync();
      await this.file?.close();
      if (error) throw error;
      if (this.temporaryPath) await rename(this.temporaryPath, this.options.capturePath);
    } catch (cause) {
      await this.file?.close().catch(() => undefined);
      if (this.temporaryPath) await unlink(this.temporaryPath).catch(() => undefined);
      throw cause;
    }
  }
}
