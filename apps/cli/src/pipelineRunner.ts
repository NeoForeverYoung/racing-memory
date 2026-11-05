import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  deriveJobStatus,
  type JobManifestV1,
  type JobStep,
  type SessionBundleV1,
} from "@lapwing/telemetry-core";
import { CliError } from "./errors";
import { emitProgress } from "./progress";
import {
  hashFile,
  hashValue,
  readJobManifest,
  writeJsonAtomic,
} from "./jobStore";
import { assertBundleFiles } from "./bundleCommands";

export interface PipelineContext {
  manifestPath: string;
  manifest: JobManifestV1;
  bundle: SessionBundleV1;
  bundlePath: string;
  outputDirectory: string;
  step: JobStep;
}

export type PipelineStepHandler = (context: PipelineContext) => Promise<unknown> | unknown;
export type PipelineHandlers = Record<string, PipelineStepHandler>;

function stepInputHash(bundlePath: string, step: JobStep, options: Record<string, unknown>): string {
  return hashValue({
    bundleHash: hashFile(bundlePath),
    step: step.id,
    command: step.command,
    options,
  });
}

function artifactPath(manifest: JobManifestV1, step: JobStep): string {
  return resolve(manifest.outputDirectory, "artifacts", `${step.id}.json`);
}

function dependenciesReady(step: JobStep, steps: JobStep[]): boolean {
  return step.dependsOn.every((id) => {
    const dependency = steps.find((candidate) => candidate.id === id);
    return dependency?.status === "done" || dependency?.status === "skipped";
  });
}

export async function runPipeline(options: {
  manifestPath: string;
  handlers: PipelineHandlers;
  resume?: boolean;
  fromStep?: string;
  dryRun?: boolean;
}): Promise<JobManifestV1> {
  const manifestPath = resolve(options.manifestPath);
  const manifest = readJobManifest(manifestPath);
  const bundlePath = resolve(dirname(manifestPath), manifest.bundlePath);
  const bundle = assertBundleFiles(bundlePath).bundle;
  const fromIndex = options.fromStep
    ? manifest.steps.findIndex((step) => step.id === options.fromStep)
    : 0;
  if (options.fromStep && fromIndex < 0) {
    throw new CliError("INVALID_ARGUMENT", `Unknown --from step: ${options.fromStep}`);
  }

  if (options.dryRun) return manifest;
  mkdirSync(resolve(manifest.outputDirectory, "artifacts"), { recursive: true });
  manifest.status = "running";
  manifest.updatedAt = new Date().toISOString();
  writeJsonAtomic(manifestPath, manifest);

  for (let index = 0; index < manifest.steps.length; index++) {
    const step = manifest.steps[index];
    if (index < fromIndex) continue;
    if (!dependenciesReady(step, manifest.steps)) {
      step.status = "skipped";
      step.completedAt = new Date().toISOString();
      manifest.warnings.push(`${step.id} skipped because a dependency did not complete.`);
      continue;
    }
    const handler = options.handlers[step.id];
    if (!handler) {
      throw new CliError("MANIFEST_INVALID", `No pipeline handler registered for step ${step.id}.`, 1);
    }
    const inputHash = stepInputHash(bundlePath, step, manifest.options);
    const output = artifactPath(manifest, step);
    if (
      options.resume &&
      step.status === "done" &&
      step.inputHash === inputHash &&
      step.artifact &&
      existsSync(resolve(manifest.outputDirectory, step.artifact))
    ) {
      emitProgress(step.id, "skipped", "Input hash unchanged; keeping completed artifact.");
      continue;
    }

    step.status = "running";
    step.startedAt = new Date().toISOString();
    step.completedAt = undefined;
    step.error = undefined;
    step.inputHash = inputHash;
    manifest.updatedAt = step.startedAt;
    writeJsonAtomic(manifestPath, manifest);
    emitProgress(step.id, "started", step.command);
    try {
      const report = await handler({
        manifestPath,
        manifest,
        bundle,
        bundlePath,
        outputDirectory: manifest.outputDirectory,
        step,
      });
      writeJsonAtomic(output, report);
      step.artifact = relativeArtifact(manifest.outputDirectory, output);
      manifest.artifacts[step.id] = step.artifact;
      step.status = "done";
      step.completedAt = new Date().toISOString();
      emitProgress(step.id, "completed", `${step.command} completed.`, 1);
    } catch (error) {
      step.status = "failed";
      step.retryCount++;
      step.completedAt = new Date().toISOString();
      step.error = {
        code: error instanceof CliError ? error.code : "COMMAND_FAILED",
        message: error instanceof Error ? error.message : String(error),
      };
      manifest.status = deriveJobStatus(manifest.steps);
      manifest.updatedAt = step.completedAt;
      writeJsonAtomic(manifestPath, manifest);
      emitProgress(step.id, "failed", step.error.message);
      throw error;
    }
    manifest.status = deriveJobStatus(manifest.steps);
    manifest.updatedAt = step.completedAt;
    writeJsonAtomic(manifestPath, manifest);
  }
  manifest.status = deriveJobStatus(manifest.steps);
  manifest.updatedAt = new Date().toISOString();
  writeJsonAtomic(manifestPath, manifest);
  return manifest;
}

function relativeArtifact(outputDirectory: string, artifact: string): string {
  const prefix = `${resolve(outputDirectory)}/`;
  return artifact.startsWith(prefix) ? artifact.slice(prefix.length) : artifact;
}
