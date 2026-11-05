import type { SessionAnalytics } from "./sessionAnalytics";

export type ScorecardVariant = "summary" | "track" | "laps" | "insights";

export interface ScorecardInsight {
  title: string;
  detail: string;
  confidence: number;
}

export interface ScorecardModel {
  analytics: SessionAnalytics;
  trackPoints: Array<{ lat: number; lon: number }>;
  insights?: ScorecardInsight[];
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
  ${polyline ? `<polyline points="${polyline}" fill="none" stroke="#8b7cff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>` : ""}
  ${insights.map((insight, index) => `<g transform="translate(650 ${250 + index * 94})">
    <text fill="#f4f5f7" font-family="Arial, sans-serif" font-size="20" font-weight="700">${escapeXml(insight.title)}</text>
    <text y="28" fill="#a9afbb" font-family="Arial, sans-serif" font-size="16">${escapeXml(insight.detail).slice(0, 58)}</text>
    <text y="53" fill="#777f8e" font-family="Arial, sans-serif" font-size="14">confidence ${Math.round(insight.confidence * 100)}%</text>
  </g>`).join("")}
</svg>`;
}

export function renderScorecardHtml(input: ScorecardRenderInput): string {
  const analyticsJson = escapeXml(JSON.stringify(input.analytics, null, 2));
  const summary = renderScorecardSvg(input, "summary");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>LapWing Session Report</title>
<style>body{font-family:system-ui;background:#111318;color:#f4f5f7;margin:0;padding:32px}main{max-width:1000px;margin:auto}svg{width:100%;height:auto;border-radius:16px}pre{background:#191c23;padding:20px;overflow:auto;border-radius:12px;color:#cdd1d8}</style>
</head><body><main><h1>LapWing Session Report</h1>
${summary}
<h2>Machine-readable analytics</h2><pre>${analyticsJson}</pre></main></body></html>`;
}
