import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./styles.css";

type CaptureSettings = {
  outputDirectory: string;
  telemetryDirectory: string;
  obsUrl: string;
  obsPassword: string;
};

type DeliverySettings = {
  bundlePath: string;
  outputDirectory: string;
  acceptLowConfidence: boolean;
};

type AppEvent = { kind: "capture" | "delivery"; level: "info" | "error"; message: string; at: string };

const DEFAULT_CAPTURE: CaptureSettings = {
  outputDirectory: "C:\\RacingMemory\\Sessions",
  telemetryDirectory: "C:\\Users\\%USERNAME%\\Documents\\iRacing\\telemetry",
  obsUrl: "ws://127.0.0.1:4455",
  obsPassword: "",
};

function App() {
  const [capture, setCapture] = useState(DEFAULT_CAPTURE);
  const [delivery, setDelivery] = useState<DeliverySettings>({ bundlePath: "", outputDirectory: "C:\\RacingMemory\\Output", acceptLowConfidence: false });
  const [events, setEvents] = useState<AppEvent[]>([]);
  const [busy, setBusy] = useState<"capture" | "delivery" | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void invoke<boolean>("desktop_ready").then(setReady).catch((error) => addEvent({ kind: "capture", level: "error", message: String(error), at: new Date().toISOString() }));
    let unlisten: (() => void) | undefined;
    void listen<AppEvent>("racing-memory://event", ({ payload }) => addEvent(payload)).then((fn) => { unlisten = fn; });
    return () => unlisten?.();
  }, []);

  const addEvent = (event: AppEvent) => setEvents((current) => [event, ...current].slice(0, 80));
  const latestError = useMemo(() => events.find((event) => event.level === "error"), [events]);
  const updateCapture = <K extends keyof CaptureSettings>(key: K, value: CaptureSettings[K]) => setCapture((current) => ({ ...current, [key]: value }));

  async function startCapture() {
    setBusy("capture");
    try {
      await invoke("start_capture", { settings: capture });
      addEvent({ kind: "capture", level: "info", message: "已开始等待 iRacing。进入绿旗时将同时建立 OBS 与 IBT 同步锚点。", at: new Date().toISOString() });
    } catch (error) {
      addEvent({ kind: "capture", level: "error", message: String(error), at: new Date().toISOString() });
    } finally { setBusy(null); }
  }

  async function runDelivery() {
    setBusy("delivery");
    try {
      await invoke("run_delivery", { settings: { ...delivery, bundlePath: delivery.bundlePath || lastBundle } });
      addEvent({ kind: "delivery", level: "info", message: "已提交一键生成任务。", at: new Date().toISOString() });
    } catch (error) {
      addEvent({ kind: "delivery", level: "error", message: String(error), at: new Date().toISOString() });
    } finally { setBusy(null); }
  }

  const lastBundle = events.find((event) => event.message.includes("Bundle created:"))?.message.replace("Bundle created: ", "") ?? "";

  return <main>
    <header><div><p className="eyebrow">WINDOWS 11 · OFFLINE DESKTOP</p><h1>Racing Memory</h1><p className="subhead">比赛结束后，把录像、IBT 和完整赛后交付自动整理到同一个文件夹。</p></div><span className={ready ? "badge online" : "badge"}>{ready ? "引擎已就绪" : "检查随附工具…"}</span></header>

    <section className="card"><div className="section-title"><span>01</span><div><h2>同步录制</h2><p>绿旗触发 OBS 录制；结束后等待 IBT 写入完成，再用开始/停止锚点自动校验时间轴。</p></div></div>
      <div className="grid">
        <Field label="会话保存目录" value={capture.outputDirectory} onChange={(value) => updateCapture("outputDirectory", value)} />
        <Field label="iRacing IBT 目录" value={capture.telemetryDirectory} onChange={(value) => updateCapture("telemetryDirectory", value)} />
        <Field label="OBS WebSocket 地址" value={capture.obsUrl} onChange={(value) => updateCapture("obsUrl", value)} />
        <Field label="OBS WebSocket 密码（仅本次运行）" value={capture.obsPassword} type="password" onChange={(value) => updateCapture("obsPassword", value)} />
      </div>
      <button disabled={!ready || busy !== null} onClick={startCapture}>{busy === "capture" ? "正在启动…" : "开始等待比赛"}</button>
      <p className="hint">要求：OBS 已打开且启用 WebSocket；iRacing 的 telemetry 记录已开启。密码不会写入文件或日志。</p>
    </section>

    <section className="card"><div className="section-title"><span>02</span><div><h2>一键生成交付</h2><p>自动检查并保存同步结果，然后生成纪念图、完整圈速（冲线后保留 5 秒显示 Last）、OPT 视频、报告和 JSON 清单。</p></div></div>
      <div className="grid">
        <Field label="Session bundle JSON" value={delivery.bundlePath || lastBundle} placeholder="同步录制完成后自动显示，或粘贴现有 bundle 路径" onChange={(value) => setDelivery((current) => ({ ...current, bundlePath: value }))} />
        <Field label="输出目录" value={delivery.outputDirectory} onChange={(value) => setDelivery((current) => ({ ...current, outputDirectory: value }))} />
      </div>
      <label className="check"><input type="checkbox" checked={delivery.acceptLowConfidence} onChange={(event) => setDelivery((current) => ({ ...current, acceptLowConfidence: event.target.checked }))} /> 我已检查同步，允许低置信度时间轴继续生成</label>
      <button disabled={!ready || busy !== null || !(delivery.bundlePath || lastBundle)} onClick={runDelivery}>{busy === "delivery" ? "正在生成…" : "生成全部交付物"}</button>
      {latestError && <p className="error">最近错误：{latestError.message}</p>}
    </section>

    <section className="card log"><div className="section-title"><span>活动</span><div><h2>进度与错误原因</h2><p>OBS、IBT、同步检查和导出步骤的实时记录。</p></div></div>
      {events.length === 0 ? <p className="empty">尚无活动。</p> : <ul>{events.map((event, index) => <li className={event.level} key={`${event.at}-${index}`}><time>{formatTime(event.at)}</time><span>{event.message}</span></li>)}</ul>}
    </section>
  </main>;
}

function Field({ label, value, placeholder, type = "text", onChange }: { label: string; value: string; placeholder?: string; type?: string; onChange: (value: string) => void }) {
  return <label className="field"><span>{label}</span><input type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></label>;
}

function formatTime(value: string): string {
  const numeric = Number(value.replace(/Z$/, ""));
  const date = Number.isFinite(numeric) && numeric > 1_000_000_000 ? new Date(numeric * 1000) : new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleTimeString("zh-CN");
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
