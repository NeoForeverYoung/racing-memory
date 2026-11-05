/**
 * Structured CLI failure. `code` is the stable machine contract agents branch
 * on; exit 2 = usage/argument problem, exit 1 = runtime (file, parse, FFmpeg).
 */
export const CLI_ERROR_CODES = {
  MANIFEST_INVALID: "MANIFEST_INVALID",
  HASH_MISMATCH: "HASH_MISMATCH",
  WATCH_TIMEOUT: "WATCH_TIMEOUT",
  SYNC_LOW_CONFIDENCE: "SYNC_LOW_CONFIDENCE",
} as const;

export class CliError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly exitCode = 2,
  ) {
    super(message);
  }
}

/** Map a Node filesystem error onto a stable CLI error code. */
export function fileError(path: string, error: unknown): CliError {
  const errno = (error as NodeJS.ErrnoException | undefined)?.code;
  if (errno === "ENOENT") return new CliError("FILE_NOT_FOUND", `File not found: ${path}`, 1);
  const reason = error instanceof Error ? error.message : String(error);
  return new CliError("FILE_UNREADABLE", `Cannot read ${path}: ${reason}`, 1);
}
