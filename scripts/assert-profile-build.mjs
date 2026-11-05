import { readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const simDir = path.join(root, "apps/web/dist-sim/assets");
const fullDir = path.join(root, "apps/web/dist-full/assets");
const forbidden = [
  "DataloggerDownload",
  "DovesloggerDownload",
  "MyChronDownload",
  "AlfanoDownload",
  "goproImport",
];

const names = async (directory) => readdir(directory);
const sim = await names(simDir);
const full = await names(fullDir);
const leaked = forbidden.filter((prefix) => sim.some((name) => name.startsWith(prefix)));
if (leaked.length) {
  console.error(`Sim profile contains hardware chunks: ${leaked.join(", ")}`);
  process.exit(1);
}
const missing = forbidden.filter((prefix) => !full.some((name) => name.startsWith(prefix)));
if (missing.length) {
  console.error(`Full profile is missing compatibility chunks: ${missing.join(", ")}`);
  process.exit(1);
}
console.log("Profile bundle boundary verified.");
