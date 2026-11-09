import { describe, expect, it } from "vitest";
import { svgDimensions } from "./svgRasterizer";

describe("svgDimensions", () => {
  it("reads the scorecard viewport from the SVG root", () => {
    expect(svgDimensions('<svg xmlns="http://www.w3.org/2000/svg" width="2160" height="2700"></svg>'))
      .toEqual({ width: 2160, height: 2700 });
  });

  it("uses a safe default when dimensions are absent", () => {
    expect(svgDimensions("<svg></svg>")).toEqual({ width: 1200, height: 675 });
  });
});
