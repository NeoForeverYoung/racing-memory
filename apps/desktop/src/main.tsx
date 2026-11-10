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
import "./styles.css";

type View = "home" | "library" | "session" | "settings";
type AppEvent = { kind: "capture" | "delivery"; level: "info" | "error"; message: string; at: string; sessionId?: string };

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
  const [view, setView] = useState<View>("home");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [events, setEvents] = useState<AppEvent[]>([]);
  const [obsPassword, setObsPassword] = useState("");
  const [importTelemetryPath, setImportTelemetryPath] = useState("");
  const [importVideoPath, setImportVideoPath] = useState("");
  const [importPreset, setImportPreset] = useState<"scorecard" | "full">("scorecard");
  const [allowLowConfidence, setAllowLowConfidence] = useState(false);
  const [busy, setBusy] = useState<"capture" | "import" | "delivery" | "settings" | "rebuild" | null>(null);
  const [deliveryProgress, setDeliveryProgress] = useState<DeliveryProgress>({});
  const [message, setMessage] = useState<string | null>(null);
  const [obsReadiness, setObsReadiness] = useState<ObsReadiness | null>(null);
  const [captureActive, setCaptureActive] = useState(() => sessionStorage.getItem(CAPTURE_ACTIVE_KEY) === "1");
  const [capturePhase, setCapturePhase] = useState<CapturePhase | null>(readStoredPhase);
  const [obsRecord, setObsRecord] = useState<ObsRecordStatus | null>(null);
  const obsPasswordRef = useRef("");

  const selected = useMemo(
    () => state.sessions.find((session) => session.id === selectedId) ?? state.sessions[0] ?? null,
    [selectedId, state.sessions],
  );

  const refresh = async () => {
    try {
      const next = await invoke<DesktopState>("get_desktop_state");
      setState(next);
      setSelectedId((current) => current && next.sessions.some((session) => session.id === current) ? current : next.sessions[0]?.id ?? null);
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
      if (payload.sessionId) {
        setSelectedId(payload.sessionId);
        setView("session");
      }
      if (payload.level === "error") {
        setMessage(payload.message);
        setBusy(null);
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
        setBusy(null);
        setCaptureActive(false);
        setCapturePhase(null);
      }
    }).then((fn) => { unlisten = fn; });
    return () => unlisten?.();
  }, []);

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
    if (view !== "home" && view !== "settings") return;
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
    if (!state.settings.obsUrl.trim() || view !== "home") return;
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
    setSelectedId(session.id);
    setView("session");
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
    setMessage(null);
    try {
      await invoke("import_and_generate", {
        request: {
          telemetryPath: importTelemetryPath.trim(),
          videoPath: importVideoPath.trim() || null,
          preset: importPreset,
          acceptLowConfidence: allowLowConfidence,
        },
      });
    } catch (error) {
      setBusy(null);
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
      setView("home");
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
      setSelectedId(sessions[0]?.id ?? null);
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
      <button className="brand" type="button" onClick={() => setView("home")}><span>R</span> Racing Memory</button>
      <div className="engine-status"><i className={state.engineReady ? "good" : "bad"} />{state.engineReady ? "本地引擎已就绪" : "本地引擎需要检查"}</div>
    </header>
    <div className="workspace">
      <nav className="sidebar" aria-label="主导航">
        <NavButton active={view === "home"} onClick={() => setView("home")} label="首页" icon="⌂" />
        <NavButton active={view === "library"} onClick={() => setView("library")} label="历史 Session" icon="▤" count={state.sessions.length || undefined} />
        <NavButton active={view === "settings"} onClick={() => setView("settings")} label="设置" icon="⚙" />
        <p>所有分析、视频处理和数据归档都在这台电脑完成。原始录像不会被复制进 Racing Memory。</p>
      </nav>
      <section className="content">
        {message && <div className="notice error"><span>{message}</span><button type="button" onClick={() => setMessage(null)}>关闭</button></div>}
        {view === "home" && <Home
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
          importTelemetryPath={importTelemetryPath}
          setImportTelemetryPath={setImportTelemetryPath}
          importVideoPath={importVideoPath}
          setImportVideoPath={setImportVideoPath}
          importPreset={importPreset}
          setImportPreset={setImportPreset}
          importing={busy === "import"}
          onImport={importAndGenerate}
          onSettings={() => setView("settings")}
          onSession={chooseSession}
        />}
        {view === "library" && <Library sessions={state.sessions} selectedId={selected?.id ?? null} busy={busy === "rebuild"} onSelect={chooseSession} onRebuild={rebuildLibrary} />}
        {view === "session" && <SessionResult
          session={selected}
          busy={busy === "delivery"}
          progress={deliveryProgress}
          allowLowConfidence={allowLowConfidence}
          setAllowLowConfidence={setAllowLowConfidence}
          onGenerate={generateDelivery}
          onOpenWebAnalysis={openWebAnalysis}
          onOpenAsset={openAsset}
          onBack={() => setView("library")}
        />}
        {view === "settings" && <Settings settings={state.settings} buildInfo={state.buildInfo} obsReadiness={obsReadiness} busy={busy === "settings"} onSave={saveSettings} />}
        <Activity events={events} />
      </section>
    </div>
  </main>;
}

