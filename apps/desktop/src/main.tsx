/* eslint-disable react-refresh/only-export-components */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  DELIVERY_STEPS,
  assetDisplayLabel,
  captureStage,
  deliveryLabel,
  deliveryOverallPercent,
  formatRecordingStats,
  isPreviewableImage,
  captureReady,
  obsReadinessSummary,
  parseCaptureEvent,
  parseDeliveryProgress,
  sessionDate,
  sessionTitle,
  setupReady,
  visibleSessionAssets,
  type CapturePhase,
  type CapturePresentation,
  type DeliveryProgress,
  type DesktopSettings,
  type DesktopState,
  type LocalSessionRecord,
  type ObsReadiness,
} from "./sessionModel";
import {
  INITIAL_DESKTOP_NAVIGATION,
  reduceDesktopNavigation,
  type DesktopNavigation,
} from "./desktopNavigation";
import "./styles.css";

type AppEvent = { kind: "capture" | "delivery"; level: "info" | "error"; message: string; at: string; sessionId?: string };
type PathPickerKind = "telemetryFile" | "videoFile" | "directory";
type ImportProgressSnapshot = { lines: string[]; sessionId?: string; error?: string };

const EMPTY_STATE: DesktopState = {
  settings: { dataRoot: "", telemetryDirectory: "", obsUrl: "" },
  sessions: [],
  engineReady: false,
  engineError: null,
  buildInfo: null,
};

// A Vite fast refresh must not reset the capture card to "ready" while the
// sidecar is still recording, so the active flag survives a WebView reload.
const CAPTURE_ACTIVE_KEY = "racing-memory.capture.active";
const CAPTURE_PHASE_KEY = "racing-memory.capture.phase";

type ObsRecordStatus = { active: boolean; durationMs: number; bytes: number };

async function obsAuthentication(password: string, hello: { salt?: string; challenge?: string }): Promise<string | null> {
  if (!password || !hello.salt || !hello.challenge) return null;
  const encoder = new TextEncoder();
  const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
  const secret = toBase64(await digest(password + hello.salt));
  return toBase64(await digest(secret + hello.challenge));
}

function readStoredPhase(): CapturePhase | null {
  try {
    return JSON.parse(sessionStorage.getItem(CAPTURE_PHASE_KEY) ?? "null") as CapturePhase | null;
  } catch {
    return null;
  }
}

