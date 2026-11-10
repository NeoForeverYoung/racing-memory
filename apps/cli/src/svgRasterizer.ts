import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runBinary } from "./core";
import { CliError } from "./errors";
import { loadSharp } from "./sharpLoader";

export function svgDimensions(svg: string): { width: number; height: number } {
  const root = svg.match(/<svg\b[^>]*\bwidth="(\d+)"[^>]*\bheight="(\d+)"/i);
  return {
    width: Number(root?.[1] ?? 1200),
    height: Number(root?.[2] ?? 675),
  };
}

function windowsEdge(): string | null {
  const roots = [
    process.env["ProgramFiles(x86)"],
    process.env.ProgramFiles,
    "C:\\Program Files (x86)",
    "C:\\Program Files",
  ];
  for (const root of roots) {
    if (!root) continue;
    const candidate = resolve(root, "Microsoft/Edge/Application/msedge.exe");
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function edgeScreenshotArgs(
  width: number,
  height: number,
  pngPath: string,
  svgPath: string,
  profileDirectory: string,
): string[] {
  return [
    "--headless",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    // Recent Chromium/Edge builds refuse to start headless without an explicit
    // profile: "Missing headless user data directory".
    `--user-data-dir=${profileDirectory}`,
    `--window-size=${width},${height}`,
    `--screenshot=${resolve(pngPath)}`,
    pathToFileURL(resolve(svgPath)).href,
  ];
}

export async function rasterizeSvg(svg: string, svgPath: string, pngPath: string): Promise<void> {
  if (process.platform === "win32") {
    const edge = windowsEdge();
    if (!edge) throw new CliError("BINARY_NOT_FOUND", "Microsoft Edge is required to render Windows scorecard PNG files.", 1);
    const { width, height } = svgDimensions(svg);
    // A fresh throwaway profile per render avoids collisions between parallel
    // renders and never touches the user's real browser profile.
    const profile = mkdtempSync(join(tmpdir(), "lapwing-edge-"));
    try {
      runBinary(edge, edgeScreenshotArgs(width, height, pngPath, svgPath, profile));
    } finally {
      try {
        rmSync(profile, { recursive: true, force: true });
      } catch {
        // Edge may still hold a lock briefly on Windows; the temp directory is
        // disposable and will be reclaimed by the OS.
      }
    }
    if (!existsSync(pngPath)) throw new CliError("BINARY_FAILED", "Microsoft Edge did not create the requested scorecard PNG.", 1);
    return;
  }
  const sharp = await loadSharp();
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(pngPath);
}