function NavButton({ active, label, icon, count, onClick }: { active: boolean; label: string; icon: string; count?: number; onClick: () => void }) {
  return <button className={active ? "nav active" : "nav"} type="button" onClick={onClick}><span>{icon}</span>{label}{count != null && <b>{count}</b>}</button>;
}

function Home({ state, obsReadiness, password, setPassword, canCapture, capturing, presentation, recordingStats, onResetCapture, onCapture, importTelemetryPath, setImportTelemetryPath, importVideoPath, setImportVideoPath, importPreset, setImportPreset, importing, onImport, onSettings, onSession }: {
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
  importTelemetryPath: string;
  setImportTelemetryPath: (value: string) => void;
  importVideoPath: string;
  setImportVideoPath: (value: string) => void;
  importPreset: "scorecard" | "full";
  setImportPreset: (value: "scorecard" | "full") => void;
  importing: boolean;
  onImport: () => void;
  onSettings: () => void;
  onSession: (session: LocalSessionRecord) => void;
}) {
  const configured = setupReady(state.settings);
  const obs = obsReadinessSummary(obsReadiness, state.settings);
  return <>
    <section className="hero">
      <div><p className="eyebrow">本地比赛回忆</p><h1>准备下一场比赛</h1><p>完成比赛后，自动将遥测、分析和赛后产物整理为一个本地 Session。</p></div>
      <button className="secondary" type="button" onClick={onSettings}>检查设置</button>
    </section>
    <section className={`capture-card stage-${presentation.stage}`}>
      <div>
        <p className="eyebrow">RACE DAY</p>
        <h2>{presentation.title}</h2>
        <p>{presentation.detail}</p>
        {presentation.stage === "recording" && <p className="capture-live"><i />{recordingStats ? `OBS 正在录制 · ${recordingStats}` : "OBS 正在录制…"}</p>}
        {capturing && presentation.stage !== "recording" && <button className="text-button capture-reset" type="button" onClick={onResetCapture}>重置录制状态</button>}
      </div>
      <div className="capture-actions">
        <label>OBS WebSocket 密码（本次运行）<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="如 OBS 未设置密码可留空" /></label>
        <button className={presentation.stage === "recording" ? "primary is-recording" : "primary"} type="button" disabled={!canCapture} onClick={onCapture}>{presentation.button}</button>
      </div>
    </section>
    <section className="readiness">
      <Readiness label="本地引擎" value={state.engineReady ? "已就绪" : "需修复"} good={state.engineReady} detail={state.engineError ?? "自带 FFmpeg 与本地分析 CLI，不含 OBS Studio。"} />
      <Readiness label="OBS Studio" value={obs.value} good={obs.good} detail={obs.detail} />
      <Readiness label="iRacing telemetry" value={configured ? "已配置" : "未配置"} good={configured} detail={state.settings.telemetryDirectory || "在设置中选择 IBT 目录"} />
      <Readiness label="本地数据目录" value={configured ? "已配置" : "未配置"} good={configured} detail={state.settings.dataRoot || "在设置中选择保存位置"} />
    </section>
    <section className="import-card">
      <div className="import-copy"><p className="eyebrow">已有文件</p><h2>从 IBT 和录像重新生成</h2><p>不需要启动 iRacing 或 OBS。IBT 必填；录像可选。成绩单模式只分析遥测，完整模式会额外生成视频交付物。</p></div>
      <div className="import-form">
        <label>IBT 文件路径<input value={importTelemetryPath} onChange={(event) => setImportTelemetryPath(event.target.value)} placeholder="C:\Users\...\Documents\iRacing\telemetry\race.ibt" /></label>
        <label>视频文件路径（可选）<input value={importVideoPath} onChange={(event) => setImportVideoPath(event.target.value)} placeholder="D:\Recordings\race.mp4" /></label>
        <div className="preset-buttons" role="group" aria-label="生成档位">
          <button className={importPreset === "scorecard" ? "selected" : ""} type="button" onClick={() => setImportPreset("scorecard")}>成绩单与报告</button>
          <button className={importPreset === "full" ? "selected" : ""} type="button" disabled={!importVideoPath.trim()} onClick={() => setImportPreset("full")}>完整视频交付</button>
        </div>
        <button className="primary" type="button" disabled={importing || !importTelemetryPath.trim() || importPreset === "full" && !importVideoPath.trim()} onClick={onImport}>{importing ? "正在导入并生成…" : "创建 Session 并生成"}</button>
      </div>
    </section>
    <section className="section-head"><div><h2>继续复盘</h2><p>最近的本地 Session。</p></div>{state.sessions.length > 0 && <button className="text-button" type="button" onClick={() => onSession(state.sessions[0])}>打开最近一场</button>}</section>
    {state.sessions.length === 0 ? <EmptyState title="还没有本地 Session" detail="先完成一次比赛录制，或在后续版本导入已有 IBT 与录像。" /> : <div className="session-grid">{state.sessions.slice(0, 3).map((session) => <SessionCard key={session.id} session={session} onClick={() => onSession(session)} />)}</div>}
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

function SessionResult({ session, busy, progress, allowLowConfidence, setAllowLowConfidence, onGenerate, onOpenWebAnalysis, onOpenAsset, onBack }: {
  session: LocalSessionRecord | null;
  busy: boolean;
  progress: DeliveryProgress;
  allowLowConfidence: boolean;
  setAllowLowConfidence: (value: boolean) => void;
  onGenerate: (preset: "scorecard" | "full") => void;
  onOpenWebAnalysis: () => void;
  onOpenAsset: (path: string) => void;
  onBack: () => void;
}) {
  if (!session) return <EmptyState title="请选择一个 Session" detail="从历史 Session 中选择一场比赛后，可查看状态并生成本地交付物。" />;
  const needsReview = session.syncRequiresReview && !allowLowConfidence;
  const overallPercent = deliveryOverallPercent(progress);
  const showProgress = busy || Object.keys(progress).length > 0;
  const visibleAssets = visibleSessionAssets(session.assets);
  const videoAssets = visibleAssets.filter((asset) => asset.group === "video" || asset.path.toLowerCase().endsWith(".mp4"));
  const overviewAssets = visibleAssets.filter((asset) => asset.group === "overview");
  const reportAssets = visibleAssets.filter((asset) =>
    asset.group === "report"
    || (!asset.group && !asset.path.toLowerCase().endsWith(".mp4") && !overviewAssets.includes(asset)),
  );
  return <>
    <section className="hero"><div><p className="eyebrow">SESSION RESULT</p><h1>{sessionTitle(session)}</h1><p>{sessionDate(session.createdAt)} · {session.game} · {session.sessionType ?? "Session"}</p></div><button className="secondary" type="button" onClick={onBack}>返回历史库</button></section>
    <section className="result-overview">
      <div><span>同步状态</span><strong className={session.syncConfidence === "high" ? "good-text" : ""}>{session.syncConfidence ? `${session.syncConfidence} 置信度` : "等待分析"}</strong></div>
      <div><span>录像</span><strong>{session.videoAvailable ? "原始录像可用" : "仅保存遥测与分析"}</strong></div>
      <div><span>交付状态</span><strong>{deliveryLabel(session.deliveryStatus)}</strong></div>
    </section>
    <section className="analysis-callout"><div><p className="eyebrow">深度复盘</p><h2>在 LapWing 中查看完整遥测</h2><p>打开本场 IBT 的赛道地图、逐圈表现、遥测曲线和同步录像。分析页面由本机提供，不上传数据。</p></div><button className="primary" type="button" onClick={onOpenWebAnalysis}>在 LapWing 中深度分析</button></section>
    {session.deliveryError && <div className="notice error"><span>{session.deliveryError}</span></div>}
    {session.trainingCard && <section className="training-card"><div><p className="eyebrow">NEXT PRACTICE</p><h2>下次练什么：{session.trainingCard.title}</h2><p>{session.trainingCard.detail}</p></div><div className="training-metrics"><span>当前损失 <strong>{session.trainingCard.baselineTimeLossMs} ms</strong></span><span>下次目标 <strong>≤ {session.trainingCard.targetTimeLossMs} ms</strong></span><span>证据置信度 <strong>{session.trainingCard.confidence}</strong></span></div><div className="training-copy"><strong>练习方式</strong><p>{session.trainingCard.exercise}</p><strong>完成标准</strong><p>{session.trainingCard.completionCriteria}</p></div></section>}
    {session.syncRequiresReview && <label className="review"><input type="checkbox" checked={allowLowConfidence} onChange={(event) => setAllowLowConfidence(event.target.checked)} />我已检查同步，允许低置信度时间轴继续生成。</label>}
    {showProgress && <section className="delivery-progress" aria-live="polite">
      <div className="progress-summary"><div><span>总进度</span><strong>{overallPercent}%</strong></div><progress max="100" value={overallPercent} /></div>
      <div className="progress-steps">{DELIVERY_STEPS.map(({ id, label }) => {
        const item = progress[id];
        const percent = item?.percent ?? 0;
        const status = item?.status === "failed" ? "失败" : item?.status === "completed" || item?.status === "skipped" ? "完成" : item?.status === "started" ? "处理中" : "等待";
        return <div className={`progress-step ${item?.status ?? "pending"}`} key={id}><div><strong>{label}</strong><span>{status}</span></div><progress max="100" value={percent} /><b>{percent}%</b>{item?.message && <small>{item.message}</small>}</div>;
      })}</div>
    </section>}
    <section className="delivery-card"><div><h2>生成赛后交付物</h2><p>成绩单模式只需要 IBT；完整模式会额外生成最快圈、OPT 和 Racing Memory Reel。所有文件只保存在本机。</p></div><div className="delivery-actions"><button className="secondary" type="button" disabled={busy} onClick={() => onGenerate("scorecard")}>{busy ? "正在生成…" : "生成成绩单与报告"}</button><button className="primary" type="button" disabled={busy || needsReview || !session.videoAvailable} onClick={() => onGenerate("full")}>生成完整视频交付</button></div></section>
    {!session.videoAvailable && <div className="notice"><span>原始录像目前不可用，因此不能生成视频交付物；已归档的遥测和本地 Session 信息仍可保留。</span></div>}
    <section className="section-head"><div><h2>赛后复盘</h2><p>先看关键结论，再按需要打开视频或完整报告；诊断文件不在这里展示。</p></div><button className="secondary" type="button" onClick={() => onOpenAsset(`${session.sessionDirectory}\\delivery`)}>高级：打开交付目录</button></section>
    {visibleAssets.length === 0
      ? <EmptyState title="尚未生成可查看的赛后产物" detail="完成交付后，这里会显示主成绩单、可播放的视频和完整赛后报告。" />
      : <>
        <AssetGroup title="一页总结" detail="快速了解这场比赛最重要的结果。" assets={overviewAssets} onOpen={onOpenAsset} />
        <AssetGroup title="比赛视频" detail="回看精彩片段、最快完整圈和理论 OPT。" assets={videoAssets} onOpen={onOpenAsset} />
        <AssetGroup title="完整报告" detail="查看逐圈表现、驾驶机会、训练建议和数据质量。" assets={reportAssets} onOpen={onOpenAsset} />
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

function Settings({ settings, buildInfo, obsReadiness, busy, onSave }: { settings: DesktopSettings; buildInfo?: DesktopState["buildInfo"]; obsReadiness: ObsReadiness | null; busy: boolean; onSave: (settings: DesktopSettings) => void }) {
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
      <Field label="Racing Memory 数据目录" value={draft.dataRoot} onChange={(dataRoot) => setDraft((current) => ({ ...current, dataRoot }))} help="Session、IBT 归档、成绩单和报告将保存在这里。原始 OBS 录像不会复制进来。" />
      <Field label="iRacing IBT 目录" value={draft.telemetryDirectory} onChange={(telemetryDirectory) => setDraft((current) => ({ ...current, telemetryDirectory }))} help="比赛结束后，Desktop 会在此等待 iRacing 完成遥测写入。" />
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
