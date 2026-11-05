/**
 * EA SPORTS F1 25 UDP data output structures (2025), packet layout v1.
 * Source: https://forums.ea.com/t5/s/tghpe58374/attachments/tghpe58374/f1-games-game-info-hub-en/61/5/F1%2025%20Telemetry%20Output%20Structures.txt
 */
export const F125_PACKET_FORMAT = 2025;
export const F125_GAME_YEAR = 25;
export const F125_HEADER_BYTES = 29;

export const F125_PACKET_LENGTHS = {
  motion: 1349,
  session: 753,
  lapData: 1285,
  event: 45,
  participants: 1284,
  carTelemetry: 1352,
} as const;

export type F125PacketId = 0 | 1 | 2 | 3 | 4 | 6;

export interface F125Header {
  packetFormat: number;
  gameYear: number;
  gameMajorVersion: number;
  gameMinorVersion: number;
  packetVersion: number;
  packetId: F125PacketId;
  sessionUid: bigint;
  sessionTimeS: number;
  frameIdentifier: number;
  overallFrameIdentifier: number;
  playerCarIndex: number;
  secondaryPlayerCarIndex: number;
}

export interface F125MotionPacket { kind: "motion"; header: F125Header; world: { x: number; y: number; z: number }; velocity: { x: number; y: number; z: number }; gForce: { lateral: number; longitudinal: number; vertical: number } }
export interface F125SessionPacket { kind: "session"; header: F125Header; weather: number; trackTemperatureC: number; airTemperatureC: number; totalLaps: number; trackLengthM: number; sessionType: number; trackId: number; safetyCarStatus: number }
export interface F125LapPacket { kind: "lap"; header: F125Header; lastLapTimeMs: number; currentLapTimeMs: number; lapDistanceM: number; totalDistanceM: number; carPosition: number; currentLap: number; pitStatus: number; sector: number; currentLapInvalid: boolean; penaltiesS: number; driverStatus: number; resultStatus: number }
export interface F125EventPacket { kind: "event"; header: F125Header; code: string }
export interface F125ParticipantsPacket { kind: "participants"; header: F125Header; activeCars: number; player: { name: string; teamId: number; raceNumber: number; aiControlled: boolean } }
export interface F125TelemetryPacket { kind: "telemetry"; header: F125Header; speedKph: number; throttle: number; steering: number; brake: number; clutch: number; gear: number; rpm: number; drs: boolean }
export type F125Packet = F125MotionPacket | F125SessionPacket | F125LapPacket | F125EventPacket | F125ParticipantsPacket | F125TelemetryPacket;

export class F125DecodeError extends Error { constructor(message: string) { super(message); this.name = "F125DecodeError"; } }

