import { fileURLToPath } from "node:url";

export interface CliAssetProvider {
  tracksPath: string;
  drawingsPath: string;
  sampleDirectory: string;
}

/**
 * Development compatibility provider. Packaged CLI distributions should set
 * LAPWING_* paths or inject a provider whose assets ship beside the executable.
 */
export function defaultCliAssets(): CliAssetProvider {
  const webPublic = new URL("../../web/public/", import.meta.url);
  return {
    tracksPath: process.env.LAPWING_TRACKS_PATH
      ?? fileURLToPath(new URL("tracks.json", webPublic)),
    drawingsPath: process.env.LAPWING_DRAWINGS_PATH
      ?? fileURLToPath(new URL("drawings.json", webPublic)),
    sampleDirectory: process.env.LAPWING_SAMPLE_DIRECTORY
      ?? fileURLToPath(new URL("samples/", webPublic)),
  };
}
