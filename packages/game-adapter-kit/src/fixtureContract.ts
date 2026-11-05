import {
  hasCapability,
  validateCanonicalSession,
  type CanonicalSession,
} from "@lapwing/telemetry-core";

export interface AdapterFixtureExpectations {
  spatial: "geo" | "world" | "track" | "none";
  gameLaps?: boolean;
  racePosition?: boolean;
  incidents?: boolean;
}

/** Shared fixture-first checks used by every game adapter test suite. */
export function validateAdapterFixture(
  session: CanonicalSession,
  expected: AdapterFixtureExpectations,
): string[] {
  const errors = validateCanonicalSession(session);
  const spatialKinds = new Set(session.frames.flatMap((frame) => frame.spatial?.kind ?? []));
  if (expected.spatial === "none" && spatialKinds.size > 0) {
    errors.push("fixture must not invent spatial telemetry.");
  } else if (expected.spatial !== "none" && !spatialKinds.has(expected.spatial)) {
    errors.push(`fixture must provide ${expected.spatial} spatial telemetry.`);
  }
  const checks = [
    [expected.gameLaps, "timing.game-laps"],
    [expected.racePosition, "race.position"],
    [expected.incidents, "race.incidents"],
  ] as const;
  for (const [required, capability] of checks) {
    if (required === true && !hasCapability(session, capability)) {
      errors.push(`fixture is missing ${capability}.`);
    }
    if (required === false && hasCapability(session, capability)) {
      errors.push(`fixture declares unsupported ${capability}.`);
    }
  }
  return errors;
}