class Reader {
  private offset = 0;
  private readonly view: DataView;
  constructor(private readonly bytes: Uint8Array) { this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
  get position(): number { return this.offset; }
  seek(position: number): void { if (position < 0 || position > this.bytes.byteLength) throw new F125DecodeError("Packet field exceeds datagram length."); this.offset = position; }
  u8(): number { this.need(1); return this.view.getUint8(this.offset++); }
  i8(): number { this.need(1); return this.view.getInt8(this.offset++); }
  u16(): number { this.need(2); const value = this.view.getUint16(this.offset, true); this.offset += 2; return value; }
  u32(): number { this.need(4); const value = this.view.getUint32(this.offset, true); this.offset += 4; return value; }
  u64(): bigint { this.need(8); const value = this.view.getBigUint64(this.offset, true); this.offset += 8; return value; }
  f32(): number { this.need(4); const value = this.view.getFloat32(this.offset, true); this.offset += 4; if (!Number.isFinite(value)) throw new F125DecodeError("Packet contains a non-finite floating point value."); return value; }
  ascii(length: number): string { this.need(length); const part = this.bytes.subarray(this.offset, this.offset + length); this.offset += length; const zero = part.indexOf(0); return new TextDecoder().decode(zero < 0 ? part : part.subarray(0, zero)); }
  private need(length: number): void { if (this.offset + length > this.bytes.byteLength) throw new F125DecodeError("Packet field exceeds datagram length."); }
}

function expectLength(bytes: Uint8Array, expected: number): void { if (bytes.byteLength !== expected) throw new F125DecodeError(`F1 25 packet length ${bytes.byteLength} does not match expected ${expected}.`); }
function header(reader: Reader): F125Header {
  const packetFormat = reader.u16(); const gameYear = reader.u8(); const gameMajorVersion = reader.u8(); const gameMinorVersion = reader.u8(); const packetVersion = reader.u8(); const id = reader.u8();
  if (packetFormat !== F125_PACKET_FORMAT || gameYear !== F125_GAME_YEAR) throw new F125DecodeError(`Unsupported F1 protocol ${packetFormat}/${gameYear}; expected 2025/25.`);
  if (packetVersion !== 1) throw new F125DecodeError(`Unsupported F1 25 packet version ${packetVersion}.`);
  if (![0, 1, 2, 3, 4, 6].includes(id)) throw new F125DecodeError(`Unsupported F1 25 packet id ${id}.`);
  return { packetFormat, gameYear, gameMajorVersion, gameMinorVersion, packetVersion, packetId: id as F125PacketId, sessionUid: reader.u64(), sessionTimeS: reader.f32(), frameIdentifier: reader.u32(), overallFrameIdentifier: reader.u32(), playerCarIndex: reader.u8(), secondaryPlayerCarIndex: reader.u8() };
}
function playerOffset(h: F125Header, base: number, size: number): number { if (h.playerCarIndex >= 22) throw new F125DecodeError(`Invalid player car index ${h.playerCarIndex}.`); return base + h.playerCarIndex * size; }

export function decodeF125Packet(input: ArrayBuffer | Uint8Array): F125Packet {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input); const reader = new Reader(bytes); const h = header(reader);
  switch (h.packetId) {
    case 0: { expectLength(bytes, F125_PACKET_LENGTHS.motion); reader.seek(playerOffset(h, F125_HEADER_BYTES, 60)); const world = { x: reader.f32(), y: reader.f32(), z: reader.f32() }; const velocity = { x: reader.f32(), y: reader.f32(), z: reader.f32() }; reader.seek(reader.position + 12); const gForce = { lateral: reader.f32(), longitudinal: reader.f32(), vertical: reader.f32() }; return { kind: "motion", header: h, world, velocity, gForce }; }
    case 1: { expectLength(bytes, F125_PACKET_LENGTHS.session); const weather = reader.u8(); const trackTemperatureC = reader.i8(); const airTemperatureC = reader.i8(); const totalLaps = reader.u8(); const trackLengthM = reader.u16(); const sessionType = reader.u8(); const trackId = reader.i8(); reader.seek(F125_HEADER_BYTES + 124); const safetyCarStatus = reader.u8(); return { kind: "session", header: h, weather, trackTemperatureC, airTemperatureC, totalLaps, trackLengthM, sessionType, trackId, safetyCarStatus }; }
    case 2: { expectLength(bytes, F125_PACKET_LENGTHS.lapData); reader.seek(playerOffset(h, F125_HEADER_BYTES, 57)); const lastLapTimeMs = reader.u32(); const currentLapTimeMs = reader.u32(); reader.seek(reader.position + 12); const lapDistanceM = reader.f32(); const totalDistanceM = reader.f32(); reader.seek(reader.position + 4); const carPosition = reader.u8(); const currentLap = reader.u8(); const pitStatus = reader.u8(); reader.seek(reader.position + 1); const sector = reader.u8(); const currentLapInvalid = reader.u8() === 1; const penaltiesS = reader.u8(); reader.seek(reader.position + 5); const driverStatus = reader.u8(); const resultStatus = reader.u8(); return { kind: "lap", header: h, lastLapTimeMs, currentLapTimeMs, lapDistanceM, totalDistanceM, carPosition, currentLap, pitStatus, sector, currentLapInvalid, penaltiesS, driverStatus, resultStatus }; }
    case 3: { expectLength(bytes, F125_PACKET_LENGTHS.event); return { kind: "event", header: h, code: reader.ascii(4) }; }
    case 4: { expectLength(bytes, F125_PACKET_LENGTHS.participants); const activeCars = reader.u8(); reader.seek(playerOffset(h, F125_HEADER_BYTES + 1, 57)); const aiControlled = reader.u8() === 1; reader.seek(reader.position + 2); const teamId = reader.u8(); reader.seek(reader.position + 1); const raceNumber = reader.u8(); reader.seek(reader.position + 1); const name = reader.ascii(32); return { kind: "participants", header: h, activeCars, player: { name, teamId, raceNumber, aiControlled } }; }
    case 6: { expectLength(bytes, F125_PACKET_LENGTHS.carTelemetry); reader.seek(playerOffset(h, F125_HEADER_BYTES, 60)); const speedKph = reader.u16(); const throttle = reader.f32(); const steering = reader.f32(); const brake = reader.f32(); const clutch = reader.u8(); const gear = reader.i8(); const rpm = reader.u16(); const drs = reader.u8() === 1; return { kind: "telemetry", header: h, speedKph, throttle, steering, brake, clutch, gear, rpm, drs }; }
  }
}
