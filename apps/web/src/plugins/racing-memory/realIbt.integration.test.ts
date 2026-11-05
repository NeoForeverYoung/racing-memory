import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDatalogContent } from "@/lib/datalogParser";
import { detectMemoryHighlights } from "./highlights";

const fixturePath = process.env.RACING_IBT_GOLDEN;

describe.skipIf(!fixturePath)("Racing Memory real iRacing fixture", () => {
  it("reads race-state channels and detects timeline events", () => {
    const bytes = Uint8Array.from(readFileSync(fixturePath!));
    // Exercise the same routing, channel normalization, and GPS filtering path
    // used when a browser user opens an .ibt file.
    const data = parseDatalogContent(bytes.buffer);
    const highlights = detectMemoryHighlights(data, []);

    expect(data.duration).toBeGreaterThan(2_500_000);
    expect(data.samples[0].extraFields).toHaveProperty("custom:player_position");
    expect(data.samples[0].extraFields).toHaveProperty("custom:incident_count");
    expect(highlights.some((highlight) => highlight.kind === "incident")).toBe(true);
    expect(highlights.some((highlight) => highlight.kind === "overtake")).toBe(true);
    expect(highlights.at(-1)?.kind).toBe("finish");
  }, 120_000);
});