function App() {
  const [state, setState] = useState<DesktopState>(EMPTY_STATE);
  const [navigation, setNavigation] = useState<DesktopNavigation>(INITIAL_DESKTOP_NAVIGATION);
  const [events, setEvents] = useState<AppEvent[]>([]);
  const [obsPassword, setObsPassword] = useState("");
  const [importTelemetryPath, setImportTelemetryPath] = useState("");
  const [importVideoPath, setImportVideoPath] = useState("");
  const [importPreset, setImportPreset] = useState<"scorecard" | "full">("scorecard");
  const [allowLowConfidence, setAllowLowConfidence] = useState(false);
  const [busy, setBusy] = useState<"capture" | "import" | "delivery" | "settings" | "rebuild" | null>(null);
  const [deliveryProgress, setDeliveryProgress] = useState<DeliveryProgress>({});
  const [importProgressId, setImportProgressId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [obsReadiness, setObsReadiness] = useState<ObsReadiness | null>(null);
  const [captureActive, setCaptureActive] = useState(() => sessionStorage.getItem(CAPTURE_ACTIVE_KEY) === "1");
  const [capturePhase, setCapturePhase] = useState<CapturePhase | null>(readStoredPhase);
  const [obsRecord, setObsRecord] = useState<ObsRecordStatus | null>(null);
  const obsPasswordRef = useRef("");
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const { view, sessionId: selectedId, sessionSection } = navigation;
  const navigate = (event: Parameters<typeof reduceDesktopNavigation>[1]) => {
    setNavigation((current) => reduceDesktopNavigation(current, event));
  };

  const selected = useMemo(
    () => state.sessions.find((session) => session.id === selectedId) ?? null,
    [selectedId, state.sessions],
  );

  const refresh = async () => {
    try {
      const next = await invoke<DesktopState>("get_desktop_state");
      setState(next);
      setNavigation((current) => current.sessionId && !next.sessions.some((session) => session.id === current.sessionId)
        ? INITIAL_DESKTOP_NAVIGATION
        : current);
    } catch (error) {
      setMessage(String(error));
    }
  };

  useEffect(() => {
    void refresh();
    let unlisten: (() => void) | undefined;
    void listen<AppEvent>("racing-memory://event", ({ payload }) => {
      setEvents((current) => [payload, ...current].slice(0, 20));
      if (payload.kind === "delivery") {
        const progress = parseDeliveryProgress(payload.message);
        if (progress) setDeliveryProgress((current) => ({ ...current, [progress.step]: progress }));
      }
      if (payload.kind === "capture") {
        const phase = parseCaptureEvent(payload.message);
        if (phase) setCapturePhase(phase);
      }
      if (payload.level === "error") {
        setMessage(payload.message);
        if (busyRef.current !== "import") setBusy(null);
        void refresh();
      }
      if (payload.kind === "capture" && payload.message === "Capture engine stopped.") {
        setBusy(null);
        setCaptureActive(false);
        setCapturePhase(null);
        setObsRecord(null);
        void refresh();
      }
      if (payload.message === "Session is ready to review." || payload.message === "Race assets are ready." || payload.message === "Imported Session is ready.") {
        if (payload.kind === "delivery") {
          setDeliveryProgress((current) => Object.fromEntries(DELIVERY_STEPS.map(({ id }) => [
            id,
            current[id] ?? { step: id, status: "skipped", percent: 100, message: "当前生成档位不需要此步骤。" },
          ])) as DeliveryProgress);
        }
        void refresh();
        if (busyRef.current !== "import") setBusy(null);
        setCaptureActive(false);
        setCapturePhase(null);
      }
    }).then((fn) => { unlisten = fn; });
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    if (busy !== "import" || !importProgressId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const snapshot = await invoke<ImportProgressSnapshot>("get_import_progress", { progressId: importProgressId });
        if (cancelled) return;
        const updates: DeliveryProgress = {};
        for (const line of snapshot.lines) {
          const progress = parseDeliveryProgress(line);
          if (progress) updates[progress.step] = progress;
        }
        setDeliveryProgress(updates);
        if (snapshot.error) {
          setMessage(snapshot.error);
          setBusy(null);
          setImportProgressId(null);
          navigate({ type: "importFailed" });
          return;
        }
        if (snapshot.sessionId) {
          const next = await invoke<DesktopState>("get_desktop_state");
          if (cancelled) return;
          setState(next);
          setBusy(null);
          setImportProgressId(null);
          navigate({ type: "importCompleted", sessionId: snapshot.sessionId });
        }
      } catch (error) {
        if (!cancelled) setMessage(String(error));
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [busy, importProgressId]);

  useEffect(() => {
    if (busy !== "delivery" || !selectedId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const [lines, next] = await Promise.all([
          invoke<string[]>("get_delivery_progress", { sessionId: selectedId }),
          invoke<DesktopState>("get_desktop_state"),
        ]);
        if (cancelled) return;
        const updates: DeliveryProgress = {};
        for (const line of lines) {
          const progress = parseDeliveryProgress(line);
          if (progress) updates[progress.step] = progress;
        }
        setDeliveryProgress(updates);
        setState(next);
        const session = next.sessions.find((candidate) => candidate.id === selectedId);
        if (session && session.deliveryStatus !== "running") {
          setBusy(null);
          if (session.deliveryStatus === "failed") {
            setMessage(session.deliveryError ?? "交付生成失败，请重试。");
          }
        }
      } catch (error) {
        if (!cancelled) setMessage(String(error));
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [busy, selectedId]);

  useEffect(() => {
    if (view !== "dashboard" && view !== "capture" && view !== "settings") return;
    let cancelled = false;
    const probe = async () => {
      try {
        const next = await invoke<ObsReadiness>("probe_obs", { obsUrl: state.settings.obsUrl });
        if (!cancelled) setObsReadiness(next);
      } catch {
        if (!cancelled) {
          setObsReadiness({
            installed: false,
            installPath: null,
            websocketOk: false,
            detail: "无法在本机探测 OBS，请确认 Racing Memory 桌面版正在运行。",
          });
        }
      }
    };
    void probe();
    const timer = window.setInterval(() => void probe(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [view, state.settings.obsUrl]);

  useEffect(() => {
    if (captureActive) sessionStorage.setItem(CAPTURE_ACTIVE_KEY, "1");
    else sessionStorage.removeItem(CAPTURE_ACTIVE_KEY);
  }, [captureActive]);

  useEffect(() => {
    if (capturePhase) sessionStorage.setItem(CAPTURE_PHASE_KEY, JSON.stringify(capturePhase));
    else sessionStorage.removeItem(CAPTURE_PHASE_KEY);
  }, [capturePhase]);

  // Ask OBS directly for its record status. This is the authoritative signal
  // that survives a WebView reload, when companion events have already gone.
  // Probe on the home view even when the UI has no active flag: a capture that
  // started before this code was loaded still has OBS writing a video.
  useEffect(() => {
    if (!state.settings.obsUrl.trim() || view !== "capture") return;
    let cancelled = false;
    const sockets = new Set<WebSocket>();
    const poll = () => {
      if (cancelled) return;
      let ws: WebSocket;
      try {
        ws = new WebSocket(state.settings.obsUrl);
      } catch {
        return;
      }
      sockets.add(ws);
      ws.onclose = () => sockets.delete(ws);
      const timeout = window.setTimeout(() => ws.close(), 2500);
      ws.onmessage = async (event) => {
        let message: { op?: number; d?: Record<string, unknown> };
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }
        if (message.op === 0) {
          const hello = (message.d?.authentication ?? {}) as { salt?: string; challenge?: string };
          const authentication = await obsAuthentication(obsPasswordRef.current, hello);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ op: 1, d: { rpcVersion: 1, ...(authentication ? { authentication } : {}) } }));
          }
        } else if (message.op === 2) {
          ws.send(JSON.stringify({ op: 6, d: { requestType: "GetRecordStatus", requestId: "racing-memory" } }));
        } else if (message.op === 7 && message.d?.requestId === "racing-memory") {
          const data = (message.d.responseData ?? {}) as Record<string, unknown>;
          const active = Boolean(data.outputActive);
          if (!cancelled) {
            setObsRecord({
              active,
              durationMs: Number(data.outputDuration) || 0,
              bytes: Number(data.outputBytes) || 0,
            });
            if (active) {
              setCaptureActive(true);
              setCapturePhase((current) => current ?? { kind: "recording.started" });
            }
          }
          window.clearTimeout(timeout);
          ws.close();
        } else if (message.op === 5) {
          window.clearTimeout(timeout);
          ws.close();
        }
      };
      ws.onerror = () => window.clearTimeout(timeout);
    };
    void poll();
    const timer = window.setInterval(poll, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      for (const ws of sockets) {
        try { ws.close(); } catch { /* already closed */ }
      }
    };
  }, [state.settings.obsUrl, view]);

  const resetCaptureState = () => {
    setCaptureActive(false);
    setCapturePhase(null);
    setObsRecord(null);
    setBusy(null);
  };

  const chooseSession = (session: LocalSessionRecord) => {
    navigate({ type: "openSession", sessionId: session.id });
    setAllowLowConfidence(false);
    setDeliveryProgress({});
  };

  const startCapture = async () => {
    obsPasswordRef.current = obsPassword;
    setBusy("capture");
    setCaptureActive(true);
    setCapturePhase(null);
    setObsRecord(null);
    setMessage(null);
    try {
      await invoke("start_capture", { request: { obsPassword } });
      setObsPassword("");
    } catch (error) {
      resetCaptureState();
      setMessage(String(error));
    }
  };

  const generateDelivery = async (preset: "scorecard" | "full") => {
    if (!selected) return;
    navigate({ type: "startDelivery", sessionId: selected.id });
    setBusy("delivery");
    setDeliveryProgress({});
    setMessage(null);
    try {
      await invoke("run_delivery", { request: { sessionId: selected.id, acceptLowConfidence: allowLowConfidence, preset } });
      await refresh();
    } catch (error) {
      setBusy(null);
      setMessage(String(error));
    }
  };

  const importAndGenerate = async () => {
    if (!importTelemetryPath.trim()) return;
    setBusy("import");
    setDeliveryProgress({});
    navigate({ type: "startImport" });
    setMessage(null);
    try {
      const progressId = await invoke<string>("import_and_generate", {
        request: {
          telemetryPath: importTelemetryPath.trim(),
          videoPath: importVideoPath.trim() || null,
          preset: importPreset,
          acceptLowConfidence: allowLowConfidence,
        },
      });
      setImportProgressId(progressId);
    } catch (error) {
      setBusy(null);
      setImportProgressId(null);
      navigate({ type: "importFailed" });
      setMessage(String(error));
    }
  };

  const saveSettings = async (settings: DesktopSettings) => {
    setBusy("settings");
    setMessage(null);
    try {
      const next = await invoke<DesktopState>("save_settings", { settings });
      setState(next);
      setBusy(null);
      navigate({ type: "open", view: "dashboard" });
    } catch (error) {
      setBusy(null);
      setMessage(String(error));
    }
  };

  const rebuildLibrary = async () => {
    setBusy("rebuild");
    try {
      const sessions = await invoke<LocalSessionRecord[]>("rebuild_session_registry");
      setState((current) => ({ ...current, sessions }));
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(null);
    }
  };

  const openAsset = async (path: string) => {
    setMessage(null);
    try {
      await invoke("open_local_path", { path });
    } catch (error) {
      setMessage(String(error));
    }
  };

  const openWebAnalysis = async () => {
    if (!selected) return;
    setMessage(null);
    try {
      await invoke<string>("open_web_analysis", { sessionId: selected.id });
    } catch (error) {
      setMessage(String(error));
    }
  };

  const pickLocalPath = async (
    kind: PathPickerKind,
    currentPath: string,
    onSelect: (path: string) => void,
  ) => {
    setMessage(null);
    try {
      const path = await invoke<string | null>("pick_local_path", {
        kind,
        currentPath: currentPath.trim() || null,
      });
      if (path) onSelect(path);
    } catch (error) {
      setMessage(String(error));
    }
  };

  const capturing = busy === "capture" || captureActive;
  const canCapture = captureReady(state, obsReadiness) && !capturing;
  const presentation = captureStage({
    active: capturing,
    phase: capturePhase,
    obsRecording: obsRecord?.active ?? false,
  });
  const recordingStats = obsRecord?.active ? formatRecordingStats(obsRecord.durationMs, obsRecord.bytes) : null;

  return <main className="app-shell">
    <header className="topbar">
      <button className="brand" type="button" onClick={() => navigate({ type: "open", view: "dashboard" })}><span>R</span> Racing Memory</button>
      <div className="engine-status"><i className={state.engineReady ? "good" : "bad"} />{state.engineReady ? "本地引擎已就绪" : "本地引擎需要检查"}</div>
    </header>
    <div className="workspace">
      <nav className="sidebar" aria-label="主导航">
        <NavButton active={view === "dashboard"} onClick={() => navigate({ type: "open", view: "dashboard" })} label="工作台" icon="⌂" />
        <NavButton active={view === "create" || view === "import" || view === "capture" || view === "importProgress"} onClick={() => navigate({ type: "open", view: "create" })} label="新建 Session" icon="+" disabled={busy === "import"} />
        <NavButton active={view === "library" || view === "session"} onClick={() => navigate({ type: "open", view: "library" })} label="历史 Session" icon="▤" count={state.sessions.length || undefined} disabled={busy === "import"} />
        <NavButton active={view === "settings"} onClick={() => navigate({ type: "open", view: "settings" })} label="设置" icon="⚙" disabled={busy === "import"} />
        <p>所有分析、视频处理和数据归档都在这台电脑完成。原始录像不会被复制进 Racing Memory。</p>
      </nav>
      <section className="content">
        {message && <div className="notice error"><span>{message}</span><button type="button" onClick={() => setMessage(null)}>关闭</button></div>}
        {view === "dashboard" && <Dashboard
          state={state}
          onCreate={() => navigate({ type: "open", view: "create" })}
          onSession={chooseSession}
        />}
        {view === "create" && <CreateSession
          onImport={() => navigate({ type: "open", view: "import" })}
          onCapture={() => navigate({ type: "open", view: "capture" })}
        />}
        {view === "import" && <ImportSession
          importTelemetryPath={importTelemetryPath}
          setImportTelemetryPath={setImportTelemetryPath}
          pickImportTelemetryPath={() => void pickLocalPath("telemetryFile", importTelemetryPath, setImportTelemetryPath)}
          importVideoPath={importVideoPath}
          setImportVideoPath={setImportVideoPath}
          pickImportVideoPath={() => void pickLocalPath("videoFile", importVideoPath, setImportVideoPath)}
          importPreset={importPreset}
          setImportPreset={setImportPreset}
          allowLowConfidence={allowLowConfidence}
          setAllowLowConfidence={setAllowLowConfidence}
          importing={busy === "import"}
          onImport={importAndGenerate}
          onBack={() => navigate({ type: "open", view: "create" })}
        />}
        {view === "capture" && <CaptureSession
          state={state}
          obsReadiness={obsReadiness}
          password={obsPassword}
          setPassword={setObsPassword}
          canCapture={canCapture}
          capturing={capturing}
          presentation={presentation}
          recordingStats={recordingStats}
          onResetCapture={resetCaptureState}
          onCapture={startCapture}
          onSettings={() => navigate({ type: "open", view: "settings" })}
          onBack={() => navigate({ type: "open", view: "create" })}
          events={events}
        />}
        {view === "library" && <Library sessions={state.sessions} selectedId={selected?.id ?? null} busy={busy === "rebuild"} onSelect={chooseSession} onRebuild={rebuildLibrary} />}
        {view === "importProgress" && <ImportProgress progress={deliveryProgress} />}
        {view === "session" && <SessionResult
          session={selected}
          busy={busy === "delivery"}
          progress={deliveryProgress}
          allowLowConfidence={allowLowConfidence}
          setAllowLowConfidence={setAllowLowConfidence}
          onGenerate={generateDelivery}
          onOpenWebAnalysis={openWebAnalysis}
          onOpenAsset={openAsset}
          section={sessionSection}
          onSection={(section) => navigate({ type: "showSessionSection", section })}
          onBack={() => navigate({ type: "open", view: "library" })}
        />}
        {view === "settings" && <Settings
          settings={state.settings}
          buildInfo={state.buildInfo}
          obsReadiness={obsReadiness}
          busy={busy === "settings"}
          onPickDirectory={(currentPath, onSelect) => void pickLocalPath("directory", currentPath, onSelect)}
          onSave={saveSettings}
        />}
      </section>
    </div>
  </main>;
}

function NavButton({ active, label, icon, count, disabled, onClick }: { active: boolean; label: string; icon: string; count?: number; disabled?: boolean; onClick: () => void }) {
  return <button className={active ? "nav active" : "nav"} type="button" disabled={disabled} onClick={onClick}><span>{icon}</span>{label}{count != null && <b>{count}</b>}</button>;
}

function Dashboard({ state, onCreate, onSession }: {
  state: DesktopState;
  onCreate: () => void;
  onSession: (session: LocalSessionRecord) => void;
}) {
  return <>
    <section className="hero">
      <div><p className="eyebrow">本地比赛回忆</p><h1>从一场比赛开始</h1><p>选择导入已有遥测，或准备录制下一场 iRacing 比赛。工作台只保留你接下来最可能需要的动作。</p></div>
      <button className="primary" type="button" onClick={onCreate}>新建 Session</button>
    </section>
    <section className="section-head"><div><h2>继续复盘</h2><p>最近的本地 Session。</p></div>{state.sessions.length > 0 && <button className="text-button" type="button" onClick={() => onSession(state.sessions[0])}>打开最近一场</button>}</section>
    {state.sessions.length === 0 ? <EmptyState title="还没有本地 Session" detail="选择“新建 Session”导入已有 IBT，或开始录制下一场比赛。" /> : <div className="session-grid">{state.sessions.slice(0, 3).map((session) => <SessionCard key={session.id} session={session} onClick={() => onSession(session)} />)}</div>}
  </>;
}

function CreateSession({ onImport, onCapture }: { onImport: () => void; onCapture: () => void }) {
  return <>
    <section className="hero compact"><div><p className="eyebrow">NEW SESSION</p><h1>这场比赛从哪里来？</h1><p>选择一条路径。下一页只展示完成该任务所需的信息。</p></div></section>
    <section className="task-choice-grid">
      <button className="task-choice" type="button" onClick={onImport}><span>已有文件</span><h2>导入 IBT 或录像</h2><p>选择已有的 iRacing IBT；录像是可选的。适合补做过去一场比赛的复盘。</p><b>选择导入 →</b></button>
      <button className="task-choice" type="button" onClick={onCapture}><span>下一场比赛</span><h2>自动录制 iRacing</h2><p>连接 iRacing 与 OBS，比赛结束后自动把本地遥测、录像和交付物整理成 Session。</p><b>准备录制 →</b></button>
    </section>
  </>;
}

function ImportSession({ importTelemetryPath, setImportTelemetryPath, pickImportTelemetryPath, importVideoPath, setImportVideoPath, pickImportVideoPath, importPreset, setImportPreset, allowLowConfidence, setAllowLowConfidence, importing, onImport, onBack }: {
  importTelemetryPath: string;
  setImportTelemetryPath: (value: string) => void;
  pickImportTelemetryPath: () => void;
  importVideoPath: string;
  setImportVideoPath: (value: string) => void;
  pickImportVideoPath: () => void;
  importPreset: "scorecard" | "full";
  setImportPreset: (value: "scorecard" | "full") => void;
  allowLowConfidence: boolean;
  setAllowLowConfidence: (value: boolean) => void;
  importing: boolean;
  onImport: () => void;
  onBack: () => void;
}) {
  return <>
    <section className="hero compact"><div><p className="eyebrow">IMPORT SESSION</p><h1>导入已有比赛</h1><p>IBT 必填；录像可选。文件保留在原位置，Racing Memory 只保存本地引用和生成的交付物。</p></div><button className="secondary" type="button" onClick={onBack}>返回选择</button></section>
    <section className="import-card single-task">
      <div className="import-form">
        <PathField label="IBT 文件路径" value={importTelemetryPath} onChange={setImportTelemetryPath} onBrowse={pickImportTelemetryPath} placeholder="C:\Users\...\Documents\iRacing\telemetry\race.ibt" />
        <PathField label="视频文件路径（可选）" value={importVideoPath} onChange={setImportVideoPath} onBrowse={pickImportVideoPath} placeholder="D:\Recordings\race.mp4" />
        <div className="preset-buttons" role="group" aria-label="生成档位">
          <button className={importPreset === "scorecard" ? "selected" : ""} type="button" onClick={() => setImportPreset("scorecard")}>仅成绩单</button>
          <button className={importPreset === "full" ? "selected" : ""} type="button" disabled={!importVideoPath.trim()} onClick={() => setImportPreset("full")}>完整视频交付</button>
        </div>
        {importPreset === "full" && <label className="review"><input type="checkbox" checked={allowLowConfidence} onChange={(event) => setAllowLowConfidence(event.target.checked)} />若录像时间轴无法自动确认，允许继续生成；完成后我会在 LapWing 中复核同步。</label>}
        <button className="primary" type="button" disabled={importing || !importTelemetryPath.trim() || importPreset === "full" && !importVideoPath.trim()} onClick={onImport}>{importing ? "正在导入并生成…" : "创建 Session 并生成"}</button>
      </div>
    </section>
  </>;
}

function CaptureSession({ state, obsReadiness, password, setPassword, canCapture, capturing, presentation, recordingStats, onResetCapture, onCapture, onSettings, onBack, events }: {
  state: DesktopState;
  obsReadiness: ObsReadiness | null;
  password: string;
  setPassword: (value: string) => void;
  canCapture: boolean;
  capturing: boolean;
  presentation: CapturePresentation;
  recordingStats: string | null;
  onResetCapture: () => void;
  onCapture: () => void;
  onSettings: () => void;
  onBack: () => void;
  events: AppEvent[];
}) {
  const configured = setupReady(state.settings);
  const obs = obsReadinessSummary(obsReadiness, state.settings);
  return <>
    <section className="hero compact"><div><p className="eyebrow">RACE DAY</p><h1>准备录制下一场比赛</h1><p>确认本机依赖后开始；活动记录只在这个工作区显示。</p></div><div className="button-row"><button className="secondary" type="button" onClick={onBack}>返回选择</button><button className="secondary" type="button" onClick={onSettings}>检查设置</button></div></section>
    <section className={`capture-card stage-${presentation.stage}`}>
      <div><h2>{presentation.title}</h2><p>{presentation.detail}</p>{presentation.stage === "recording" && <p className="capture-live"><i />{recordingStats ? `OBS 正在录制 · ${recordingStats}` : "OBS 正在录制…"}</p>}{capturing && presentation.stage !== "recording" && <button className="text-button capture-reset" type="button" onClick={onResetCapture}>重置录制状态</button>}</div>
      <div className="capture-actions"><label>OBS WebSocket 密码（本次运行）<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="如 OBS 未设置密码可留空" /></label><button className={presentation.stage === "recording" ? "primary is-recording" : "primary"} type="button" disabled={!canCapture} onClick={onCapture}>{presentation.button}</button></div>
    </section>
    <section className="readiness">
      <Readiness label="本地引擎" value={state.engineReady ? "已就绪" : "需修复"} good={state.engineReady} detail={state.engineError ?? "自带 FFmpeg 与本地分析 CLI，不含 OBS Studio。"} />
      <Readiness label="OBS Studio" value={obs.value} good={obs.good} detail={obs.detail} />
      <Readiness label="iRacing telemetry" value={configured ? "已配置" : "未配置"} good={configured} detail={state.settings.telemetryDirectory || "在设置中选择 IBT 目录"} />
      <Readiness label="本地数据目录" value={state.settings.dataRoot ? "已配置" : "未配置"} good={Boolean(state.settings.dataRoot)} detail={state.settings.dataRoot || "在设置中选择保存位置"} />
    </section>
    <Activity events={events} />
  </>;
}

function Readiness({ label, value, detail, good }: { label: string; value: string; detail: string; good: boolean }) {
  return <div className="readiness-item"><div><strong>{label}</strong><small>{detail}</small></div><span className={good ? "status good" : "status bad"}>{value}</span></div>;
}

function Library({ sessions, selectedId, busy, onSelect, onRebuild }: { sessions: LocalSessionRecord[]; selectedId: string | null; busy: boolean; onSelect: (session: LocalSessionRecord) => void; onRebuild: () => void }) {
  return <>
    <section className="hero"><div><p className="eyebrow">LOCAL LIBRARY</p><h1>历史 Session</h1><p>保存遥测、分析、成绩单与产物清单；原始视频只保留本机引用。</p></div><button className="secondary" type="button" disabled={busy} onClick={onRebuild}>{busy ? "正在重新扫描…" : "重新扫描目录"}</button></section>
    {sessions.length === 0 ? <EmptyState title="没有可读取的 Session" detail="点击“重新扫描目录”会从本地 sessions 文件夹重建历史列表。" /> : <div className="library-list">{sessions.map((session) => <button className={session.id === selectedId ? "library-row selected" : "library-row"} key={session.id} type="button" onClick={() => onSelect(session)}><div><strong>{sessionTitle(session)}</strong><small>{sessionDate(session.createdAt)} · {session.sessionType ?? "Session"}</small></div><span>{session.videoAvailable ? "录像可用" : "仅遥测"}</span><span className={session.deliveryStatus === "succeeded" ? "status good" : "status"}>{deliveryLabel(session.deliveryStatus)}</span></button>)}</div>}
  </>;
}

function DeliveryProgressPanel({ progress }: { progress: DeliveryProgress }) {
  const overallPercent = deliveryOverallPercent(progress);
  return <section className="delivery-progress" aria-live="polite">
    <div className="progress-summary"><div><span>总进度</span><strong>{overallPercent}%</strong></div><progress max="100" value={overallPercent} /></div>
    <div className="progress-steps">{DELIVERY_STEPS.map(({ id, label }) => {
      const item = progress[id];
      const percent = item?.percent ?? 0;
      const status = item?.status === "failed" ? "失败" : item?.status === "completed" || item?.status === "skipped" ? "完成" : item?.status === "started" ? "处理中" : "等待";
      return <div className={`progress-step ${item?.status ?? "pending"}`} key={id}><div><strong>{label}</strong><span>{status}</span></div><progress max="100" value={percent} /><b>{percent}%</b>{item?.message && <small>{item.message}</small>}</div>;
    })}</div>
  </section>;
}

function ImportProgress({ progress }: { progress: DeliveryProgress }) {
  return <>
    <section className="hero compact">
      <div><p className="eyebrow">正在创建 Session</p><h1>导入与生成进度</h1><p>正在读取 IBT、分析圈速并生成所选交付物。完成后会自动进入本场结果页。</p></div>
    </section>
    <DeliveryProgressPanel progress={progress} />
  </>;
}

function SessionResult({ session, busy, progress, allowLowConfidence, setAllowLowConfidence, onGenerate, onOpenWebAnalysis, onOpenAsset, section, onSection, onBack }: {
  session: LocalSessionRecord | null;
  busy: boolean;
  progress: DeliveryProgress;
  allowLowConfidence: boolean;
  setAllowLowConfidence: (value: boolean) => void;
  onGenerate: (preset: "scorecard" | "full") => void;
  onOpenWebAnalysis: () => void;
  onOpenAsset: (path: string) => void;
  section: "overview" | "deliverables" | "generate";
  onSection: (section: "overview" | "deliverables" | "generate") => void;
  onBack: () => void;
}) {
  if (!session) return <EmptyState title="请选择一个 Session" detail="从历史 Session 中选择一场比赛后，可查看状态并生成本地交付物。" />;
  const needsReview = session.syncRequiresReview && !allowLowConfidence;
  const showProgress = busy || Object.keys(progress).length > 0;
  const visibleAssets = visibleSessionAssets(session.assets);
  const videoAssets = visibleAssets.filter((asset) => asset.group === "video" || asset.path.toLowerCase().endsWith(".mp4"));
  const overviewAssets = visibleAssets.filter((asset) => !videoAssets.includes(asset));
  return <>
    <section className="hero workspace-header"><div><p className="eyebrow">SESSION WORKSPACE</p><h1>{sessionTitle(session)}</h1><p>{sessionDate(session.createdAt)} · {session.game} · {session.sessionType ?? "Session"}</p></div><button className="secondary" type="button" onClick={onBack}>返回历史库</button></section>
    <nav className="session-tabs" aria-label="Session 工作区">
      <button className={section === "overview" ? "active" : ""} type="button" onClick={() => onSection("overview")}>概览</button>
      <button className={section === "deliverables" ? "active" : ""} type="button" onClick={() => onSection("deliverables")}>交付物{visibleAssets.length > 0 ? ` (${visibleAssets.length})` : ""}</button>
      <button className={section === "generate" ? "active" : ""} type="button" onClick={() => onSection("generate")}>生成与重试</button>
    </nav>
    {section === "overview" && <>
      <section className="result-overview">
        <div><span>同步状态</span><strong className={session.syncConfidence === "high" ? "good-text" : ""}>{session.syncConfidence ? `${session.syncConfidence} 置信度` : "等待分析"}</strong></div>
        <div><span>录像</span><strong>{session.videoAvailable ? "原始录像可用" : "仅保存遥测与分析"}</strong></div>
        <div><span>交付状态</span><strong>{deliveryLabel(session.deliveryStatus)}</strong></div>
      </section>
      <section className="analysis-callout"><div><p className="eyebrow">深度复盘</p><h2>在 LapWing 中查看完整遥测</h2><p>打开本场 IBT 的赛道地图、逐圈表现、遥测曲线和同步录像。分析页面由本机提供，不上传数据。</p></div><button className="primary" type="button" onClick={onOpenWebAnalysis}>在 LapWing 中深度分析</button></section>
      {session.trainingCard && <section className="training-card"><div><p className="eyebrow">NEXT PRACTICE</p><h2>下次练什么：{session.trainingCard.title}</h2><p>{session.trainingCard.detail}</p></div><div className="training-metrics"><span>当前损失 <strong>{session.trainingCard.baselineTimeLossMs} ms</strong></span><span>下次目标 <strong>≤ {session.trainingCard.targetTimeLossMs} ms</strong></span><span>证据置信度 <strong>{session.trainingCard.confidence}</strong></span></div><div className="training-copy"><strong>练习方式</strong><p>{session.trainingCard.exercise}</p><strong>完成标准</strong><p>{session.trainingCard.completionCriteria}</p></div></section>}
      <section className="workspace-next"><div><h2>下一步</h2><p>打开已有交付物，或按需要重新生成本场的本地成果。</p></div><div className="button-row"><button className="secondary" type="button" onClick={() => onSection("deliverables")}>查看交付物</button><button className="primary" type="button" onClick={() => onSection("generate")}>生成与重试</button></div></section>
    </>}
    {section === "generate" && <>
      <section className="section-head"><div><p className="eyebrow">DELIVERY</p><h2>生成或重新生成交付物</h2><p>选择要在这台电脑上生成的内容；完成后会保留在当前 Session。</p></div></section>
      {session.deliveryError && <div className="notice error"><span>{session.deliveryError}</span></div>}
      {session.videoAvailable && <label className="review"><input type="checkbox" checked={allowLowConfidence} onChange={(event) => setAllowLowConfidence(event.target.checked)} />我已检查同步，允许低置信度时间轴继续生成。</label>}
      {showProgress && <DeliveryProgressPanel progress={progress} />}
      <section className="delivery-card"><div><h2>选择生成档位</h2><p>成绩单模式只需要 IBT；完整模式会额外生成最快完整圈、OPT 合成圈和纪念图。所有文件只保存在本机。</p></div><div className="delivery-actions"><button className="secondary" type="button" disabled={busy} onClick={() => onGenerate("scorecard")}>{busy ? "正在生成…" : "生成成绩单"}</button><button className="primary" type="button" disabled={busy || needsReview || !session.videoAvailable} onClick={() => onGenerate("full")}>生成完整视频交付</button></div></section>
      {!session.videoAvailable && <div className="notice"><span>原始录像目前不可用，因此不能生成视频交付物；已归档的遥测和本地 Session 信息仍可保留。</span></div>}
      {!busy && session.deliveryStatus === "succeeded" && <button className="primary" type="button" onClick={() => onSection("deliverables")}>查看已生成交付物</button>}
    </>}
    {section === "deliverables" && <>
      <section className="section-head"><div><p className="eyebrow">DELIVERABLES</p><h2>赛后交付物</h2><p>仅显示面向复盘的文件；诊断文件不会混在这里。</p></div><button className="secondary" type="button" onClick={() => onOpenAsset(`${session.sessionDirectory}\\delivery`)}>打开交付目录</button></section>
      {visibleAssets.length === 0
        ? <EmptyState title="尚未生成可查看的赛后产物" detail="在“生成与重试”中完成交付后，这里会显示赛后成绩单和可播放的视频。" />
        : <>
          <AssetGroup title="一页总结" detail="成绩单与纪念图，快速了解这场比赛最重要的结果。" assets={overviewAssets} onOpen={onOpenAsset} />
          <AssetGroup title="比赛视频" detail="回看最快完整圈和理论 OPT。" assets={videoAssets} onOpen={onOpenAsset} />
        </>}
    </>}
  </>;
}

function AssetGroup({ title, detail, assets, onOpen }: {
  title: string;
  detail: string;
  assets: LocalSessionRecord["assets"];
  onOpen: (path: string) => void;
}) {
  if (assets.length === 0) return null;
  return <section className="asset-group">
    <div className="asset-group-heading"><h3>{title}</h3><p>{detail}</p></div>
    <div className="asset-list">{assets.map((asset) => <AssetCard asset={asset} onOpen={onOpen} key={asset.path} />)}</div>
  </section>;
}

function AssetCard({ asset, onOpen }: { asset: LocalSessionRecord["assets"][number]; onOpen: (path: string) => void }) {
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!isPreviewableImage(asset.path)) return;
    let active = true;
    void invoke<string | null>("read_image_preview", { path: asset.path })
      .then((value) => { if (active) setPreview(value); })
      .catch(() => { if (active) setPreview(null); });
    return () => { active = false; };
  }, [asset.path]);
  const fileName = asset.path.split(/[\\/]/).at(-1);
  return <button className="asset asset-action" type="button" onClick={() => onOpen(asset.path)}>
    {preview && <img src={preview} alt={`${assetDisplayLabel(asset)}缩略图`} />}
    <strong>{assetDisplayLabel(asset)}</strong>
    {asset.description && <p>{asset.description}</p>}
    <span>{fileName}</span>
    <small>{isPreviewableImage(asset.path) ? "点击查看原图" : "点击打开"}</small>
  </button>;
}

