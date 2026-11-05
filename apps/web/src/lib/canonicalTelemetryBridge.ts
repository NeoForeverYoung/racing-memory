import type { CanonicalSession } from "@lapwing/telemetry-core";
import type { FieldMapping, GpsSample, ParsedData } from "@/types/racing";

/**
 * Temporary bridge for GPS-era consumers. It deliberately returns null for
 * world/track-only simulator sessions instead of fabricating coordinates.
 */
export function canonicalSessionToParsedData(session: CanonicalSession): ParsedData | null {
  if (
    session.frames.length === 0
    || session.frames.some((frame) => frame.spatial?.kind !== "geo")
  ) {
    return null;
  }

  const channelNames = new Set<string>();
  const samples: GpsSample[] = session.frames.map((frame) => {
    const spatial = frame.spatial;
    if (!spatial || spatial.kind !== "geo") {
      throw new Error("Canonical GPS bridge invariant violated.");
    }
    const speedMps = frame.channels.speed_mps ?? 0;
    const extraFields: Record<string, number> = {};
    for (const [name, value] of Object.entries(frame.channels)) {
      if (name === "speed_mps" || name === "heading_deg") continue;
      channelNames.add(name);
      extraFields[name] = value;
    }
    if (spatial.altitudeM != null) {
      channelNames.add("altitude");
      extraFields.altitude = spatial.altitudeM;
    }
    return {
      t: frame.t,
      lat: spatial.lat,
      lon: spatial.lon,
      speedMps,
      speedMph: speedMps * 2.2369362921,
      speedKph: speedMps * 3.6,
      heading: frame.channels.heading_deg,
      extraFields,
    };
  });

  const latitudes = samples.map((sample) => sample.lat);
  const longitudes = samples.map((sample) => sample.lon);
  const fieldMappings: FieldMapping[] = [...channelNames].sort().map((name, index) => ({
    index,
    name,
    enabled: true,
  }));

  return {
    samples,
    fieldMappings,
    bounds: {
      minLat: Math.min(...latitudes),
      maxLat: Math.max(...latitudes),
      minLon: Math.min(...longitudes),
      maxLon: Math.max(...longitudes),
    },
    duration: samples.at(-1)?.t ?? 0,
    startDate: session.metadata?.startedAt ? new Date(session.metadata.startedAt) : undefined,
  };
}
