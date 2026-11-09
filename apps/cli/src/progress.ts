import { appendFileSync } from "node:fs";

export interface CliProgressEvent {
  type: "progress";
  step: string;
  status: "started" | "running" | "completed" | "failed" | "skipped";
  percent?: number;
  message: string;
  at: string;
}

export function emitProgress(
  step: string,
  status: CliProgressEvent["status"],
  message: string,
  percent?: number,
): void {
  const event: CliProgressEvent = {
    type: "progress",
    step,
    status,
    percent,
    message,
    at: new Date().toISOString(),
  };
  const line = `${JSON.stringify(event)}\n`;
  process.stderr.write(line);
  const progressFile = process.env.RACING_MEMORY_PROGRESS_FILE;
  if (progressFile) {
    try {
      appendFileSync(progressFile, line, "utf8");
    } catch {
      // Progress persistence is a Desktop UI fallback and must not fail delivery.
    }
  }
}
