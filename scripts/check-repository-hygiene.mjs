import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

function git(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || `git ${args.join(" ")} failed\n`);
    process.exit(result.status ?? 1);
  }
  return result.stdout;
}

const tracked = git(["ls-files", "-z"]).split("\0").filter(Boolean);
const forbiddenPatterns = [
  {
    pattern: /(^|\/)(node_modules|coverage|target|\.cache|\.turbo|\.vite)(\/|$)/,
    reason: "machine-local dependency, cache or build directory",
  },
  {
    pattern: /(^|\/)dist(?:-[^/]+)?(\/|$)/,
    reason: "generated build output",
  },
  {
    pattern: /^(data|tmp|temp)\//,
    reason: "local fixture or temporary output",
  },
  {
    pattern: /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/,
    reason: "non-Bun lockfile",
  },
  {
    pattern: /(^|\/)(Thumbs\.db|Desktop\.ini|\.DS_Store)$/,
    reason: "operating-system metadata",
  },
  {
    pattern: /^apps\/desktop\/src-tauri\/(binaries|gen|icons)\//,
    reason: "generated Tauri artifact",
  },
];

const errors = [];
for (const path of tracked) {
  for (const rule of forbiddenPatterns) {
    if (rule.pattern.test(path)) errors.push(`${path}: ${rule.reason}`);
  }
}

const requiredTracked = [
  ".bun-version",
  ".editorconfig",
  ".gitattributes",
  ".gitignore",
  "bun.lock",
  "rust-toolchain.toml",
  "apps/desktop/src-tauri/Cargo.lock",
];
for (const path of requiredTracked) {
  if (!existsSync(resolve(root, path))) errors.push(`${path}: required reproducibility file is missing`);
}

const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const bunVersion = readFileSync(resolve(root, ".bun-version"), "utf8").trim();
if (packageJson.packageManager !== `bun@${bunVersion}`) {
  errors.push(`package.json packageManager (${packageJson.packageManager ?? "missing"}) must match .bun-version (${bunVersion})`);
}

for (const path of tracked.filter((entry) => entry.startsWith("release/") && entry.endsWith(".zip"))) {
  const attributes = git(["check-attr", "filter", "--", path]);
  if (!attributes.includes("filter: lfs")) errors.push(`${path}: release ZIP must be stored through Git LFS`);
}

if (errors.length > 0) {
  process.stderr.write(`Repository hygiene failed:\n- ${errors.join("\n- ")}\n`);
  process.exit(1);
}

process.stdout.write(`Repository hygiene passed (${tracked.length} tracked files checked).\n`);
