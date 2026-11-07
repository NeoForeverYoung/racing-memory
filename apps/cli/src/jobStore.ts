import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  createJobManifest,
  stableStringify,
  validateJobManifest,
  validateSessionBundle,
  type JobManifestV1,
  type SessionBundleV1,
} from "@lapwing/telemetry-core";
import { CliError, fileError } from "./errors";

export function hashValue(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableStringify(value)).digest("hex")}`;
}

export function hashFile(path: string): string {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch (error) {
    throw fileError(path, error);
  }
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function readSessionBundle(path: string): SessionBundleV1 {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new CliError("MANIFEST_INVALID", `Invalid JSON in ${path}: ${error.message}`, 1);
    }
    throw fileError(path, error);
  }
  const errors = validateSessionBundle(value);
  if (errors.length > 0) {
    throw new CliError("MANIFEST_INVALID", `Invalid session bundle: ${errors.join(" ")}`, 1);
  }
  return value as SessionBundleV1;
}

export function readJobManifest(path: string): JobManifestV1 {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new CliError("MANIFEST_INVALID", `Invalid JSON in ${path}: ${error.message}`, 1);
    }
    throw fileError(path, error);
  }
  const errors = validateJobManifest(value);
  if (errors.length > 0) {
    throw new CliError("MANIFEST_INVALID", `Invalid job manifest: ${errors.join(" ")}`, 1);
  }
  return value as JobManifestV1;
}

export function writeJsonAtomic(path: string, value: unknown): void {
  const absolute = resolve(path);
  const temporary = `${absolute}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
    renameSync(temporary, absolute);
  } catch (error) {
    throw fileError(absolute, error);
  }
}

export function createDefaultJob(options: {
  bundlePath: string;
  outputDirectory: string;
  jobOptions?: Record<string, unknown>;
}): JobManifestV1 {
  return createJobManifest({
    jobId: randomUUID(),
    bundlePath: resolve(options.bundlePath),
    outputDirectory: resolve(options.outputDirectory),
    jobOptions: options.jobOptions,
    steps: [
      { id: "inspect", command: "inspect" },
      { id: "sync", command: "sync suggest", dependsOn: ["inspect"] },
      { id: "analyze", command: "analyze", dependsOn: ["inspect"] },
      { id: "memory", command: "memory detect", dependsOn: ["inspect", "sync"] },
      { id: "reel", command: "memory reel", dependsOn: ["memory"] },
      { id: "assets", command: "session render", dependsOn: ["analyze", "sync"] },
      { id: "report", command: "report render", dependsOn: ["analyze"] },
      { id: "insights", command: "coach insights", dependsOn: ["analyze"] },
    ],
  });
}

export interface StableFileResult {
  path: string;
  sizeBytes: number;
  mtimeMs: number;
  stable: boolean;
}

export async function waitForStableFile(
  path: string,
  options: { stableMs?: number; timeoutMs?: number; pollMs?: number } = {},
): Promise<StableFileResult> {
  const stableMs = options.stableMs ?? 2_000;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const pollMs = options.pollMs ?? 250;
  const started = Date.now();
  let lastSignature = "";
  let unchangedSince = Date.now();
  while (Date.now() - started <= timeoutMs) {
    if (existsSync(path)) {
      const stat = statSync(path);
      const signature = `${stat.size}:${stat.mtimeMs}`;
      if (signature !== lastSignature) {
        lastSignature = signature;
        unchangedSince = Date.now();
      } else if (Date.now() - unchangedSince >= stableMs) {
        return { path, sizeBytes: stat.size, mtimeMs: stat.mtimeMs, stable: true };
      }
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, pollMs));
  }
  throw new CliError("WATCH_TIMEOUT", `File did not stabilize before timeout: ${path}`, 1);
}

export function resolveBundlePath(bundlePath: string, childPath: string): string {
  return resolve(dirname(bundlePath), childPath);
}
