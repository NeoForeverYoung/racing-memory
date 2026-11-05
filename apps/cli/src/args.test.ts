import { describe, expect, it } from "vitest";
import { numberOption, parseArguments, type CommandSpec } from "./args";

const spec: CommandSpec = {
  positionals: 1,
  valueFlags: ["report", "duration"],
  booleanFlags: ["compact"],
};

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

describe("parseArguments", () => {
  it("never lets a boolean flag swallow the next positional", () => {
    const parsed = parseArguments(["--compact", "a.ibt"], spec);
    expect(parsed.positional).toEqual(["a.ibt"]);
    expect(parsed.flags.has("compact")).toBe(true);
  });

  it("accepts both --name value and --name=value", () => {
    expect(parseArguments(["--duration", "8m"], spec).values.get("duration")).toBe("8m");
    expect(parseArguments(["--duration=8m"], spec).values.get("duration")).toBe("8m");
  });

  it("rejects unknown flags and extra positionals instead of ignoring them", () => {
    expect(codeOf(() => parseArguments(["a", "--bogus"], spec))).toBe("UNKNOWN_OPTION");
    expect(codeOf(() => parseArguments(["a", "b"], spec))).toBe("UNEXPECTED_ARGUMENT");
  });

  it("rejects value flags with a missing or empty value", () => {
    expect(codeOf(() => parseArguments(["--duration"], spec))).toBe("INVALID_ARGUMENT");
    expect(codeOf(() => parseArguments(["--duration", ""], spec))).toBe("INVALID_ARGUMENT");
    expect(codeOf(() => parseArguments(["--duration="], spec))).toBe("INVALID_ARGUMENT");
    expect(codeOf(() => parseArguments(["--duration", "--report", "r.json"], spec))).toBe("INVALID_ARGUMENT");
    expect(codeOf(() => parseArguments(["--compact=yes"], spec))).toBe("INVALID_ARGUMENT");
  });
});

describe("numberOption", () => {
  it("returns the fallback when absent and rejects non-numbers", () => {
    const parsed = parseArguments(["--duration", "abc"], spec);
    expect(numberOption(parsed, "report", 7)).toBe(7);
    expect(numberOption(parsed, "report")).toBeUndefined();
    expect(codeOf(() => numberOption(parsed, "duration"))).toBe("INVALID_ARGUMENT");
  });
});
