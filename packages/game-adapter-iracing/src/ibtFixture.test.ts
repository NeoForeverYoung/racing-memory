import { describe, expect, it } from "vitest";
import { createSyntheticIbt } from "./ibtFixture";
import { parseIracingFile } from "./iracingParser";

describe("createSyntheticIbt", () => {
  it("creates parser-compatible race-state telemetry", () => {
    const fixture = createSyntheticIbt({ durationSec: 120, tickRate: 5, lapDurationSec: 30 });
    const data = parseIracingFile(fixture.bytes.buffer);

    expect(data.samples).toHaveLength(601);
    expect(data.duration).toBe(120_000);
    expect(data.fieldMappings.map((mapping) => mapping.name)).toEqual(expect.arrayContaining([
      "race_position",
      "race_class_position",
      "race_incidents",
      "race_on_pit_road",
    ]));
    expect(data.samples.some((sample) => (sample.extraFields.race_incidents ?? 0) > 0)).toBe(true);
  });

  it("rejects fixtures that are too short to exercise event windows", () => {
    expect(() => createSyntheticIbt({ durationSec: 10 })).toThrow(/between 30 seconds and 24 hours/);
  });

  it("rejects degenerate lap lengths and runaway durations", () => {
    // A zero lap length used to write NaN positions and still report success.
    expect(() => createSyntheticIbt({ durationSec: 60, lapDurationSec: 0 })).toThrow(/lap duration/);
    expect(() => createSyntheticIbt({ durationSec: 60, lapDurationSec: -10 })).toThrow(/lap duration/);
    expect(() => createSyntheticIbt({ durationSec: 100 * 3600 })).toThrow(/24 hours/);
  });

  it("reports event times without floating-point noise", () => {
    const { events } = createSyntheticIbt({ durationSec: 43, tickRate: 1 });
    for (const value of Object.values(events)) {
      expect(Math.round(value * 1000) / 1000).toBe(value);
    }
  });
});
