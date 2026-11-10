import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import {
  DELIVERY_MANIFEST_SCHEMA_VERSION,
  type DeliveryManifestItem,
  type DeliveryManifestV1,
} from "@lapwing/telemetry-core";
import packageJson from "../../../package.json";
import { analyzeBundle } from "./report";
import { writeJsonAtomic } from "./jobStore";
import { selectTrainingCard } from "./trainingCard";

interface SessionAssetDocument {
  fastestAvailablePath?: string;
  optCompositePath?: string;
  mementoPath?: string;
}

function deliveryPath(outputDirectory: string, path: string): string {
  return relative(resolve(outputDirectory), resolve(path)).split("\\").join("/");
}

function addIfPresent(
  items: DeliveryManifestItem[],
  outputDirectory: string,
  path: string | undefined,
  item: Omit<DeliveryManifestItem, "path">,
): void {
  if (!path || !existsSync(path)) return;
  items.push({ ...item, path: deliveryPath(outputDirectory, path) });
}

function readSessionAssets(outputDirectory: string): SessionAssetDocument {
  const path = resolve(outputDirectory, "session-assets", "session-assets.json");
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as SessionAssetDocument;
  } catch {
    return {};
  }
}

export async function createDeliveryManifest(options: {
  bundlePath: string;
  outputDirectory: string;
}): Promise<{ manifestPath: string; manifest: DeliveryManifestV1 }> {
  const outputDirectory = resolve(options.outputDirectory);
  const analysis = await analyzeBundle(options.bundlePath);
  const assets = readSessionAssets(outputDirectory);
  const items: DeliveryManifestItem[] = [];

  addIfPresent(items, outputDirectory, resolve(outputDirectory, "reel.mp4"), {
    id: "memory-reel",
    role: "primary-video",
    group: "video",
    title: "Racing Memory 回忆视频",
    description: "自动挑选本场最值得回看的片段。",
    mediaType: "video/mp4",
    order: 10,
  });
  addIfPresent(items, outputDirectory, assets.fastestAvailablePath, {
    id: "fastest-lap-video",
    role: "supporting-video",
    group: "video",
    title: "最快完整圈",
    description: "录像范围内最快且完整的一圈。",
    mediaType: "video/mp4",
    order: 20,
  });
  addIfPresent(items, outputDirectory, assets.optCompositePath, {
    id: "optimal-composite-video",
    role: "supporting-video",
    group: "video",
    title: "OPT 合成圈",
    description: "由本场最佳区间拼接而成的理论参考圈。",
    mediaType: "video/mp4",
    order: 30,
  });
  addIfPresent(items, outputDirectory, resolve(outputDirectory, "report", "scorecard-summary.png"), {
    id: "session-scorecard",
    role: "scorecard",
    group: "overview",
    title: "赛后成绩单",
    description: "适合快速回顾和分享的一页总结。",
    mediaType: "image/png",
    order: 40,
  });
  addIfPresent(items, outputDirectory, resolve(outputDirectory, "report", "index.html"), {
    id: "session-report",
    role: "report",
    group: "report",
    title: "完整赛后报告",
    description: "包含逐圈表现、驾驶机会、训练建议和数据质量。",
    mediaType: "text/html",
    previewPath: existsSync(resolve(outputDirectory, "report", "scorecard-summary.png"))
      ? "report/scorecard-summary.png"
      : undefined,
    order: 50,
  });

  const primaryInsight = selectTrainingCard(analysis.drivingInsights).card?.title;
  const manifest: DeliveryManifestV1 = {
    schemaVersion: DELIVERY_MANIFEST_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    generator: {
      version: packageJson.version,
      gitHash: process.env.VITE_GIT_HASH || process.env.GIT_COMMIT,
    },
    summary: {
      fastestLapMs: analysis.analytics.fastestLapMs ?? undefined,
      completeLapCount: analysis.analytics.completeLapCount,
      primaryInsight,
    },
    items: items.sort((left, right) => left.order - right.order),
    diagnosticsDirectory: "artifacts",
  };
  const manifestPath = resolve(outputDirectory, "delivery-manifest.json");
  writeJsonAtomic(manifestPath, manifest);
  return { manifestPath, manifest };
}
