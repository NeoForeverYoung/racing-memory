import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { edgeScreenshotArgs, svgDimensions } from "./svgRasterizer";

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
