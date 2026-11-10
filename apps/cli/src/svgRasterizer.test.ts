import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "node:path";
import { edgeScreenshotArgs, svgDimensions, waitForRenderedPng } from "./svgRasterizer";

describe("svgDimensions", () => {
  it("reads the scorecard viewport from the SVG root", () => {
    expect(svgDimensions('<svg xmlns="http://www.w3.org/2000/svg" width="2160" height="2700"></svg>'))
      .toEqual({ width: 2160, height: 2700 });
  });

  it("uses a safe default when dimensions are absent", () => {
    expect(svgDimensions("<svg></svg>")).toEqual({ width: 1200, height: 675 });
  });
});

describe("edgeScreenshotArgs", () => {
  it("passes a dedicated headless profile directory to Edge", () => {
    const args = edgeScreenshotArgs(2160, 2700, "scorecard.png", "scorecard.svg", "C:/Temp/lapwing-edge-abc");
    expect(args).toContain("--user-data-dir=C:/Temp/lapwing-edge-abc");
    expect(args).toContain("--window-size=2160,2700");
    expect(args).toContain(`--screenshot=${resolve("scorecard.png")}`);
    expect(args.at(-1)).toMatch(/^file:\/\//);
  });
});

describe("waitForRenderedPng", () => {
  it("waits for Edge's deferred non-empty output", async () => {
    const directory = mkdtempSync(join(tmpdir(), "lapwing-rasterizer-"));
    const png = join(directory, "scorecard.png");
    try {
      setTimeout(() => writeFileSync(png, "png"), 20);
      await expect(waitForRenderedPng(png, 500, 5)).resolves.toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
