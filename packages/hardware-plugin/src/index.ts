export const HARDWARE_PLUGIN_ID = "lapwing.hardware" as const;

export const HARDWARE_CAPABILITIES = [
  "logger.ble",
  "logger.native-ble",
  "logger.mychron",
  "logger.alfano",
  "logger.phone",
  "firmware.dfu",
  "video.gopro-telemetry",
] as const;

export type HardwareCapability = (typeof HARDWARE_CAPABILITIES)[number];