function Settings({ settings, buildInfo, obsReadiness, busy, onPickDirectory, onSave }: {
  settings: DesktopSettings;
  buildInfo?: DesktopState["buildInfo"];
  obsReadiness: ObsReadiness | null;
  busy: boolean;
  onPickDirectory: (currentPath: string, onSelect: (path: string) => void) => void;
  onSave: (settings: DesktopSettings) => void;
}) {
  const [draft, setDraft] = useState(settings);
  useEffect(() => setDraft(settings), [settings]);
  const obs = obsReadinessSummary(obsReadiness, draft);
  return <>
    <section className="hero"><div><p className="eyebrow">LOCAL SETUP</p><h1>本地设置</h1><p>这些路径仅保存在此电脑。OBS 密码不会写入配置，每次准备录制时输入。</p></div></section>
    <aside className="notice setup-note">
      <strong>OBS Studio 需单独安装</strong>
      <p>便携包内包含 Racing Memory、FFmpeg 和赛道数据，<b>不包含 OBS</b>。请从 <a href="https://obsproject.com/" rel="noreferrer" target="_blank">obsproject.com</a> 安装 OBS，在 OBS 中打开「工具 → WebSocket 服务器设置」启用服务，端口与下方地址一致。</p>
      <p className="obs-inline-status"><span className={obs.good ? "status good" : "status bad"}>{obs.value}</span>{obs.detail}</p>
    </aside>
    <form className="settings-form" onSubmit={(event) => { event.preventDefault(); onSave(draft); }}>
      <PathField label="Racing Memory 数据目录" value={draft.dataRoot} onChange={(dataRoot) => setDraft((current) => ({ ...current, dataRoot }))} onBrowse={() => onPickDirectory(draft.dataRoot, (dataRoot) => setDraft((current) => ({ ...current, dataRoot })))} help="Session、IBT 归档和成绩单将保存在这里。原始 OBS 录像不会复制进来。" />
      <PathField label="iRacing IBT 目录" value={draft.telemetryDirectory} onChange={(telemetryDirectory) => setDraft((current) => ({ ...current, telemetryDirectory }))} onBrowse={() => onPickDirectory(draft.telemetryDirectory, (telemetryDirectory) => setDraft((current) => ({ ...current, telemetryDirectory })))} help="比赛结束后，Desktop 会在此等待 iRacing 完成遥测写入。" />
      <Field label="OBS WebSocket 地址" value={draft.obsUrl} onChange={(obsUrl) => setDraft((current) => ({ ...current, obsUrl }))} help="通常为 ws://127.0.0.1:4455；保存后首页会自动检测 OBS 是否在线。" />
      <button className="primary" disabled={busy} type="submit">{busy ? "正在保存…" : "保存本地设置"}</button>
    </form>
    <section className="build-info"><h2>当前构建</h2>{buildInfo
      ? <p>LapWing {buildInfo.version ?? "未知版本"} · {buildInfo.gitHash ?? "未知提交"} · {buildInfo.branch ?? "local"}<br />构建时间：{buildInfo.builtAt ? new Date(buildInfo.builtAt).toLocaleString("zh-CN") : "未知"}</p>
      : <p>开发构建，未找到发布包 build-info.json。</p>}</section>
  </>;
}

