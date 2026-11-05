import { describe, expect, it } from "vitest";
import {
  F1UdpCaptureError,
  decodeF1UdpCapture,
  encodeF1UdpCapture,
  encodeF1UdpCaptureHeader,
} from "./capture";

describe("F1 UDP capture", () => {
  it("round-trips raw datagrams with their receiver timestamps", () => {
    const capture = encodeF1UdpCapture([
      { receivedAtMs: 1_735_689_600_123, bytes: new Uint8Array([1, 2, 3]) },
      { receivedAtMs: 1_735_689_600_456, bytes: new Uint8Array([0, 255]) },
    ]);

    expect(decodeF1UdpCapture(capture)).toEqual([
      { receivedAtMs: 1_735_689_600_123, bytes: new Uint8Array([1, 2, 3]) },
      { receivedAtMs: 1_735_689_600_456, bytes: new Uint8Array([0, 255]) },
    ]);
  });

  it("rejects unsupported versions and truncated records", () => {
    const unsupported = encodeF1UdpCaptureHeader();
    new DataView(unsupported.buffer).setUint16(8, 2, true);
    expect(() => decodeF1UdpCapture(unsupported)).toThrow(F1UdpCaptureError);

    const truncated = encodeF1UdpCapture([{ receivedAtMs: 1, bytes: new Uint8Array([1]) }]).slice(0, -1);
    expect(() => decodeF1UdpCapture(truncated)).toThrow("truncated UDP datagram");
  });
});
