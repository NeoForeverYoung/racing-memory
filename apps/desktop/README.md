# Racing Memory for Windows 11

This is the native shell for the complete offline Racing Memory workflow. A release is a portable ZIP: extract it anywhere on Windows 11 and double-click `RacingMemory.exe`. It contains:

- the Tauri desktop UI;
- a compiled `lapwing.exe` sidecar (no Node.js or Bun on the user's PC);
- `ffmpeg.exe` and `ffprobe.exe` as application resources (no FFmpeg installation);
- the bundled track and drawing databases required by local reports;
- the offline LapWing Full Web analysis build used by “在 LapWing 中深度分析”;
- **not** OBS Studio — users install OBS separately; Home and Settings probe the configured WebSocket URL and common install paths;
- iRacing shared-memory and OBS WebSocket capture support.

Windows scorecard PNGs are rasterized locally from the generated SVG files by
the Microsoft Edge engine included with Windows 11. No browser window opens and
no network request is made.

## Local Session Library

Desktop keeps one local Session directory per completed capture. It archives the
finalized `.ibt`, Bundle, job/artifact JSON, reports and scorecards under the
user-selected Racing Memory data folder. The original OBS recording is never
copied into that folder; its local path and availability are tracked only so the
user can regenerate video outputs while it remains on the PC.

The Desktop Home, Session Result and Session Library screens are the supported
user workflow. Bundle JSON is an internal contract and should not be needed for
normal capture or delivery. OBS passwords are supplied for the current capture
only and are not persisted in Desktop settings.

Home also accepts an existing `.ibt` and optional recording through native
Windows file dialogs; paths remain editable for copy/paste workflows. Settings
uses the same native folder picker for the data and iRacing telemetry folders.
“成绩单与报告” works without OBS or video; “完整视频交付” requires the recording.
The same repeatable path is available to scripts:

```powershell
lapwing delivery generate --telemetry C:\race.ibt --video D:\race.mp4 `
  --output C:\RacingMemoryData\sessions\manual-test --preset full
```

Session Result shows one primary scorecard and one human-readable offline report;
JSON, SVG and pipeline artifacts remain in the diagnostics directory. Opening
LapWing analysis starts a token-scoped loopback server on `127.0.0.1`, streams
the current IBT and optional video (with HTTP Range), and never uploads either.

## Recording contract

1. The app waits for iRacing's live shared-memory session.
2. At the first green state it sends OBS `StartRecord` and stores the acknowledgement time with iRacing `SessionTime`.
3. At session finish it sends OBS `StopRecord`, waits for the IBT and MP4 to stop changing, and writes the session bundle with start and stop anchors.
4. The delivery pipeline refits those anchors, writes the sync result to the bundle, and refuses a low-confidence timeline until the user explicitly accepts it.

The IBT file is created by iRacing, not by Racing Memory. The start/stop anchors are what make its final file deterministically align with the OBS recording.

## Release build

The canonical native Windows and Apple Silicon Parallels setup, source handoff,
toolchain, and validation procedure lives in
[`docs/development/cross-machine-development.md`](../../docs/development/cross-machine-development.md).
Do not copy a macOS working tree or `node_modules` into Windows.

Run the build with the Windows x64 Bun runtime. A native Windows x64 release
machine is preferred; Windows 11 ARM may use its x64 emulation for pre-release
testing. Install the Rust x64 target first:

```powershell
rustup target add x86_64-pc-windows-msvc
```

Provide the two x64 FFmpeg executables at build time; they are copied inside the
app and are not a runtime prerequisite for users.

```powershell
$env:RACING_MEMORY_FFMPEG = "C:\\release-tools\\ffmpeg.exe"
$env:RACING_MEMORY_FFPROBE = "C:\\release-tools\\ffprobe.exe"
bun run build:desktop:win
```

The build clears stale Desktop/Web release output, compiles the Full Web profile,
checks that the packaged CLI contains `delivery generate` and that the Web bundle
contains the Desktop handoff, then writes `build-info.json` and
`dist/RacingMemory-win11-x64.zip.sha256`.

The portable output is `dist/RacingMemory-win11-x64.zip`. Before publishing, code-sign `RacingMemory.exe`, `lapwing-x86_64-pc-windows-msvc.exe`, and test it on a clean Windows 11 machine with only OBS and iRacing installed.
