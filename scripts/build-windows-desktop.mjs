import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const root = resolve(import.meta.dirname, "..");
const desktop = resolve(root, "apps/desktop");
const tauri = resolve(desktop, "src-tauri");
const binaries = resolve(tauri, "binaries");
const resources = resolve(tauri, "resources");
const publicAssets = resolve(root, "apps/web/public");
const webFull = resolve(root, "apps/web/dist-full");
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
rmSync(resolve(desktop, "dist"), { recursive: true, force: true });
rmSync(webFull, { recursive: true, force: true });
rmSync(resolve(tauri, "target", windowsTarget, "release"), { recursive: true, force: true });
mkdirSync(binaries, { recursive: true });
mkdirSync(resources, { recursive: true });
const webBuild = spawnSync("bun", ["run", "--cwd", "apps/web", "build:full"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, VITE_IS_NATIVE: "false" },
});
if (webBuild.status !== 0) process.exit(webBuild.status ?? 1);
const sidecar = resolve(binaries, "lapwing-x86_64-pc-windows-msvc.exe");
const compile = spawnSync("bun", ["build", "--compile", "--target=bun-windows-x64", "--external", "sharp", "apps/cli/src/lapwing.ts", "--outfile", sidecar], { cwd: root, stdio: "inherit" });
if (compile.status !== 0) process.exit(compile.status ?? 1);
copyFileSync(ffmpeg, resolve(resources, "ffmpeg.exe"));
copyFileSync(ffprobe, resolve(resources, "ffprobe.exe"));
copyFileSync(resolve(publicAssets, "tracks.json"), resolve(resources, "tracks.json"));
copyFileSync(resolve(publicAssets, "drawings.json"), resolve(resources, "drawings.json"));
// `bun x` is equivalent to `bunx` but also works on installs that only ship bun.exe.
const bundle = spawnSync("bun", ["x", "tauri", "build", "--no-bundle", "--target", windowsTarget], { cwd: desktop, stdio: "inherit" });
if (bundle.status !== 0) process.exit(bundle.status ?? 1);
// A running portable build locks its own directory on Windows. Allow a
// separate output directory so a rebuild never has to close the running app.
const portableRelative = process.env.RACING_MEMORY_PORTABLE_DIR ?? "dist/RacingMemory-win11-x64";
const portable = resolve(root, portableRelative);
rmSync(portable, { recursive: true, force: true });
mkdirSync(portable, { recursive: true });
copyFileSync(resolve(tauri, "target", windowsTarget, "release/racing-memory-desktop.exe"), resolve(portable, "RacingMemory.exe"));
copyFileSync(sidecar, resolve(portable, "lapwing-x86_64-pc-windows-msvc.exe"));
copyFileSync(ffmpeg, resolve(portable, "ffmpeg.exe"));
copyFileSync(ffprobe, resolve(portable, "ffprobe.exe"));
copyFileSync(resolve(publicAssets, "tracks.json"), resolve(portable, "tracks.json"));
copyFileSync(resolve(publicAssets, "drawings.json"), resolve(portable, "drawings.json"));
copyFileSync(resolve(root, "release/README.md"), resolve(portable, "README.md"));
cpSync(webFull, resolve(portable, "web-analysis"), { recursive: true });

const help = spawnSync(sidecar, ["--help"], { cwd: portable, encoding: "utf8" });
if (help.status !== 0 || !help.stdout.includes("delivery generate")) {
  throw new Error("Packaged CLI does not include the delivery generate command.");
}
function containsMarker(directory, marker) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory() && containsMarker(path, marker)) return true;
    if (entry.isFile() && /\.(?:js|html)$/.test(entry.name) && readFileSync(path, "utf8").includes(marker)) return true;
  }
  return false;
}
if (!existsSync(resolve(portable, "web-analysis/index.html")) || !containsMarker(resolve(portable, "web-analysis"), "desktopSession")) {
  throw new Error("Packaged LapWing Web does not include the Desktop Session handoff.");
}
if (!readFileSync(resolve(portable, "README.md"), "utf8").includes("Racing Memory Windows 用户指南")) {
  throw new Error("Packaged user README is missing or invalid.");
}
const git = spawnSync("git", ["rev-parse", "--short=12", "HEAD"], { cwd: root, encoding: "utf8" });
const gitStatus = spawnSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: root, encoding: "utf8" });
const gitBranch = spawnSync("git", ["branch", "--show-current"], { cwd: root, encoding: "utf8" });
const gitHash = git.status === 0
  ? `${git.stdout.trim()}${gitStatus.status === 0 && gitStatus.stdout.trim() ? "-dirty" : ""}`
  : "unknown";
const buildInfo = {
  version: JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version,
  gitHash,
  branch: process.env.GITHUB_REF_NAME
    ?? process.env.WORKERS_CI_BRANCH
    ?? (gitBranch.status === 0 && gitBranch.stdout.trim() ? gitBranch.stdout.trim() : "local"),
  builtAt: new Date().toISOString(),
  modules: { desktop: "0.1.0", web: "full", cli: "delivery-generate-v1" },
};
writeFileSync(resolve(portable, "build-info.json"), `${JSON.stringify(buildInfo, null, 2)}\n`);
// Windows Defender can briefly lock the freshly copied ffmpeg/ffprobe binaries,
// which makes Compress-Archive fail with "being used by another process".
// Use the .NET zip API and retry on transient file locks.
const zipCommand = [
  "$ErrorActionPreference = 'Stop'",
  "Add-Type -AssemblyName System.IO.Compression.FileSystem",
  `$src = (Resolve-Path '${portableRelative}').Path`,
  `$dst = Join-Path (Get-Location) '${portableRelative}.zip'`,
  "for ($i = 0; $i -lt 5; $i++) {",
  "  try {",
  "    if (Test-Path $dst) { Remove-Item $dst -Force }",
  "    [System.IO.Compression.ZipFile]::CreateFromDirectory($src, $dst, [System.IO.Compression.CompressionLevel]::Optimal, $false)",
  "    break",
  "  } catch {",
  "    if ($i -eq 4) { throw }",
  "    Start-Sleep -Seconds 3",
  "  }",
  "}",
].join("; ");
const archive = spawnSync("powershell", ["-NoProfile", "-Command", zipCommand], { cwd: root, stdio: "inherit" });
if (archive.status !== 0) process.exit(archive.status ?? 1);
const archivePath = resolve(root, `${portableRelative}.zip`);
const sha256 = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
writeFileSync(`${archivePath}.sha256`, `${sha256}  ${basename(portableRelative)}.zip\n`);
