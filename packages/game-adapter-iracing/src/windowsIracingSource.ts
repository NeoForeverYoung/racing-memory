import type { CanonicalRaceState, GameSource } from "@lapwing/game-adapter-kit";

const FILE_MAP_READ = 0x0004;
const HEADER_BYTES = 112;
const VAR_HEADER_BYTES = 144;

interface LiveVar {
  type: number;
  offset: number;
}

function readCString(bytes: Uint8Array, start: number, length: number): string {
  let end = start;
  while (end < Math.min(bytes.length, start + length) && bytes[end] !== 0) end++;
  return new TextDecoder().decode(bytes.subarray(start, end));
}

function yamlScalar(source: string, key: string): string | undefined {
  const value = source.match(new RegExp(`^\\s*${key}:\\s*(.+?)\\s*$`, "m"))?.[1]?.trim();
  return value?.replace(/^(['"])(.*)\1$/, "$2");
}

function readLiveValue(view: DataView, row: number, variable: LiveVar): number {
  const at = row + variable.offset;
  switch (variable.type) {
    case 0: return view.getInt8(at);
    case 1: return view.getUint8(at);
    case 2:
    case 3: return view.getInt32(at, true);
    case 4: return view.getFloat32(at, true);
    case 5: return view.getFloat64(at, true);
    default: return NaN;
  }
}

function readRaceChannels(
  view: DataView,
  row: number,
  variables: Map<string, LiveVar>,
): Partial<CanonicalRaceState> {
  const value = (name: string): number | undefined => {
    const variable = variables.get(name);
    if (!variable) return undefined;
    const next = readLiveValue(view, row, variable);
    return Number.isFinite(next) ? next : undefined;
  };
  const onPitRoad = value("OnPitRoad");
  return {
    racePosition: value("PlayerCarPosition"),
    classPosition: value("PlayerCarClassPosition"),
    incidents: value("PlayerCarMyIncidentCount"),
    onPitRoad: onPitRoad == null ? undefined : onPitRoad !== 0,
    lapDistPct: value("LapDistPct"),
  };
}

/**
 * Windows-only direct IRSDK shared-memory source. It deliberately lives behind
 * a dynamic import so web, Android, macOS and ordinary CLI use never load FFI.
 */
export class WindowsIracingSource implements GameSource {
  readonly id = "iracing";

  constructor(private readonly pollMs = 100) {}

  async *events(): AsyncIterable<CanonicalRaceState> {
    if (process.platform !== "win32") {
      throw new Error("Direct iRacing shared-memory capture is available only on Windows.");
    }
    // Keep Bun's Windows-only FFI module out of the browser TypeScript graph
    // and out of non-Windows startup. The package intentionally has no Bun
    // ambient type dependency because the web app is otherwise Node-typed.
    const ffiModule = "bun:ffi";
    const { dlopen, FFIType, ptr, toArrayBuffer } = await import(ffiModule);
    const kernel = dlopen("kernel32.dll", {
      OpenFileMappingW: {
        args: [FFIType.u32, FFIType.i32, FFIType.ptr],
        returns: FFIType.u64,
      },
      MapViewOfFile: {
        args: [FFIType.u64, FFIType.u32, FFIType.u32, FFIType.u32, FFIType.u64],
        returns: FFIType.ptr,
      },
      UnmapViewOfFile: { args: [FFIType.ptr], returns: FFIType.i32 },
      CloseHandle: { args: [FFIType.u64], returns: FFIType.i32 },
    });
    const name = Buffer.from("Local\\IRSDKMemMapFileName\0", "utf16le");
    let announcedConnecting = false;
    while (true) {
      const handle = kernel.symbols.OpenFileMappingW(FILE_MAP_READ, 0, ptr(name));
      if (!handle) {
        if (!announcedConnecting) {
          announcedConnecting = true;
          yield this.event("connecting", "waiting-for-iracing", 0, {});
        }
        await new Promise((resolve) => setTimeout(resolve, this.pollMs));
        continue;
      }
      const mapped = kernel.symbols.MapViewOfFile(handle, FILE_MAP_READ, 0, 0, 0);
      if (!mapped) {
        kernel.symbols.CloseHandle(handle);
        await new Promise((resolve) => setTimeout(resolve, this.pollMs));
        continue;
      }
      try {
        const header = new DataView(toArrayBuffer(mapped, 0, HEADER_BYTES));
        const sessionInfoLength = header.getInt32(16, true);
        const sessionInfoOffset = header.getInt32(20, true);
        const numVars = header.getInt32(24, true);
        const varHeaderOffset = header.getInt32(28, true);
        const numBuf = header.getInt32(32, true);
        const bufLen = header.getInt32(36, true);
        const totalBytes = Math.max(
          sessionInfoOffset + sessionInfoLength,
          varHeaderOffset + numVars * VAR_HEADER_BYTES,
          ...Array.from({ length: Math.min(4, numBuf) }, (_, index) =>
            header.getInt32(48 + index * 16 + 4, true) + bufLen),
        );
        const memory = toArrayBuffer(mapped, 0, totalBytes);
        const view = new DataView(memory);
        const bytes = new Uint8Array(memory);
        const variables = new Map<string, LiveVar>();
        for (let index = 0; index < numVars; index++) {
          const at = varHeaderOffset + index * VAR_HEADER_BYTES;
          variables.set(readCString(bytes, at + 16, 32), {
            type: view.getInt32(at, true),
            offset: view.getInt32(at + 4, true),
          });
        }
        let newestBuffer = 0;
        let newestTick = -1;
        for (let index = 0; index < Math.min(4, numBuf); index++) {
          const tick = view.getInt32(48 + index * 16, true);
          if (tick > newestTick) {
            newestTick = tick;
            newestBuffer = view.getInt32(48 + index * 16 + 4, true);
          }
        }
        const sessionStateVar = variables.get("SessionState");
        const sessionTimeVar = variables.get("SessionTime");
        const sessionState = sessionStateVar ? readLiveValue(view, newestBuffer, sessionStateVar) : 0;
        const sessionTime = sessionTimeVar ? readLiveValue(view, newestBuffer, sessionTimeVar) : 0;
        const yaml = readCString(bytes, sessionInfoOffset, sessionInfoLength);
        const metadata = {
          driver: yamlScalar(yaml, "UserName"),
          vehicle: yamlScalar(yaml, "CarScreenName"),
          track: yamlScalar(yaml, "TrackDisplayName") ?? yamlScalar(yaml, "TrackName"),
          course: yamlScalar(yaml, "TrackConfigName"),
          sessionType: yamlScalar(yaml, "SessionType"),
        };
        const sessionId = `${yamlScalar(yaml, "SubSessionID") ?? "iracing"}-${yamlScalar(yaml, "SessionID") ?? "live"}`;
        yield this.event("live", sessionId, sessionTime, {
          ...metadata,
          ...readRaceChannels(view, newestBuffer, variables),
        });
        let lastState = sessionState;
        if (sessionState === 4) {
          yield this.event("green", sessionId, sessionTime, {
            ...metadata,
            ...readRaceChannels(view, newestBuffer, variables),
          });
        }
        if (sessionState >= 5) {
          yield this.event("finished", sessionId, sessionTime, {
            ...metadata,
            ...readRaceChannels(view, newestBuffer, variables),
          });
          return;
        }
        while (true) {
          await new Promise((resolve) => setTimeout(resolve, this.pollMs));
          const liveHeader = new DataView(toArrayBuffer(mapped, 0, HEADER_BYTES));
          let latestOffset = newestBuffer;
          let latestTick = newestTick;
          for (let index = 0; index < Math.min(4, numBuf); index++) {
            const tick = liveHeader.getInt32(48 + index * 16, true);
            if (tick > latestTick) {
              latestTick = tick;
              latestOffset = liveHeader.getInt32(48 + index * 16 + 4, true);
            }
          }
          const liveMemory = new DataView(toArrayBuffer(mapped, 0, totalBytes));
          const nextState = sessionStateVar ? readLiveValue(liveMemory, latestOffset, sessionStateVar) : lastState;
          const nextTime = sessionTimeVar ? readLiveValue(liveMemory, latestOffset, sessionTimeVar) : sessionTime;
          if (nextState !== lastState && nextState === 4) {
            yield this.event("green", sessionId, nextTime, {
              ...metadata,
              ...readRaceChannels(liveMemory, latestOffset, variables),
            });
          }
          if (nextState >= 5) {
            yield this.event("finished", sessionId, nextTime, {
              ...metadata,
              ...readRaceChannels(liveMemory, latestOffset, variables),
            });
            return;
          }
          lastState = nextState;
          newestTick = latestTick;
          newestBuffer = latestOffset;
        }
      } finally {
        kernel.symbols.UnmapViewOfFile(mapped);
        kernel.symbols.CloseHandle(handle);
      }
    }
  }

  private event(
    state: CanonicalRaceState["state"],
    sessionId: string,
    sessionTimeSeconds: number,
    metadata: Partial<CanonicalRaceState>,
  ): CanonicalRaceState {
    return {
      game: "iracing",
      state,
      sessionId,
      sessionTimeSeconds,
      wallClock: new Date().toISOString(),
      monotonicMs: performance.now(),
      ...metadata,
    };
  }
}
