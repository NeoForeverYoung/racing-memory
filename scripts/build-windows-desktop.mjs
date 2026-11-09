import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const desktop = resolve(root, "apps/desktop");
const tauri = resolve(desktop, "src-tauri");
const binaries = resolve(tauri, "binaries");
const resources = resolve(tauri, "resources");
const publicAssets = resolve(root, "apps/web/public");
const windowsTarget = "x86_64-pc-windows-msvc";
const ffmpeg = process.env.RACING_MEMORY_FFMPEG;
const ffprobe = process.env.RACING_MEMORY_FFPROBE;

if (process.platform !== "win32") {
  throw new Error("Windows bundles must be produced on Windows so Bun and Sharp use Windows native binaries.");
}
if (process.arch !== "x64") {
  throw new Error("Windows bundles require the x64 Bun runtime, including when building under Windows 11 ARM emulation.");
}
if (!ffmpeg || !ffprobe || !existsSync(ffmpeg) || !existsSync(ffprobe)) {
  throw new Error("Set RACING_MEMORY_FFMPEG and RACING_MEMORY_FFPROBE to the Windows executables included in the release.");
}

rmSync(binaries, { recursive: true, force: true });
rmSync(resources, { recursive: true, force: true });
mkdirSync(binaries, { recursive: true });
mkdirSync(resources, { recursive: true });
const sidecar = resolve(binaries, "lapwing-x86_64-pc-windows-msvc.exe");
const compile = spawnSync("bun", ["build", "--compile", "--target=bun-windows-x64", "--external", "sharp", "apps/cli/src/lapwing.ts", "--outfile", sidecar], { cwd: root, stdio: "inherit" });
if (compile.status !== 0) process.exit(compile.status ?? 1);
copyFileSync(ffmpeg, resolve(resources, "ffmpeg.exe"));
copyFileSync(ffprobe, resolve(resources, "ffprobe.exe"));
copyFileSync(resolve(publicAssets, "tracks.json"), resolve(resources, "tracks.json"));
copyFileSync(resolve(publicAssets, "drawings.json"), resolve(resources, "drawings.json"));
const bundle = spawnSync("bunx", ["tauri", "build", "--no-bundle", "--target", windowsTarget], { cwd: desktop, stdio: "inherit" });
if (bundle.status !== 0) process.exit(bundle.status ?? 1);
const portable = resolve(root, "dist/RacingMemory-win11-x64");
rmSync(portable, { recursive: true, force: true });
mkdirSync(portable, { recursive: true });
copyFileSync(resolve(tauri, "target", windowsTarget, "release/racing-memory-desktop.exe"), resolve(portable, "RacingMemory.exe"));
copyFileSync(sidecar, resolve(portable, "lapwing-x86_64-pc-windows-msvc.exe"));
copyFileSync(ffmpeg, resolve(portable, "ffmpeg.exe"));
copyFileSync(ffprobe, resolve(portable, "ffprobe.exe"));
copyFileSync(resolve(publicAssets, "tracks.json"), resolve(portable, "tracks.json"));
copyFileSync(resolve(publicAssets, "drawings.json"), resolve(portable, "drawings.json"));
const archive = spawnSync("powershell", ["-NoProfile", "-Command", "Compress-Archive -Path 'dist/RacingMemory-win11-x64' -DestinationPath 'dist/RacingMemory-win11-x64.zip' -Force"], { cwd: root, stdio: "inherit" });
process.exit(archive.status ?? 1);
