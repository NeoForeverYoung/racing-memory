import { existsSync, statSync } from "node:fs";
import { basename, resolve, sep } from "node:path";

const values = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  values.set(process.argv[index], process.argv[index + 1]);
}

const telemetryPath = resolve(values.get("--telemetry") ?? "");
const videoValue = values.get("--video");
const videoPath = videoValue ? resolve(videoValue) : null;
const webRoot = resolve(values.get("--web-root") ?? "apps/web/dist-full");
const port = Number(values.get("--port") ?? 8090);

if (!existsSync(telemetryPath) || !statSync(telemetryPath).isFile()) throw new Error("--telemetry must point to an existing file.");
if (videoPath && (!existsSync(videoPath) || !statSync(videoPath).isFile())) throw new Error("--video must point to an existing file.");
if (!existsSync(resolve(webRoot, "index.html"))) throw new Error("Build apps/web Full before starting local analysis.");

function contentType(path) {
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  if (path.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".json")) return "application/json; charset=utf-8";
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".woff2")) return "font/woff2";
  if (path.endsWith(".mp4")) return "video/mp4";
  return "application/octet-stream";
}

function rangedFile(request, path) {
  const file = Bun.file(path);
  const range = request.headers.get("range");
  if (!range) return new Response(file, { headers: { "Content-Type": contentType(path), "Accept-Ranges": "bytes", "Cache-Control": "no-store" } });
  const match = /^bytes=(\d+)-(\d*)$/.exec(range);
  if (!match) return new Response("Invalid range", { status: 416 });
  const start = Number(match[1]);
  const end = match[2] ? Math.min(Number(match[2]), file.size - 1) : file.size - 1;
  if (start >= file.size || end < start) return new Response("Invalid range", { status: 416 });
  return new Response(file.slice(start, end + 1), {
    status: 206,
    headers: {
      "Content-Type": contentType(path),
      "Content-Length": String(end - start + 1),
      "Content-Range": `bytes ${start}-${end}/${file.size}`,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    },
  });
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/api/session/dev") {
      return Response.json({
        telemetryUrl: "/api/session/dev/telemetry",
        telemetryFileName: basename(telemetryPath),
        video: videoPath ? { url: "/api/session/dev/video", fileName: basename(videoPath) } : undefined,
        sync: { offsetMs: 0, rate: 1, confidence: "reviewed", requiresReview: false },
        autoUseWaypoint: true,
      }, { headers: { "Cache-Control": "no-store" } });
    }
    if (url.pathname === "/api/session/dev/telemetry") return rangedFile(request, telemetryPath);
    if (url.pathname === "/api/session/dev/video" && videoPath) return rangedFile(request, videoPath);
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
    const safe = !relative.split(/[\\/]/).includes("..");
    const candidate = safe ? resolve(webRoot, relative) : "";
    const path = candidate.startsWith(`${webRoot}${sep}`) && existsSync(candidate) ? candidate : resolve(webRoot, "index.html");
    return new Response(Bun.file(path), { headers: { "Content-Type": contentType(path) } });
  },
});

process.stdout.write(`LapWing local analysis: http://${server.hostname}:${server.port}/?desktopSession=dev&nosw=1\n`);
