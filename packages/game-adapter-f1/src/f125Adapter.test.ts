import { describe, expect, it } from "vitest";
import { encodeF1UdpCapture } from "./capture";
import { parseF125Capture } from "./f125Adapter";
import { F125_PACKET_LENGTHS } from "./protocol/f125";

function packet(id: number, length: number): Uint8Array {
  const b = new Uint8Array(length); const v = new DataView(b.buffer);
  v.setUint16(0, 2025, true); v.setUint8(2, 25); v.setUint8(5, 1); v.setUint8(6, id); v.setBigUint64(7, 88n, true); v.setUint32(23, 7, true); v.setUint8(27, 0); v.setUint8(28, 255); return b;
}

describe("F1 25 canonical adapter", () => {
  it("merges documented packet fields without manufacturing GPS", () => {
    const session = packet(1, F125_PACKET_LENGTHS.session); let v = new DataView(session.buffer); v.setUint16(33, 5000, true);
    const motion = packet(0, F125_PACKET_LENGTHS.motion); v = new DataView(motion.buffer); v.setFloat32(29, 1, true); v.setFloat32(33, 2, true); v.setFloat32(37, 3, true);
    const telemetry = packet(6, F125_PACKET_LENGTHS.carTelemetry); v = new DataView(telemetry.buffer); v.setUint16(29, 180, true); v.setFloat32(31, 1, true); v.setInt8(44, 5); v.setUint16(45, 10_000, true);
    const lap = packet(2, F125_PACKET_LENGTHS.lapData); v = new DataView(lap.buffer); v.setFloat32(49, 2500, true); v.setUint8(61, 2); v.setUint8(62, 3);
    const parsed = parseF125Capture(encodeF1UdpCapture([{ receivedAtMs: 1000, bytes: session }, { receivedAtMs: 1000, bytes: motion }, { receivedAtMs: 1000, bytes: telemetry }, { receivedAtMs: 1000, bytes: lap }]));
    expect(parsed.capabilities).not.toContain("telemetry.geo");
    expect(parsed.frames).toEqual([expect.objectContaining({ spatial: { kind: "world", x: 1, y: 2, z: 3 }, channels: expect.objectContaining({ speed_mps: 50, rpm: 10_000, track_progress: 0.5, race_position: 2, current_lap: 3 }) })]);
  });
});
