import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const directory = mkdtempSync(path.join(tmpdir(), "lapwing-cli-smoke-"));
const fixture = path.join(directory, "fixture.ibt");

function run(args) {
  const result = spawnSync("bun", ["apps/cli/src/lapwing.ts", ...args], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `CLI exited ${result.status}`);
  }
  return result.stdout;
}

try {
  run(["fixture", "ibt", "--duration", "30s", "--output", fixture]);
  const report = JSON.parse(run(["inspect", fixture]));
  if (report.command !== "inspect" || report.telemetry.sampleCount < 1) {
    throw new Error("CLI inspect smoke test returned an invalid report.");
  }
  console.log("CLI fixture/inspect smoke test passed.");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
