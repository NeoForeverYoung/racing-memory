import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const outDir = path.resolve(root, process.argv[2] ?? "apps/web/dist-sim");
const manifestPath = path.join(outDir, ".vite/manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const entry = Object.values(manifest).find((item) => item.isEntry && item.src === "index.html");
if (!entry) throw new Error(`No index entry in ${manifestPath}`);

const byFile = new Map(Object.values(manifest).map((item) => [item.file, item]));
const eager = new Set();
const visit = (item) => {
  if (!item || eager.has(item.file)) return;
  eager.add(item.file);
  for (const imported of item.imports ?? []) visit(manifest[imported] ?? byFile.get(imported));
};
visit(entry);

const forbiddenFiles = /(?:gopro|datalogger|doveslogger|mychron|alfano|vendor-supabase|sharp)/i;
const forbiddenContent = [
  ["bun:ffi", "Windows FFI"],
  ["navigator.bluetooth", "Web Bluetooth"],
];
const failures = [];
for (const file of eager) {
  if (forbiddenFiles.test(file)) failures.push(`forbidden eager chunk: ${file}`);
  const content = fs.readFileSync(path.join(outDir, file), "utf8");
  for (const [token, label] of forbiddenContent) {
    if (content.includes(token)) failures.push(`${label} (${token}) found in eager ${file}`);
  }
}
if (failures.length) throw new Error(`Sim eager bundle isolation failed:\n${failures.join("\n")}`);
console.log(`Sim eager bundle verified (${eager.size} files).`);
