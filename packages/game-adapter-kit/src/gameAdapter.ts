import type {
  CanonicalSession,
  GameCapability,
  SessionBundleMetadata,
} from "@lapwing/telemetry-core";
import type { CanonicalRaceState } from "./companionProtocol";

export interface TelemetryInput {
  name: string;
  extension?: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface FinalizeContext {
  outputDirectory: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface FinalizedTelemetry {
  path: string;
  finalizedAt: string;
}

export interface AdapterTelemetryFinalizer {
  waitForTelemetry(session: CanonicalRaceState): Promise<string>;
}

export interface AdapterVenue {
  id?: string;
  track?: string;
  course?: string;
  lengthM?: number;
}

export interface AdapterTimingProvider {
  readonly kind: "game" | "geometry";
}

export interface GameAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: readonly GameCapability[];
  detectFile?(input: TelemetryInput): boolean | Promise<boolean>;
  parseFile?(input: TelemetryInput): Promise<CanonicalSession>;
  watchLifecycle?(): AsyncIterable<CanonicalRaceState>;
  finalizeTelemetry?(
    race: CanonicalRaceState,
    context: FinalizeContext,
  ): Promise<FinalizedTelemetry>;
  readMetadata?(input: TelemetryInput): Promise<SessionBundleMetadata>;
  venueProvider?(metadata: SessionBundleMetadata): AdapterVenue | Promise<AdapterVenue>;
  timingProvider?: AdapterTimingProvider;
}

export interface GameSource {
  readonly id: string;
  events(): AsyncIterable<CanonicalRaceState>;
}

