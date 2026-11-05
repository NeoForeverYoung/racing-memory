export type ChannelId =
  | "altitude" | "satellites" | "hdop" | "h_acc" | "v_acc" | "speed_acc"
  | "lat_g" | "lon_g" | "lat_g_native" | "lon_g_native"
  | "accel_x" | "accel_y" | "accel_z" | "yaw_rate"
  | "rpm" | "water_temp" | "oil_temp" | "egt" | "temp_1" | "temp_2"
  | "throttle" | "brake" | "distance"
  | "race_position" | "race_class_position" | "race_incidents"
  | "race_on_pit_road" | "lap_dist_pct";

export interface ChannelDef {
  id: ChannelId;
  label: string;
  unit?: string;
  aliases: string[];
}

export const CHANNELS: readonly ChannelDef[] = [
  { id: "altitude", label: "Altitude", unit: "m", aliases: ["Altitude (m)", "Alt", "Altitude M"] },
  { id: "satellites", label: "Satellites", aliases: ["Sats", "NumSats"] },
  { id: "hdop", label: "HDOP", aliases: ["Hdop"] },
  { id: "h_acc", label: "H Accuracy", unit: "m", aliases: ["H Accuracy (m)", "H Acc M", "Horizontal Accuracy"] },
  { id: "v_acc", label: "V Accuracy", unit: "m", aliases: ["V Accuracy (m)", "V Acc M", "Vertical Accuracy"] },
  { id: "speed_acc", label: "Speed Accuracy", unit: "m/s", aliases: ["Speed Acc (m/s)", "Speed Acc"] },
  { id: "lat_g", label: "Lat G", unit: "g", aliases: ["Lateral G", "LatG"] },
  { id: "lon_g", label: "Lon G", unit: "g", aliases: ["Longitudinal G", "LonG"] },
  { id: "lat_g_native", label: "Lat G (Native)", unit: "g", aliases: [] },
  { id: "lon_g_native", label: "Lon G (Native)", unit: "g", aliases: [] },
  { id: "accel_x", label: "Accel X", aliases: [] },
  { id: "accel_y", label: "Accel Y", aliases: [] },
  { id: "accel_z", label: "Accel Z", aliases: [] },
  { id: "yaw_rate", label: "Yaw Rate", unit: "°/s", aliases: [] },
  { id: "rpm", label: "RPM", aliases: ["Rpm", "Engine RPM", "Engine_RPM"] },
  { id: "water_temp", label: "Water Temp", unit: "°C", aliases: ["Water Temperature", "Coolant Temp"] },
  { id: "oil_temp", label: "Oil Temp", unit: "°C", aliases: ["Oil Temperature"] },
  { id: "egt", label: "EGT", unit: "°C", aliases: ["Exhaust Temp", "Exhaust Gas Temp"] },
  { id: "temp_1", label: "Temp 1", unit: "°C", aliases: [] },
  { id: "temp_2", label: "Temp 2", unit: "°C", aliases: [] },
  { id: "throttle", label: "Throttle", unit: "%", aliases: ["TPS", "Throttle Position"] },
  { id: "brake", label: "Brake", aliases: ["Brake Pressure"] },
  { id: "distance", label: "Distance", unit: "m", aliases: [] },
  { id: "race_position", label: "Race Position", aliases: ["Player Position"] },
  { id: "race_class_position", label: "Class Position", aliases: ["Player Class Position"] },
  { id: "race_incidents", label: "Incidents", aliases: ["Incident Count"] },
  { id: "race_on_pit_road", label: "On Pit Road", aliases: [] },
  { id: "lap_dist_pct", label: "Lap Distance", unit: "%", aliases: ["Lap Dist %"] },
];

const byId = new Map<ChannelId, ChannelDef>(CHANNELS.map((channel) => [channel.id, channel]));
const byName = new Map<string, ChannelId>();
for (const channel of CHANNELS) {
  for (const name of [channel.label, ...channel.aliases]) {
    if (!byName.has(name.toLowerCase())) byName.set(name.toLowerCase(), channel.id);
  }
}

export const getChannelDef = (id: ChannelId): ChannelDef | undefined => byId.get(id);
export const isKnownChannel = (id: string): id is ChannelId => byId.has(id as ChannelId);
export const resolveChannelId = (name: string): ChannelId | undefined => byName.get(name.trim().toLowerCase());
export const channelLabel = (id: ChannelId): string => byId.get(id)?.label ?? id;
export const channelUnit = (id: ChannelId): string | undefined => byId.get(id)?.unit;
