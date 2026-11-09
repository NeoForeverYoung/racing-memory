/* eslint-disable react-refresh/only-export-components */
import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  DELIVERY_STEPS,
  assetDisplayLabel,
  deliveryLabel,
  deliveryOverallPercent,
  isPreviewableImage,
  parseDeliveryProgress,
  sessionDate,
  sessionTitle,
  setupReady,
  visibleSessionAssets,
  type DeliveryProgress,
  type DesktopSettings,
  type DesktopState,
  type LocalSessionRecord,
} from "./sessionModel";
import "./styles.css";

type View = "home" | "library" | "session" | "settings";
type AppEvent = { kind: "capture" | "delivery"; level: "info" | "error"; message: string; at: string; sessionId?: string };

const EMPTY_STATE: DesktopState = {
  settings: { dataRoot: "", telemetryDirectory: "", obsUrl: "" },
  sessions: [],
  engineReady: false,
  engineError: null,
};

function App() {
  const [state, setState] = useState<DesktopState>(EMPTY_STATE);
  const [view, setView] = useState<View>("home");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [events, setEvents] = useState<AppEvent[]>([]);
  const [obsPassword, setObsPassword] = useState("");
  const [allowLowConfidence, setAllowLowConfidence] = useState(false);
  const [busy, setBusy] = useState<"capture" | "delivery" | "settings" | "rebuild" | null>(null);
  const [deliveryProgress, setDeliveryProgress] = useState<DeliveryProgress>({});
  const [message, setMessage] = useState<string | null>(null);

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
      if (payload.sessionId) {
        setSelectedId(payload.sessionId);
        setView("session");
      }
      if (payload.level === "error") {
        setMessage(payload.message);
        setBusy(null);
        void refresh();
      }
      if (payload.message === "Session is ready to review." || payload.message === "Race assets are ready.") {
        void refresh();
        setBusy(null);
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

  const chooseSession = (session: LocalSessionRecord) => {
    setSelectedId(session.id);
    setView("session");
    setAllowLowConfidence(false);
    setDeliveryProgress({});
  };

  const startCapture = async () => {
    setBusy("capture");
    setMessage(null);
    try {
      await invoke("start_capture", { request: { obsPassword } });
      setObsPassword("");
    } catch (error) {
      setBusy(null);
      setMessage(String(error));
    }
  };

  const generateDelivery = async () => {
    if (!selected) return;
    setBusy("delivery");
    setDeliveryProgress({});
    setMessage(null);
    try {
      await invoke("run_delivery", { request: { sessionId: selected.id, acceptLowConfidence: allowLowConfidence } });
      await refresh();
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

  const canCapture = state.engineReady && setupReady(state.settings) && busy === null;

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
          password={obsPassword}
          setPassword={setObsPassword}
          canCapture={canCapture}
          capturing={busy === "capture"}
          onCapture={startCapture}
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
          onOpenAsset={openAsset}
          onBack={() => setView("library")}
        />}
        {view === "settings" && <Settings settings={state.settings} busy={busy === "settings"} onSave={saveSettings} />}
        <Activity events={events} />
      </section>
    </div>
  </main>;
}

function NavButton({ active, label, icon, count, onClick }: { active: boolean; label: string; icon: string; count?: number; onClick: () => void }) {
  return <button className={active ? "nav active" : "nav"} type="button" onClick={onClick}><span>{icon}</span>{label}{count != null && <b>{count}</b>}</button>;
}

function Home({ state, password, setPassword, canCapture, capturing, onCapture, onSettings, onSession }: {
  state: DesktopState;
  password: string;
  setPassword: (value: string) => void;
  canCapture: boolean;
  capturing: boolean;
  onCapture: () => void;
  onSettings: () => void;
  onSession: (session: LocalSessionRecord) => void;
}) {
  const configured = setupReady(state.settings);
  return <>
    <section className="hero">
      <div><p className="eyebrow">本地比赛回忆</p><h1>准备下一场比赛</h1><p>完成比赛后，自动将遥测、分析和赛后产物整理为一个本地 Session。</p></div>
      <button className="secondary" type="button" onClick={onSettings}>检查设置</button>
    </section>
    <section className="capture-card">
      <div><p className="eyebrow">RACE DAY</p><h2>{capturing ? "正在等待 iRacing…" : "准备录制"}</h2><p>{capturing ? "绿旗时会启动 OBS；比赛结束后将等待 IBT 与录像稳定。可最小化窗口，完成后会自动出现新的 Session。" : "点击后等待 iRacing。OBS 密码只在本次录制进程中使用，不会写入本地配置。"}</p></div>
      <div className="capture-actions">
        <label>OBS WebSocket 密码（本次运行）<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="如 OBS 未设置密码可留空" /></label>
        <button className="primary" type="button" disabled={!canCapture} onClick={onCapture}>{capturing ? "正在等待比赛" : "准备录制"}</button>
      </div>
    </section>
    <section className="readiness">
      <Readiness label="本地引擎" value={state.engineReady ? "已就绪" : "需修复"} good={state.engineReady} detail={state.engineError ?? "包含录制、分析与 FFmpeg 处理能力"} />
      <Readiness label="iRacing telemetry" value={configured ? "已配置" : "未配置"} good={configured} detail={state.settings.telemetryDirectory || "在设置中选择 IBT 目录"} />
      <Readiness label="本地数据目录" value={configured ? "已配置" : "未配置"} good={configured} detail={state.settings.dataRoot || "在设置中选择保存位置"} />
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

function SessionResult({ session, busy, progress, allowLowConfidence, setAllowLowConfidence, onGenerate, onOpenAsset, onBack }: {
  session: LocalSessionRecord | null;
  busy: boolean;
  progress: DeliveryProgress;
  allowLowConfidence: boolean;
  setAllowLowConfidence: (value: boolean) => void;
  onGenerate: () => void;
  onOpenAsset: (path: string) => void;
  onBack: () => void;
}) {
  if (!session) return <EmptyState title="请选择一个 Session" detail="从历史 Session 中选择一场比赛后，可查看状态并生成本地交付物。" />;
  const needsReview = session.syncRequiresReview && !allowLowConfidence;
  const overallPercent = deliveryOverallPercent(progress);
  const showProgress = busy || Object.keys(progress).length > 0;
  const visibleAssets = visibleSessionAssets(session.assets);
  return <>
    <section className="hero"><div><p className="eyebrow">SESSION RESULT</p><h1>{sessionTitle(session)}</h1><p>{sessionDate(session.createdAt)} · {session.game} · {session.sessionType ?? "Session"}</p></div><button className="secondary" type="button" onClick={onBack}>返回历史库</button></section>
    <section className="result-overview">
      <div><span>同步状态</span><strong className={session.syncConfidence === "high" ? "good-text" : ""}>{session.syncConfidence ? `${session.syncConfidence} 置信度` : "等待分析"}</strong></div>
      <div><span>录像</span><strong>{session.videoAvailable ? "原始录像可用" : "仅保存遥测与分析"}</strong></div>
      <div><span>交付状态</span><strong>{deliveryLabel(session.deliveryStatus)}</strong></div>
    </section>
    {session.deliveryError && <div className="notice error"><span>{session.deliveryError}</span></div>}
    {session.trainingCard && <section className="training-card"><div><p className="eyebrow">NEXT PRACTICE</p><h2>下次练什么：{session.trainingCard.title}</h2><p>{session.trainingCard.detail}</p></div><div className="training-metrics"><span>当前损失 <strong>{session.trainingCard.baselineTimeLossMs} ms</strong></span><span>下次目标 <strong>≤ {session.trainingCard.targetTimeLossMs} ms</strong></span><span>证据置信度 <strong>{session.trainingCard.confidence}</strong></span></div><div className="training-copy"><strong>练习方式</strong><p>{session.trainingCard.exercise}</p><strong>完成标准</strong><p>{session.trainingCard.completionCriteria}</p></div></section>}
    {session.trainingReason && <div className="notice"><span>本场暂未生成训练卡：{session.trainingReason}</span></div>}
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
    <section className="delivery-card"><div><h2>赛后交付物</h2><p>将生成最快完整圈、OPT 拼接视频、赛后成绩单、报告、Racing Memory reel 与驾驶建议。所有文件只保存在本机。</p></div><button className="primary" type="button" disabled={busy || needsReview || !session.videoAvailable} onClick={onGenerate}>{busy ? "正在生成…" : session.deliveryStatus === "succeeded" ? "重新生成交付物" : "生成全部交付物"}</button></section>
    {!session.videoAvailable && <div className="notice"><span>原始录像目前不可用，因此不能生成视频交付物；已归档的遥测和本地 Session 信息仍可保留。</span></div>}
    <section className="section-head"><div><h2>可查看的交付物</h2><p>点击视频播放、点击图片查看原图；内部 JSON 和 SVG 文件不再展示。</p></div><button className="secondary" type="button" onClick={() => onOpenAsset(`${session.sessionDirectory}\\delivery`)}>打开交付目录</button></section>
    {visibleAssets.length === 0 ? <EmptyState title="尚未生成可查看的赛后产物" detail="完成交付后，这里会显示可播放的视频、图片和赛后报告。" /> : <div className="asset-list">{visibleAssets.map((asset) => <AssetCard asset={asset} onOpen={onOpenAsset} key={asset.path} />)}</div>}
  </>;
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
    <span>{assetDisplayLabel(asset)}</span>
    <strong>{fileName}</strong>
    <small>{isPreviewableImage(asset.path) ? "点击查看原图" : "点击打开"}</small>
  </button>;
}

function Settings({ settings, busy, onSave }: { settings: DesktopSettings; busy: boolean; onSave: (settings: DesktopSettings) => void }) {
  const [draft, setDraft] = useState(settings);
  useEffect(() => setDraft(settings), [settings]);
  return <>
    <section className="hero"><div><p className="eyebrow">LOCAL SETUP</p><h1>本地设置</h1><p>这些路径仅保存在此电脑。OBS 密码不会写入配置，每次准备录制时输入。</p></div></section>
    <form className="settings-form" onSubmit={(event) => { event.preventDefault(); onSave(draft); }}>
      <Field label="Racing Memory 数据目录" value={draft.dataRoot} onChange={(dataRoot) => setDraft((current) => ({ ...current, dataRoot }))} help="Session、IBT 归档、成绩单和报告将保存在这里。原始 OBS 录像不会复制进来。" />
      <Field label="iRacing IBT 目录" value={draft.telemetryDirectory} onChange={(telemetryDirectory) => setDraft((current) => ({ ...current, telemetryDirectory }))} help="比赛结束后，Desktop 会在此等待 iRacing 完成遥测写入。" />
      <Field label="OBS WebSocket 地址" value={draft.obsUrl} onChange={(obsUrl) => setDraft((current) => ({ ...current, obsUrl }))} help="通常为 ws://127.0.0.1:4455。" />
      <button className="primary" disabled={busy} type="submit">{busy ? "正在保存…" : "保存本地设置"}</button>
    </form>
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

function Activity({ events }: { events: AppEvent[] }) {
  if (events.length === 0) return null;
  return <section className="activity"><div className="section-head"><div><h2>活动记录</h2><p>本次打开应用期间的本地引擎消息。</p></div></div><ul>{events.slice(0, 8).map((event, index) => <li className={event.level} key={`${event.at}-${index}`}><time>{formatTime(event.at)}</time><span>{event.message}</span></li>)}</ul></section>;
}

function formatTime(value: string): string {
  const numeric = Number(value.replace(/Z$/, ""));
  const date = Number.isFinite(numeric) && numeric > 1_000_000_000 ? new Date(numeric * 1_000) : new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleTimeString("zh-CN");
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
