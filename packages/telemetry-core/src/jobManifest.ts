export const JOB_MANIFEST_SCHEMA_VERSION = 1 as const;

export type JobStatus = "pending" | "running" | "partial" | "succeeded" | "failed";
export type JobStepStatus = "pending" | "running" | "done" | "failed" | "skipped";

export interface JobStepError {
  code: string;
  message: string;
}

export interface JobStep {
  id: string;
  command: string;
  status: JobStepStatus;
  dependsOn: string[];
  inputHash?: string;
  artifact?: string;
  startedAt?: string;
  completedAt?: string;
  retryCount: number;
  error?: JobStepError;
}

export interface JobManifestV1 {
  schemaVersion: typeof JOB_MANIFEST_SCHEMA_VERSION;
  jobId: string;
  createdAt: string;
  updatedAt: string;
  status: JobStatus;
  bundlePath: string;
  outputDirectory: string;
  options: Record<string, unknown>;
  steps: JobStep[];
  artifacts: Record<string, string>;
  warnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stableStringify(value: unknown): string {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
    .join(",")}}`;
}

export function createJobManifest(options: {
  jobId: string;
  bundlePath: string;
  outputDirectory: string;
  now?: string;
  jobOptions?: Record<string, unknown>;
  steps: Array<Pick<JobStep, "id" | "command"> & { dependsOn?: string[] }>;
}): JobManifestV1 {
  const now = options.now ?? new Date().toISOString();
  return {
    schemaVersion: JOB_MANIFEST_SCHEMA_VERSION,
    jobId: options.jobId,
    createdAt: now,
    updatedAt: now,
    status: "pending",
    bundlePath: options.bundlePath,
    outputDirectory: options.outputDirectory,
    options: options.jobOptions ?? {},
    steps: options.steps.map((step) => ({
      id: step.id,
      command: step.command,
      status: "pending",
      dependsOn: step.dependsOn ?? [],
      retryCount: 0,
    })),
    artifacts: {},
    warnings: [],
  };
}

export function validateJobManifest(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return ["job manifest must be an object."];
  }
  const manifest = value as Record<string, unknown>;
  if (manifest.schemaVersion !== JOB_MANIFEST_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${JOB_MANIFEST_SCHEMA_VERSION}.`);
  }
  for (const key of ["jobId", "createdAt", "updatedAt", "bundlePath", "outputDirectory"]) {
    if (typeof manifest[key] !== "string" || (manifest[key] as string).trim() === "") {
      errors.push(`${key} must be a non-empty string.`);
    }
  }
  for (const key of ["createdAt", "updatedAt"] as const) {
    if (typeof manifest[key] === "string" && !Number.isFinite(Date.parse(manifest[key]))) {
      errors.push(`${key} must be an ISO date.`);
    }
  }
  if (!isRecord(manifest.options)) errors.push("options must be an object.");
  if (!isRecord(manifest.artifacts) || Object.values(manifest.artifacts).some((item) => typeof item !== "string")) {
    errors.push("artifacts must be a string map.");
  }
  if (!Array.isArray(manifest.warnings) || manifest.warnings.some((item) => typeof item !== "string")) {
    errors.push("warnings must be a string array.");
  }
  if (!["pending", "running", "partial", "succeeded", "failed"].includes(String(manifest.status))) {
    errors.push("status is invalid.");
  }
  if (!Array.isArray(manifest.steps) || manifest.steps.length === 0) {
    errors.push("steps must be a non-empty array.");
  } else {
    const ids = new Set<string>();
    manifest.steps.forEach((step, index) => {
      if (typeof step !== "object" || step === null || Array.isArray(step)) {
        errors.push(`steps[${index}] must be an object.`);
        return;
      }
      const candidate = step as Record<string, unknown>;
      if (typeof candidate.id !== "string" || candidate.id === "") {
        errors.push(`steps[${index}].id must be a non-empty string.`);
      } else if (ids.has(candidate.id)) {
        errors.push(`steps[${index}].id is duplicated.`);
      } else {
        ids.add(candidate.id);
      }
      if (typeof candidate.command !== "string" || candidate.command === "") {
        errors.push(`steps[${index}].command must be a non-empty string.`);
      }
      if (!["pending", "running", "done", "failed", "skipped"].includes(String(candidate.status))) {
        errors.push(`steps[${index}].status is invalid.`);
      }
      if (!Array.isArray(candidate.dependsOn) || candidate.dependsOn.some((item) => typeof item !== "string")) {
        errors.push(`steps[${index}].dependsOn must be a string array.`);
      }
      if (!Number.isInteger(candidate.retryCount) || Number(candidate.retryCount) < 0) {
        errors.push(`steps[${index}].retryCount must be a non-negative integer.`);
      }
      if (
        candidate.inputHash != null
        && (typeof candidate.inputHash !== "string" || !/^sha256:[a-f0-9]{64}$/i.test(candidate.inputHash))
      ) {
        errors.push(`steps[${index}].inputHash must use the sha256:<64 hex> form.`);
      }
      for (const key of ["startedAt", "completedAt"] as const) {
        if (candidate[key] != null && (
          typeof candidate[key] !== "string"
          || !Number.isFinite(Date.parse(candidate[key]))
        )) {
          errors.push(`steps[${index}].${key} must be an ISO date.`);
        }
      }
    });
    for (const step of manifest.steps as Array<Record<string, unknown>>) {
      if (!Array.isArray(step.dependsOn)) continue;
      for (const dependency of step.dependsOn) {
        if (!ids.has(String(dependency))) errors.push(`step ${String(step.id)} depends on unknown step ${String(dependency)}.`);
      }
    }
  }
  return errors;
}

export function deriveJobStatus(steps: JobStep[]): JobStatus {
  if (steps.some((step) => step.status === "running")) return "running";
  const failed = steps.filter((step) => step.status === "failed").length;
  const done = steps.filter((step) => step.status === "done" || step.status === "skipped").length;
  if (failed > 0) return done > 0 ? "partial" : "failed";
  if (done === steps.length && steps.length > 0) return "succeeded";
  return "pending";
}
