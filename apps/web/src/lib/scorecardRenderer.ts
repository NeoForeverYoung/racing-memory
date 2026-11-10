import type { SessionAnalytics } from "./sessionAnalytics";

export type ScorecardVariant = "summary" | "track" | "laps" | "insights";

export interface ScorecardInsight {
  title: string;
  detail: string;
  confidence: number;
}

export interface ScorecardLapRow {
  lapNumber: number;
  lapTimeMs: number;
  incomplete?: boolean;
}

export interface ScorecardTrainingCard {
  title: string;
  detail: string;
  exercise: string;
  completionCriteria: string;
  confidence: "low" | "medium" | "high";
}

export interface ScorecardModel {
  analytics: SessionAnalytics;
  trackPoints: Array<{ lat: number; lon: number }>;
  insights?: ScorecardInsight[];
  laps?: ScorecardLapRow[];
  trainingCard?: ScorecardTrainingCard | null;
  generatedAt?: string;
  generatorVersion?: string;
}

export type ScorecardRenderInput = ScorecardModel;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatLap(milliseconds: number | null): string {
  if (milliseconds == null) return "—";
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = (milliseconds % 60_000) / 1000;
  return `${minutes}:${seconds.toFixed(3).padStart(6, "0")}`;
}

function formatDuration(milliseconds: number): string {
  const totalMinutes = Math.max(0, Math.round(milliseconds / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours} 小时 ${minutes} 分钟` : `${minutes} 分钟`;
}

function formatConsistency(milliseconds: number | null): string {
  if (milliseconds == null) return "样本不足";
  return `± ${(milliseconds / 1000).toFixed(3)} 秒`;
}

function trackPolyline(points: Array<{ lat: number; lon: number }>): string {
  if (points.length < 2) return "";
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const point of points) {
    minLat = Math.min(minLat, point.lat);
    maxLat = Math.max(maxLat, point.lat);
    minLon = Math.min(minLon, point.lon);
    maxLon = Math.max(maxLon, point.lon);
  }
  const latRange = Math.max(1e-9, maxLat - minLat);
  const lonRange = Math.max(1e-9, maxLon - minLon);
  return points
    .filter((_, index) => index % Math.max(1, Math.floor(points.length / 500)) === 0)
    .map((point) => {
      const x = 650 + ((point.lon - minLon) / lonRange) * 440;
      const y = 570 - ((point.lat - minLat) / latRange) * 460;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function renderScorecardSvg(
  input: ScorecardRenderInput,
  variant: ScorecardVariant = "summary",
): string {
  const { analytics } = input;
  const title = variant === "summary"
    ? "SESSION SCORECARD"
    : variant === "track"
      ? "TRACK MAP"
      : variant === "laps"
        ? "LAP PERFORMANCE"
        : "DRIVING INSIGHTS";
  const track = escapeXml(analytics.metadata.track ?? "Unknown track");
  const course = escapeXml(analytics.metadata.course ?? "");
  const vehicle = escapeXml(analytics.metadata.vehicle ?? "Unknown vehicle");
  const insights = input.insights?.slice(0, 3) ?? [];
  const polyline = trackPolyline(input.trackPoints);
  const lapRows = (input.laps ?? [])
    .filter((lap) => !lap.incomplete && lap.lapTimeMs > 0)
    .sort((left, right) => left.lapTimeMs - right.lapTimeMs)
    .slice(0, 5);
  const rightContent = variant === "laps"
    ? lapRows.map((lap, index) => `<g transform="translate(650 ${250 + index * 58})">
    <text fill="#a9afbb" font-family="Arial, sans-serif" font-size="17">LAP ${lap.lapNumber}</text>
    <text x="170" fill="#f4f5f7" font-family="monospace" font-size="21" font-weight="700">${formatLap(lap.lapTimeMs)}</text>
  </g>`).join("")
    : variant === "insights"
      ? insights.map((insight, index) => `<g transform="translate(650 ${250 + index * 94})">
    <text fill="#f4f5f7" font-family="Arial, sans-serif" font-size="20" font-weight="700">${escapeXml(insight.title)}</text>
    <text y="28" fill="#a9afbb" font-family="Arial, sans-serif" font-size="16">${escapeXml(insight.detail).slice(0, 58)}</text>
    <text y="53" fill="#777f8e" font-family="Arial, sans-serif" font-size="14">confidence ${Math.round(insight.confidence * 100)}%</text>
  </g>`).join("")
      : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
  <rect width="1200" height="675" fill="#111318"/>
  <rect x="40" y="38" width="1120" height="599" rx="20" fill="#191c23" stroke="#343946"/>
  <text x="76" y="92" fill="#8b7cff" font-family="Arial, sans-serif" font-size="22" font-weight="700">LAPWING</text>
  <text x="76" y="132" fill="#f4f5f7" font-family="Arial, sans-serif" font-size="34" font-weight="700">${title}</text>
  <text x="76" y="171" fill="#a9afbb" font-family="Arial, sans-serif" font-size="22">${track}${course ? ` · ${course}` : ""}</text>
  <text x="76" y="204" fill="#777f8e" font-family="Arial, sans-serif" font-size="18">${vehicle}</text>
  <text x="76" y="282" fill="#777f8e" font-family="Arial, sans-serif" font-size="17">FASTEST LAP</text>
  <text x="76" y="330" fill="#f4f5f7" font-family="monospace" font-size="42" font-weight="700">${formatLap(analytics.fastestLapMs)}</text>
  <text x="76" y="390" fill="#777f8e" font-family="Arial, sans-serif" font-size="17">AVERAGE</text>
  <text x="76" y="430" fill="#f4f5f7" font-family="monospace" font-size="30">${formatLap(analytics.averageLapMs)}</text>
  <text x="76" y="486" fill="#777f8e" font-family="Arial, sans-serif" font-size="17">OPTIMAL</text>
  <text x="76" y="526" fill="#f4f5f7" font-family="monospace" font-size="30">${formatLap(analytics.optimalLapMs)}</text>
  <text x="76" y="588" fill="#a9afbb" font-family="Arial, sans-serif" font-size="18">${analytics.completeLapCount} complete laps</text>
  ${polyline && variant !== "laps" && variant !== "insights" ? `<polyline points="${polyline}" fill="none" stroke="#8b7cff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>` : ""}
  ${variant === "summary" ? insights.slice(0, 1).map((insight) => `<g transform="translate(650 250)">
    <text fill="#f4f5f7" font-family="Arial, sans-serif" font-size="20" font-weight="700">${escapeXml(insight.title)}</text>
    <text y="28" fill="#a9afbb" font-family="Arial, sans-serif" font-size="16">${escapeXml(insight.detail).slice(0, 58)}</text>
    <text y="53" fill="#777f8e" font-family="Arial, sans-serif" font-size="14">confidence ${Math.round(insight.confidence * 100)}%</text>
  </g>`).join("") : rightContent}
</svg>`;
}

export function renderScorecardHtml(input: ScorecardRenderInput): string {
  const { analytics } = input;
  const summary = renderScorecardSvg(input, "summary");
  const laps = (input.laps ?? [])
    .filter((lap) => lap.lapTimeMs > 0)
    .sort((left, right) => left.lapNumber - right.lapNumber);
  const fastest = analytics.fastestLapNumber;
  const insights = input.insights ?? [];
  const metadata = analytics.metadata;
  const generatedAt = input.generatedAt
    ? new Date(input.generatedAt).toLocaleString("zh-CN")
    : new Date().toLocaleString("zh-CN");
  const quality = analytics.dataQuality
    ? `${(analytics.dataQuality.acceptanceRate * 100).toFixed(1)}%（${analytics.dataQuality.acceptedRows} 条有效，${analytics.dataQuality.rejectedRows} 条剔除）`
    : "源文件未提供行级质量统计";
  const rows = laps.length > 0
    ? laps.map((lap) => `<tr${lap.lapNumber === fastest ? ' class="fastest"' : ""}>
      <td>第 ${lap.lapNumber} 圈${lap.lapNumber === fastest ? ' <span class="badge">最快</span>' : ""}</td>
      <td>${formatLap(lap.lapTimeMs)}</td>
      <td>${lap.incomplete ? "不完整" : "完整"}</td>
    </tr>`).join("")
    : '<tr><td colspan="3" class="muted">没有可展示的逐圈数据。</td></tr>';
  const insightSection = insights.length > 0
    ? `<h2>最值得关注的机会</h2><div class="grid">${insights.map((insight) => `<article class="card">
      <div class="card-head"><h3>${escapeXml(insight.title)}</h3><span class="confidence">置信度 ${Math.round(insight.confidence * 100)}%</span></div>
      <p>${escapeXml(insight.detail)}</p>
    </article>`).join("")}</div>`
    : "";
  const trainingSection = input.trainingCard
    ? `<h2>下次练什么</h2><article class="training">
      <p class="kicker">下一次只练这一件事</p>
      <h3>${escapeXml(input.trainingCard.title)}</h3>
      <p>${escapeXml(input.trainingCard.detail)}</p>
      <dl><div><dt>练习方式</dt><dd>${escapeXml(input.trainingCard.exercise)}</dd></div>
      <div><dt>完成标准</dt><dd>${escapeXml(input.trainingCard.completionCriteria)}</dd></div></dl>
    </article>`
    : "";
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>LapWing 赛后报告 · ${escapeXml(metadata.track ?? "未命名赛道")}</title>
<style>
:root{color-scheme:dark;font-family:Inter,"Microsoft YaHei UI",system-ui,sans-serif;background:#0d0f14;color:#f4f5f7}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 80% 0,#28204b 0,transparent 30rem),#0d0f14}
main{width:min(1080px,calc(100% - 32px));margin:auto;padding:38px 0 70px}.hero{display:flex;justify-content:space-between;gap:24px;align-items:end;margin-bottom:22px}
.kicker{margin:0 0 7px;color:#9a8cff;font-size:12px;font-weight:800;letter-spacing:.09em;text-transform:uppercase}h1{margin:0;font-size:34px}h2{margin:34px 0 13px;font-size:21px}h3{margin:0;font-size:16px}
.sub,.muted,footer{color:#969daa}.sub{margin:8px 0 0}.hero-meta{text-align:right;font-size:12px;line-height:1.7;color:#969daa}
svg{display:block;width:100%;height:auto;border-radius:16px;box-shadow:0 18px 60px #0007}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:14px}
.metric,.card,.training,.table-wrap{border:1px solid #303540;border-radius:12px;background:#181b22}.metric{padding:15px}.metric span{display:block;color:#858c99;font-size:11px}.metric strong{display:block;margin-top:7px;font-size:20px}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.card{padding:16px}.card p{margin:10px 0 0;color:#b7bdc7;line-height:1.55}.card-head{display:flex;justify-content:space-between;gap:12px}
.confidence,.badge{border-radius:99px;background:#28233e;color:#b7aefe;font-size:10px;padding:4px 7px;white-space:nowrap}.table-wrap{overflow:hidden}table{width:100%;border-collapse:collapse}
th,td{padding:12px 14px;border-bottom:1px solid #2b2f38;text-align:left;font-size:13px}th{color:#858c99;font-size:11px}.fastest{background:#25213a}.badge{margin-left:6px}
.training{padding:20px;border-color:#514776;background:linear-gradient(130deg,#211d31,#191b23)}.training>p{color:#c3c8d1;line-height:1.6}.training dl{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.training dl div{padding:13px;border-radius:9px;background:#111319}.training dt{color:#9a8cff;font-size:11px;font-weight:700}.training dd{margin:7px 0 0;color:#cbd0d8;font-size:13px;line-height:1.55}
.quality{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.quality div{padding:14px;border-left:2px solid #4e456e;background:#15181f}.quality span{display:block;color:#858c99;font-size:11px}.quality strong{display:block;margin-top:6px;font-size:13px}
footer{margin-top:36px;padding-top:18px;border-top:1px solid #292d35;font-size:11px}
@media(max-width:720px){main{width:min(100% - 20px,1080px);padding-top:24px}.hero{align-items:start;flex-direction:column}.hero-meta{text-align:left}.metrics,.quality,.grid,.training dl{grid-template-columns:1fr 1fr}h1{font-size:27px}}
@media(max-width:460px){.metrics,.quality,.grid,.training dl{grid-template-columns:1fr}}
</style></head><body><main>
<header class="hero"><div><p class="kicker">LapWing 赛后复盘</p><h1>${escapeXml(metadata.track ?? "未命名赛道")}</h1>
<p class="sub">${escapeXml([metadata.course, metadata.vehicle, metadata.sessionType].filter(Boolean).join(" · ") || "本地 Session")}</p></div>
<div class="hero-meta">生成于 ${escapeXml(generatedAt)}<br>${escapeXml(input.generatorVersion ? `LapWing ${input.generatorVersion}` : "LapWing 本地分析")}</div></header>
${summary}
<section class="metrics"><div class="metric"><span>最快完整圈</span><strong>${formatLap(analytics.fastestLapMs)}</strong></div>
<div class="metric"><span>平均有效圈</span><strong>${formatLap(analytics.averageLapMs)}</strong></div>
<div class="metric"><span>理论最佳圈</span><strong>${formatLap(analytics.optimalLapMs)}</strong></div>
<div class="metric"><span>稳定性</span><strong>${formatConsistency(analytics.consistencyStdDevMs)}</strong></div></section>
<h2>逐圈表现</h2><div class="table-wrap"><table><thead><tr><th>圈次</th><th>圈速</th><th>状态</th></tr></thead><tbody>${rows}</tbody></table></div>
${insightSection}
${trainingSection}
<h2>数据说明</h2><section class="quality"><div><span>完整圈</span><strong>${analytics.completeLapCount} 圈</strong></div>
<div><span>Session 时长</span><strong>${formatDuration(analytics.durationMs)}</strong></div>
<div><span>数据质量</span><strong>${escapeXml(quality)}</strong></div></section>
<footer>该报告完全在本机生成。更深入的赛道地图、遥测曲线、圈间叠加和视频同步请在 LapWing 分析界面中查看。</footer>
</main></body></html>`;
}
