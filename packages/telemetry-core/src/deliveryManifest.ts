export const DELIVERY_MANIFEST_SCHEMA_VERSION = 1 as const;

export type DeliveryItemRole =
  | "primary-video"
  | "supporting-video"
  | "scorecard"
  | "report";

export type DeliveryItemGroup = "overview" | "video" | "report";

export type DeliveryMediaType = "video/mp4" | "image/png" | "text/html";

export interface DeliveryManifestItem {
  id: string;
  role: DeliveryItemRole;
  group: DeliveryItemGroup;
  title: string;
  description?: string;
  path: string;
  mediaType: DeliveryMediaType;
  previewPath?: string;
  order: number;
}

export interface DeliveryManifestV1 {
  schemaVersion: typeof DELIVERY_MANIFEST_SCHEMA_VERSION;
  generatedAt: string;
  generator: {
    version: string;
    gitHash?: string;
  };
  summary: {
    fastestLapMs?: number;
    completeLapCount: number;
    primaryInsight?: string;
  };
  items: DeliveryManifestItem[];
  diagnosticsDirectory: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRelativeSafePath(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && !value.startsWith("/")
    && !value.startsWith("\\")
    && !/^[a-z]:[\\/]/i.test(value)
    && !value.split(/[\\/]/).includes("..");
}

export function validateDeliveryManifest(value: unknown): string[] {
  if (!isRecord(value)) return ["delivery manifest must be an object."];
  const errors: string[] = [];
  if (value.schemaVersion !== DELIVERY_MANIFEST_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${DELIVERY_MANIFEST_SCHEMA_VERSION}.`);
  }
  if (typeof value.generatedAt !== "string" || !Number.isFinite(Date.parse(value.generatedAt))) {
    errors.push("generatedAt must be an ISO date.");
  }
  if (!isRecord(value.generator) || typeof value.generator.version !== "string") {
    errors.push("generator.version must be a string.");
  }
  if (!isRecord(value.summary) || !Number.isInteger(value.summary.completeLapCount)) {
    errors.push("summary.completeLapCount must be an integer.");
  }
  if (!isRelativeSafePath(value.diagnosticsDirectory)) {
    errors.push("diagnosticsDirectory must be a safe relative path.");
  }
  if (!Array.isArray(value.items)) {
    errors.push("items must be an array.");
    return errors;
  }
  const ids = new Set<string>();
  value.items.forEach((item, index) => {
    if (!isRecord(item)) {
      errors.push(`items[${index}] must be an object.`);
      return;
    }
    if (typeof item.id !== "string" || item.id.length === 0 || ids.has(item.id)) {
      errors.push(`items[${index}].id must be unique and non-empty.`);
    } else {
      ids.add(item.id);
    }
    if (!["primary-video", "supporting-video", "scorecard", "report"].includes(String(item.role))) {
      errors.push(`items[${index}].role is invalid.`);
    }
    if (!["overview", "video", "report"].includes(String(item.group))) {
      errors.push(`items[${index}].group is invalid.`);
    }
    if (!["video/mp4", "image/png", "text/html"].includes(String(item.mediaType))) {
      errors.push(`items[${index}].mediaType is invalid.`);
    }
    if (typeof item.title !== "string" || item.title.length === 0) {
      errors.push(`items[${index}].title must be non-empty.`);
    }
    if (!isRelativeSafePath(item.path)) {
      errors.push(`items[${index}].path must be a safe relative path.`);
    }
    if (item.previewPath != null && !isRelativeSafePath(item.previewPath)) {
      errors.push(`items[${index}].previewPath must be a safe relative path.`);
    }
    if (!Number.isFinite(item.order)) {
      errors.push(`items[${index}].order must be numeric.`);
    }
  });
  return errors;
}
