import type { ParsedData } from "@/types/racing";

interface GoProImportProgress {
  done: number;
  total: number;
}

interface DisabledGoProImportResult {
  csv: string;
  chapters: File[];
  syncOffsetMs: number;
  fileName: string;
  blob: Blob;
}

export async function parseGoProVideoFile(
  _file: File,
  _onProgress?: (progress: GoProImportProgress) => void,
): Promise<ParsedData> {
  throw new Error("GoPro telemetry import is available in the Full product profile.");
}

export async function importGoProVideo(
  _files: File[],
  _onProgress?: (progress: GoProImportProgress) => void,
): Promise<DisabledGoProImportResult> {
  throw new Error("GoPro telemetry import is available in the Full product profile.");
}
