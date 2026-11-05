/** Legacy GPS model retained while Web consumers migrate to CanonicalSession. */
export interface GpsSample {
  t: number;
  lat: number;
  lon: number;
  speedMps: number;
  speedMph: number;
  speedKph: number;
  heading?: number;
  rawNmea?: string;
  extraFields: Record<string, number>;
}

export interface FieldMapping {
  index: number;
  name: string;
  label?: string;
  unit?: string;
  enabled: boolean;
}

export interface ParserStats {
  totalRows: number;
  acceptedRows: number;
  rejected: {
    nanFields: number;
    zeroCoords: number;
    outOfRange: number;
    speedCap: number;
    teleportation: number;
    incompleteRow: number;
    lowQuality: number;
  };
}

export interface ParsedData {
  samples: GpsSample[];
  fieldMappings: FieldMapping[];
  bounds: {
    minLat: number;
    maxLat: number;
    minLon: number;
    maxLon: number;
  };
  duration: number;
  startDate?: Date;
  parserStats?: ParserStats;
}
