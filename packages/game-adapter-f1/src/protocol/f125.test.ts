import { describe, expect, it } from "vitest";
import { decodeF125Packet, F125DecodeError, F125_HEADER_BYTES, F125_PACKET_LENGTHS } from "./f125";

function packet(id: number, length: number, player = 1): Uint8Array {
  const bytes = new Uint8Array(length); const view = new DataView(bytes.buffer);
  view.setUint16(0, 2025, true); view.setUint8(2, 25); view.setUint8(3, 1); view.setUint8(4, 0); view.setUint8(5, 1); view.setUint8(6, id);
  view.setBigUint64(7, 42n, true); view.setFloat32(15, 12.5, true); view.setUint32(19, 9, true); view.setUint32(23, 12, true); view.setUint8(27, player); view.setUint8(28, 255);
  return bytes;
}

describe("F1 25 UDP decoder", () => {
  it("decodes the player slice of motion, lap, and telemetry packets", () => {
    const motion = packet(0, F125_PACKET_LENGTHS.motion); let v = new DataView(motion.buffer); const motionOffset = F125_HEADER_BYTES + 60;
    v.setFloat32(motionOffset, 10, true); v.setFloat32(motionOffset + 4, 20, true); v.setFloat32(motionOffset + 8, 30, true); v.setFloat32(motionOffset + 12, 4, true); v.setFloat32(motionOffset + 16, 5, true); v.setFloat32(motionOffset + 20, 6, true); v.setFloat32(motionOffset + 36, 1.5, true);
    expect(decodeF125Packet(motion)).toMatchObject({ kind: "motion", world: { x: 10, y: 20, z: 30 }, velocity: { x: 4, y: 5, z: 6 }, gForce: { lateral: 1.5 } });

    const lap = packet(2, F125_PACKET_LENGTHS.lapData); v = new DataView(lap.buffer); const lapOffset = F125_HEADER_BYTES + 57;
    v.setUint32(lapOffset, 90_000, true); v.setUint32(lapOffset + 4, 45_000, true); v.setFloat32(lapOffset + 20, 1_234.5, true); v.setFloat32(lapOffset + 24, 12_345.5, true); v.setUint8(lapOffset + 32, 3); v.setUint8(lapOffset + 33, 7); v.setUint8(lapOffset + 34, 2); v.setUint8(lapOffset + 36, 1); v.setUint8(lapOffset + 37, 1); v.setUint8(lapOffset + 38, 5); v.setUint8(lapOffset + 44, 4); v.setUint8(lapOffset + 45, 3);
    expect(decodeF125Packet(lap)).toMatchObject({ kind: "lap", lastLapTimeMs: 90_000, currentLapTimeMs: 45_000, lapDistanceM: 1234.5, carPosition: 3, currentLap: 7, pitStatus: 2, sector: 1, currentLapInvalid: true, penaltiesS: 5, driverStatus: 4, resultStatus: 3 });

    const telemetry = packet(6, F125_PACKET_LENGTHS.carTelemetry); v = new DataView(telemetry.buffer); const telemetryOffset = F125_HEADER_BYTES + 60;
    v.setUint16(telemetryOffset, 299, true); v.setFloat32(telemetryOffset + 2, 0.75, true); v.setFloat32(telemetryOffset + 6, -0.25, true); v.setFloat32(telemetryOffset + 10, 0.5, true); v.setUint8(telemetryOffset + 14, 10); v.setInt8(telemetryOffset + 15, 7); v.setUint16(telemetryOffset + 16, 12_345, true); v.setUint8(telemetryOffset + 18, 1);
    expect(decodeF125Packet(telemetry)).toMatchObject({ kind: "telemetry", speedKph: 299, throttle: 0.75, steering: -0.25, brake: 0.5, clutch: 10, gear: 7, rpm: 12_345, drs: true });
  });

  it("decodes session, participant, and lifecycle event packet fields", () => {
    const session = packet(1, F125_PACKET_LENGTHS.session); let v = new DataView(session.buffer); v.setUint8(29, 3); v.setInt8(30, 27); v.setInt8(31, 19); v.setUint8(32, 15); v.setUint16(33, 5891, true); v.setUint8(35, 10); v.setInt8(36, 9); v.setUint8(153, 2);
    expect(decodeF125Packet(session)).toMatchObject({ kind: "session", weather: 3, trackTemperatureC: 27, airTemperatureC: 19, totalLaps: 15, trackLengthM: 5891, sessionType: 10, trackId: 9, safetyCarStatus: 2 });

    const participants = packet(4, F125_PACKET_LENGTHS.participants); v = new DataView(participants.buffer); v.setUint8(29, 20); const offset = 30 + 57; v.setUint8(offset, 0); v.setUint8(offset + 3, 4); v.setUint8(offset + 5, 44); new TextEncoder().encodeInto("Test Driver", participants.subarray(offset + 7, offset + 39));
    expect(decodeF125Packet(participants)).toMatchObject({ kind: "participants", activeCars: 20, player: { name: "Test Driver", teamId: 4, raceNumber: 44, aiControlled: false } });

    const event = packet(3, F125_PACKET_LENGTHS.event); event.set(new TextEncoder().encode("LGOT"), 29); expect(decodeF125Packet(event)).toMatchObject({ kind: "event", code: "LGOT" });
  });

  it("rejects a short, foreign, or unsupported packet before mapping fields", () => {
    expect(() => decodeF125Packet(new Uint8Array(4))).toThrow(F125DecodeError);
    const foreign = packet(6, F125_PACKET_LENGTHS.carTelemetry); new DataView(foreign.buffer).setUint16(0, 2026, true); expect(() => decodeF125Packet(foreign)).toThrow("Unsupported F1 protocol");
    const unknown = packet(5, 1133); expect(() => decodeF125Packet(unknown)).toThrow("Unsupported F1 25 packet id");
  });
});
