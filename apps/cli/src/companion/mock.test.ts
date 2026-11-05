import { describe, expect, it } from "vitest";
import { MockIracingSource } from "./mock";

describe("MockIracingSource", () => {
  it("emits a complete deterministic race lifecycle", async () => {
    const states: string[] = [];
    for await (const event of new MockIracingSource().events()) {
      states.push(event.state);
    }
    expect(states).toEqual(["connecting", "live", "green", "finished"]);
  });
});