function Field({ label, value, help, onChange }: { label: string; value: string; help: string; onChange: (value: string) => void }) {
  return <label className="field"><span>{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} /><small>{help}</small></label>;
}

function PathField({ label, value, help, placeholder, onChange, onBrowse }: {
  label: string;
  value: string;
  help?: string;
  placeholder?: string;
  onChange: (value: string) => void;
  onBrowse: () => void;
}) {
  return <div className="path-field">
    <span>{label}</span>
    <div className="path-input-row">
      <input aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
      <button className="secondary" type="button" onClick={onBrowse}>浏览…</button>
    </div>
    {help && <small>{help}</small>}
  </div>;
}

function SessionCard({ session, onClick }: { session: LocalSessionRecord; onClick: () => void }) {
  return <button className="session-card" type="button" onClick={onClick}><strong>{sessionTitle(session)}</strong><small>{sessionDate(session.createdAt)}</small><span>{session.videoAvailable ? "录像可用" : "仅遥测"}</span><b>{deliveryLabel(session.deliveryStatus)}</b></button>;
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="empty-state"><strong>{title}</strong><p>{detail}</p></div>;
}

function captureEventLabel(message: string): string {
  const phase = parseCaptureEvent(message);
  if (!phase) return message;
  switch (phase.kind) {
    case "lifecycle":
      return {
        connecting: "正在连接 iRacing 共享内存",
        live: "iRacing 已连接，等待绿旗",
        green: "绿旗亮起，开始录制",
        finished: "比赛结束，停止录制",
      }[phase.state];
    case "recording.started": return "OBS 已开始录制";
    case "recording.stopped": return "OBS 已停止录制";
    case "telemetry.finalized": return "遥测文件已稳定";
    case "bundle.created": return "本地 Session 已生成";
    case "error": return `录制引擎报错：${phase.message}`;
  }
}

function Activity({ events }: { events: AppEvent[] }) {
  if (events.length === 0) return null;
  return <section className="activity"><div className="section-head"><div><h2>活动记录</h2><p>本次打开应用期间的本地引擎消息。</p></div></div><ul>{events.slice(0, 8).map((event, index) => <li className={event.level} key={`${event.at}-${index}`}><time>{formatTime(event.at)}</time><span>{event.kind === "capture" ? captureEventLabel(event.message) : event.message}</span></li>)}</ul></section>;
}

function formatTime(value: string): string {
  const numeric = Number(value.replace(/Z$/, ""));
  const date = Number.isFinite(numeric) && numeric > 1_000_000_000 ? new Date(numeric * 1_000) : new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleTimeString("zh-CN");
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
