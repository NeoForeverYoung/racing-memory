# Racing Memory for Windows 11

This is the native shell for the complete offline Racing Memory workflow. A release is a portable ZIP: extract it anywhere on Windows 11 and double-click `RacingMemory.exe`. It contains:

- the Tauri desktop UI;
- a compiled `lapwing.exe` sidecar (no Node.js or Bun on the user's PC);
- `ffmpeg.exe` and `ffprobe.exe` as application resources (no FFmpeg installation);
- iRacing shared-memory and OBS WebSocket capture support.

## Recording contract

1. The app waits for iRacing's live shared-memory session.
2. At the first green state it sends OBS `StartRecord` and stores the acknowledgement time with iRacing `SessionTime`.
3. At session finish it sends OBS `StopRecord`, waits for the IBT and MP4 to stop changing, and writes the session bundle with start and stop anchors.
4. The delivery pipeline refits those anchors, writes the sync result to the bundle, and refuses a low-confidence timeline until the user explicitly accepts it.

The IBT file is created by iRacing, not by Racing Memory. The start/stop anchors are what make its final file deterministically align with the OBS recording.

## Release build

Run the build on a Windows x64 release machine. Provide the two FFmpeg executables at build time; they are copied inside the app and are not a runtime prerequisite for users.

```powershell
$env:RACING_MEMORY_FFMPEG = "C:\\release-tools\\ffmpeg.exe"
$env:RACING_MEMORY_FFPROBE = "C:\\release-tools\\ffprobe.exe"
bun run build:desktop:win
```

The portable output is `dist/RacingMemory-win11-x64.zip`. Before publishing, code-sign `RacingMemory.exe`, `lapwing-x86_64-pc-windows-msvc.exe`, and test it on a clean Windows 11 machine with only OBS and iRacing installed.
