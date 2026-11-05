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
  process.stderr.write(`${JSON.stringify(event)}\n`);
}
