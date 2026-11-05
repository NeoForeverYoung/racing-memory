import dgram from "node:dgram";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeF1UdpCapture } from "@lapwing/game-adapter-f1/capture";
import { F1UdpReceiver } from "./udpReceiver";

function send(port: number, bytes: Uint8Array): Promise<void> {
  const socket = dgram.createSocket("udp4");
  return new Promise((resolve, reject) => {
    socket.send(bytes, port, "127.0.0.1", (error) => {
      socket.close();
      if (error) reject(error);
      else resolve();
    });
  });
}

describe("F1UdpReceiver", () => {
  it("defaults to loopback, streams a raw datagram, and atomically finalizes its capture", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lapwing-f1-"));
    const capturePath = join(directory, "practice.f1udp");
    const receiver = new F1UdpReceiver({ port: 0, capturePath });
    const events = receiver.events()[Symbol.asyncIterator]();
    const nextEvent = events.next();
    for (let attempts = 0; receiver.port == null && attempts < 20; attempts += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
    }
    expect(receiver.port).toBeTypeOf("number");

    await send(receiver.port!, new Uint8Array([0x10, 0x20]));
    expect(await nextEvent).toMatchObject({ value: { bytes: new Uint8Array([0x10, 0x20]) }, done: false });
    await receiver.stop();
    expect(await events.next()).toEqual({ value: undefined, done: true });

    const capture = decodeF1UdpCapture(await readFile(capturePath));
    expect(capture).toHaveLength(1);
    expect(capture[0]?.bytes).toEqual(new Uint8Array([0x10, 0x20]));
    expect(receiver.stats).toMatchObject({ received: 1, rejected: 0, bytes: 2 });
  });
});
