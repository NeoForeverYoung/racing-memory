export const SESSION_BUNDLE_SCHEMA_VERSION = 1 as const;

export type SyncConfidence = "high" | "medium" | "low";

export interface SessionSyncAnchor {
  sessionMs: number;
  videoSec: number;
  source: "companion-start" | "companion-stop" | "manual" | "file-time";
  wallClock?: string;
}

export interface SessionSync {
  syncOffsetMs: number;
  syncRate: number;
  confidence: SyncConfidence;
  evidence: string[];
  requiresReview: boolean;
  anchors: SessionSyncAnchor[];
}

export interface SessionBundleFile {
  path: string;
  finalizedAt?: string;
  sha256?: string;
  sizeBytes?: number;
}

export interface SessionBundleVideo extends SessionBundleFile {
  startedAt?: string;
  durationSec?: number;
}

export interface SessionBundleMetadata {
  driver?: string;
  vehicle?: string;
  track?: string;
  course?: string;
  sessionType?: string;
}

export interface SessionBundleLifecycle {
  joinedAt?: string;
  greenAt?: string;
  finishedAt?: string;
}

export interface SessionBundleV1 {
  schemaVersion: typeof SESSION_BUNDLE_SCHEMA_VERSION;
  sessionId: string;
  game: string;
  createdAt: string;
  telemetry: SessionBundleFile;
  videos: SessionBundleVideo[];
  lifecycle: SessionBundleLifecycle;
  sync?: SessionSync;
  metadata?: SessionBundleMetadata;
  provenance?: {
    producer: string;
    producerVersion?: string;
    captureConfig?: string;
  };
  warnings?: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validateFile(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object.`);
    return;
  }
  if (typeof value.path !== "string" || value.path.trim() === "") {
    errors.push(`${path}.path must be a non-empty string.`);
  }
  if (value.finalizedAt != null && !validIsoDate(value.finalizedAt)) {
    errors.push(`${path}.finalizedAt must be an ISO date.`);
  }
  if (value.sha256 != null && (typeof value.sha256 !== "string" || !/^sha256:[a-f0-9]{64}$/i.test(value.sha256))) {
    errors.push(`${path}.sha256 must use the sha256:<64 hex> form.`);
  }
  if (value.sizeBytes != null && (!validFinite(value.sizeBytes) || value.sizeBytes < 0)) {
    errors.push(`${path}.sizeBytes must be a non-negative number.`);
  }
}

function validateSync(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("sync must be an object.");
    return;
  }
  if (!validFinite(value.syncOffsetMs)) errors.push("sync.syncOffsetMs must be finite.");
  if (!validFinite(value.syncRate) || value.syncRate <= 0) errors.push("sync.syncRate must be greater than 0.");
  if (!["high", "medium", "low"].includes(String(value.confidence))) {
    errors.push("sync.confidence must be high, medium, or low.");
  }
  if (typeof value.requiresReview !== "boolean") errors.push("sync.requiresReview must be boolean.");
  if (!Array.isArray(value.evidence) || value.evidence.some((item) => typeof item !== "string")) {
    errors.push("sync.evidence must be a string array.");
  }
  if (!Array.isArray(value.anchors)) {
    errors.push("sync.anchors must be an array.");
  } else {
    value.anchors.forEach((anchor, index) => {
      if (!isRecord(anchor)) {
        errors.push(`sync.anchors[${index}] must be an object.`);
        return;
      }
      if (!validFinite(anchor.sessionMs)) errors.push(`sync.anchors[${index}].sessionMs must be finite.`);
      if (!validFinite(anchor.videoSec)) errors.push(`sync.anchors[${index}].videoSec must be finite.`);
      if (!["companion-start", "companion-stop", "manual", "file-time"].includes(String(anchor.source))) {
        errors.push(`sync.anchors[${index}].source is unsupported.`);
      }
      if (anchor.wallClock != null && !validIsoDate(anchor.wallClock)) {
        errors.push(`sync.anchors[${index}].wallClock must be an ISO date.`);
      }
    });
  }
}

export function validateSessionBundle(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ["bundle must be an object."];
  if (value.schemaVersion !== SESSION_BUNDLE_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${SESSION_BUNDLE_SCHEMA_VERSION}.`);
  }
  if (typeof value.sessionId !== "string" || value.sessionId.trim() === "") {
    errors.push("sessionId must be a non-empty string.");
  }
  if (typeof value.game !== "string" || value.game.trim() === "") {
    errors.push("game must be a non-empty string.");
  }
  if (!validIsoDate(value.createdAt)) errors.push("createdAt must be an ISO date.");
  validateFile(value.telemetry, "telemetry", errors);
  if (!Array.isArray(value.videos)) {
    errors.push("videos must be an array.");
  } else {
    value.videos.forEach((video, index) => {
      validateFile(video, `videos[${index}]`, errors);
      if (isRecord(video)) {
        if (video.startedAt != null && !validIsoDate(video.startedAt)) {
          errors.push(`videos[${index}].startedAt must be an ISO date.`);
        }
        if (video.durationSec != null && (!validFinite(video.durationSec) || video.durationSec <= 0)) {
          errors.push(`videos[${index}].durationSec must be greater than 0.`);
        }
      }
    });
  }
  if (!isRecord(value.lifecycle)) {
    errors.push("lifecycle must be an object.");
  } else {
    for (const key of ["joinedAt", "greenAt", "finishedAt"] as const) {
      if (value.lifecycle[key] != null && !validIsoDate(value.lifecycle[key])) {
        errors.push(`lifecycle.${key} must be an ISO date.`);
      }
    }
  }
  if (value.metadata != null) {
    if (!isRecord(value.metadata)) {
      errors.push("metadata must be an object.");
    } else {
      for (const key of ["driver", "vehicle", "track", "course", "sessionType"] as const) {
        if (value.metadata[key] != null && typeof value.metadata[key] !== "string") {
          errors.push(`metadata.${key} must be a string.`);
        }
      }
    }
  }
  if (value.provenance != null) {
    if (!isRecord(value.provenance)) {
      errors.push("provenance must be an object.");
    } else {
      if (typeof value.provenance.producer !== "string" || value.provenance.producer.trim() === "") {
        errors.push("provenance.producer must be a non-empty string.");
      }
      for (const key of ["producerVersion", "captureConfig"] as const) {
        if (value.provenance[key] != null && typeof value.provenance[key] !== "string") {
          errors.push(`provenance.${key} must be a string.`);
        }
      }
    }
  }
  if (value.warnings != null && (
    !Array.isArray(value.warnings)
    || value.warnings.some((warning) => typeof warning !== "string")
  )) {
    errors.push("warnings must be an array of strings.");
  }
  if (value.sync != null) validateSync(value.sync, errors);
  return errors;
}

export function isSessionBundleV1(value: unknown): value is SessionBundleV1 {
  return validateSessionBundle(value).length === 0;
}
