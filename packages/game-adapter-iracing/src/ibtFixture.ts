const HEADER_SIZE = 112;
const SUBHEADER_SIZE = 32;
const VAR_HEADER_SIZE = 144;
const T_INT = 2;
const T_FLOAT = 4;
const T_DOUBLE = 5;
const TYPE_BYTES: Record<number, number> = { [T_INT]: 4, [T_FLOAT]: 4, [T_DOUBLE]: 8 };

interface VariableDefinition {
  name: string;
  type: number;
  unit?: string;
  value: (timeSec: number) => number;
}

export interface SyntheticIbtOptions {
  durationSec: number;
  tickRate?: number;
  lapDurationSec?: number;
  startUnixSec?: number;
}

export interface SyntheticIbtFixture {
  bytes: Uint8Array;
  events: {
    firstOvertakeSec: number;
    incidentSec: number;
    secondOvertakeSec: number;
  };
}

const MAX_DURATION_SEC = 24 * 3600;
const MIN_LAP_DURATION_SEC = 5;

const roundMs = (seconds: number) => Math.round(seconds * 1000) / 1000;

/**
 * Build a small parser-compatible iRacing fixture for deterministic CLI and UI
 * testing. It models the documented .ibt subset, not a file emitted by iRacing.
 */
export function createSyntheticIbt(options: SyntheticIbtOptions): SyntheticIbtFixture {
  const durationSec = options.durationSec;
  if (!Number.isFinite(durationSec) || durationSec < 30 || durationSec > MAX_DURATION_SEC) {
    throw new Error("Synthetic .ibt duration must be between 30 seconds and 24 hours.");
  }

  const tickRate = options.tickRate ?? 10;
  if (!Number.isInteger(tickRate) || tickRate < 1 || tickRate > 60) {
    throw new Error("Synthetic .ibt tick rate must be an integer from 1 to 60.");
  }

  const lapDurationSec = options.lapDurationSec ?? Math.max(15, Math.min(60, durationSec / 4));
  // Below a few seconds the synthetic loop degenerates (NaN positions at 0).
  if (!Number.isFinite(lapDurationSec) || lapDurationSec < MIN_LAP_DURATION_SEC) {
    throw new Error(`Synthetic .ibt lap duration must be at least ${MIN_LAP_DURATION_SEC} seconds.`);
  }
  // Rounded to the tick grid's millisecond so reported event times stay clean.
  const firstOvertakeSec = roundMs(durationSec * 0.2);
  const incidentSec = roundMs(durationSec * 0.45);
  const secondOvertakeSec = roundMs(durationSec * 0.7);
  const records = Math.floor(durationSec * tickRate) + 1;

  const variables: VariableDefinition[] = [
    { name: "SessionTime", type: T_DOUBLE, unit: "s", value: (time) => time },
    {
      name: "Lat",
      type: T_DOUBLE,
      unit: "deg",
      value: (time) => 36.272 + 0.0005 * Math.cos((time / lapDurationSec) * Math.PI * 2),
    },
    {
      name: "Lon",
      type: T_DOUBLE,
      unit: "deg",
      value: (time) => -115.01 + 0.00062 * Math.sin((time / lapDurationSec) * Math.PI * 2),
    },
    { name: "Speed", type: T_FLOAT, unit: "m/s", value: (time) => 20 + 4 * Math.sin(time / 5) },
    { name: "RPM", type: T_FLOAT, unit: "rpm", value: (time) => 5200 + 900 * Math.sin(time / 3) },
    { name: "Throttle", type: T_FLOAT, unit: "%", value: (time) => 0.65 + 0.25 * Math.sin(time / 4) },
    { name: "Brake", type: T_FLOAT, unit: "%", value: (time) => Math.max(0, Math.sin(time / 7)) * 0.5 },
    { name: "Gear", type: T_INT, value: (time) => 3 + (Math.floor(time / 8) % 3) },
    { name: "LapDistPct", type: T_FLOAT, unit: "%", value: (time) => (time % lapDurationSec) / lapDurationSec },
    {
      name: "PlayerCarPosition",
      type: T_INT,
      value: (time) => time < firstOvertakeSec ? 8 : time < secondOvertakeSec ? 7 : 6,
    },
    {
      name: "PlayerCarClassPosition",
      type: T_INT,
      value: (time) => time < firstOvertakeSec ? 5 : time < secondOvertakeSec ? 4 : 3,
    },
    {
      name: "PlayerCarMyIncidentCount",
      type: T_INT,
      value: (time) => time < incidentSec ? 0 : 2,
    },
    { name: "OnPitRoad", type: T_INT, value: () => 0 },
  ];

  let rowLength = 0;
  const rowOffsets = variables.map((variable) => {
    const offset = rowLength;
    rowLength += TYPE_BYTES[variable.type];
    return offset;
  });

  const yaml = "---\nWeekendInfo:\n TrackName: synthetic-racing-memory\n...\n";
  const sessionInfoOffset = HEADER_SIZE + SUBHEADER_SIZE;
  const varHeaderOffset = sessionInfoOffset + yaml.length;
  const dataOffset = varHeaderOffset + variables.length * VAR_HEADER_SIZE;
  const buffer = new ArrayBuffer(dataOffset + records * rowLength);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  const writeAscii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index++) {
      bytes[offset + index] = text.charCodeAt(index);
    }
  };

  view.setInt32(0, 2, true);
  view.setInt32(8, tickRate, true);
  view.setInt32(16, yaml.length, true);
  view.setInt32(20, sessionInfoOffset, true);
  view.setInt32(24, variables.length, true);
  view.setInt32(28, varHeaderOffset, true);
  view.setInt32(32, 1, true);
  view.setInt32(36, rowLength, true);
  view.setInt32(48, records, true);
  view.setInt32(52, dataOffset, true);
  view.setBigInt64(HEADER_SIZE, BigInt(options.startUnixSec ?? 1_700_000_000), true);
  view.setInt32(HEADER_SIZE + 28, records, true);
  writeAscii(sessionInfoOffset, yaml);

  variables.forEach((variable, index) => {
    const header = varHeaderOffset + index * VAR_HEADER_SIZE;
    view.setInt32(header, variable.type, true);
    view.setInt32(header + 4, rowOffsets[index], true);
    view.setInt32(header + 8, 1, true);
    writeAscii(header + 16, variable.name);
    if (variable.unit) writeAscii(header + 112, variable.unit);
  });

  for (let record = 0; record < records; record++) {
    const timeSec = record / tickRate;
    const row = dataOffset + record * rowLength;
    variables.forEach((variable, index) => {
      const offset = row + rowOffsets[index];
      const value = variable.value(timeSec);
      if (variable.type === T_DOUBLE) view.setFloat64(offset, value, true);
      else if (variable.type === T_FLOAT) view.setFloat32(offset, value, true);
      else view.setInt32(offset, value, true);
    });
  }

  return {
    bytes,
    events: { firstOvertakeSec, incidentSec, secondOvertakeSec },
  };
}
